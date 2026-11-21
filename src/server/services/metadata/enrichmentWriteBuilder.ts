import {
  storedBookDetailsDocSchema,
  storedBookDocSchema,
} from '../../../schemas/book';
import {validateFirestoreWritePayload} from '../../../schemas/common';
import type {
  BonusCatalogFields,
  CanonicalEnrichmentType,
  CoreBookData,
  MetadataPersistencePatch,
} from '../../../types/metadata';
import {
  computeBookMissingFlags,
  computePrimaryGenreLower,
} from '../book/bookPartitioner';
import type {PerBookProgressUpdate} from '../enrichmentService';
import {applyNonDestructiveBonusCatalogPatch} from './bonusCatalogPatcher';
import type {MetadataPluginSpec} from './pluginSpecs';

export interface PendingEnrichmentWriteOperation {
  type: 'update' | 'set_merge';
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, unknown>;
  targetEntity: 'StoredBookDoc' | 'StoredBookDetailsDoc';
  documentPath: string;
}

export interface EnrichmentWriteCollectorParams {
  libraryId: string;
  statusKey: CanonicalEnrichmentType;
  providerLabel: string;
  allowAiFallback?: boolean;
  pluginSpec: MetadataPluginSpec<unknown>;
  booksCollection: FirebaseFirestore.CollectionReference;
  detailsCollection: FirebaseFirestore.CollectionReference;
  nowIso: string;
}

export interface EnrichmentWriteCollector {
  pendingWrites: PendingEnrichmentWriteOperation[];
  pendingProgressUpdates: PerBookProgressUpdate[];
  results: Array<Record<string, unknown>>;
  getProcessedCount: () => number;
  getPrunedCount: () => number;
  commitResolvedBook: (params: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    value: unknown;
    winningProvider?: string;
    bonusCatalog?: BonusCatalogFields;
  }) => void;
  commitPrunedBook: (params: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    bonusCatalog?: BonusCatalogFields;
  }) => void;
  commitUnresolvedBook: (params: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    bonusCatalog?: BonusCatalogFields;
  }) => void;
}

export function isNonEmptyMetadataValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    !(typeof value === 'string' && value.trim() === '') &&
    !(Array.isArray(value) && value.length === 0)
  );
}

export function createEnrichmentWriteCollector(
  params: EnrichmentWriteCollectorParams,
): EnrichmentWriteCollector {
  const {
    libraryId,
    statusKey,
    providerLabel,
    allowAiFallback,
    pluginSpec,
    booksCollection,
    detailsCollection,
    nowIso,
  } = params;

  const pendingWrites: PendingEnrichmentWriteOperation[] = [];
  const pendingProgressUpdates: PerBookProgressUpdate[] = [];
  const results: Array<Record<string, unknown>> = [];
  let processedCount = 0;
  let prunedCount = 0;

  function commitResolvedBook(bookParams: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    value: unknown;
    winningProvider?: string;
    bonusCatalog?: BonusCatalogFields;
  }): void {
    const {bookData, rawDoc, value, winningProvider, bonusCatalog} = bookParams;
    const bookId = bookData.id;
    const bookRef = booksCollection.doc(bookId);
    const detailRef = detailsCollection.doc(bookId);
    const bookDocPath = `/libraries/${libraryId}/books/${bookId}`;
    const detailDocPath = `/libraries/${libraryId}/bookDetails/${bookId}`;

    const existingStatus =
      rawDoc.enrichmentStatus && typeof rawDoc.enrichmentStatus === 'object'
        ? {...(rawDoc.enrichmentStatus as Record<string, unknown>)}
        : {};
    const existingDetailsMeta =
      rawDoc.bookDetailsMetadata &&
      typeof rawDoc.bookDetailsMetadata === 'object'
        ? {...(rawDoc.bookDetailsMetadata as Record<string, unknown>)}
        : {};

    let validatedValue: unknown = value;
    if (pluginSpec.outputSchema) {
      const parsedOutput = pluginSpec.outputSchema.safeParse(value);
      if (!parsedOutput.success) {
        pendingProgressUpdates.push({
          bookId,
          stage: 'failed',
          error: parsedOutput.error.message,
        });
        return;
      }
      validatedValue = parsedOutput.data;
    }

    const basePatch = pluginSpec.toPersistencePatch({
      book: bookData,
      value: validatedValue,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    });

    const {patch, bonusUpdatedFields} = applyNonDestructiveBonusCatalogPatch({
      rawDoc,
      book: bookData,
      primaryStatusKey: statusKey,
      patch: basePatch,
      bonusCatalog,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    });

    const mergedBookState = {
      ...rawDoc,
      ...patch.bookUpdate,
    };
    const mergedDetailsMeta = {
      ...existingDetailsMeta,
      ...((patch.bookUpdate.bookDetailsMetadata as
        Record<string, unknown> | undefined) || {}),
    };
    const nextGenreLower = computePrimaryGenreLower(
      mergedBookState.primaryGenre,
    );
    const enrichedBookUpdate: Record<string, unknown> = {
      ...patch.bookUpdate,
      ...(nextGenreLower ? {primaryGenreLower: nextGenreLower} : {}),
      missingFlags: computeBookMissingFlags(mergedBookState, mergedDetailsMeta),
    };

    pendingWrites.push({
      type: 'update',
      ref: bookRef,
      targetEntity: 'StoredBookDoc',
      documentPath: bookDocPath,
      data: enrichedBookUpdate,
    });

    if (patch.detailsUpdate) {
      pendingWrites.push({
        type: 'set_merge',
        ref: detailRef,
        targetEntity: 'StoredBookDetailsDoc',
        documentPath: detailDocPath,
        data: patch.detailsUpdate,
      });
    }

    processedCount++;
    results.push(patch.resultPreview);

    pendingProgressUpdates.push({
      bookId,
      stage: 'completed',
      winningProviders: {[statusKey]: winningProvider || providerLabel},
      updatedFields: [statusKey, ...bonusUpdatedFields],
    });
  }

  function commitPrunedBook(bookParams: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    bonusCatalog?: BonusCatalogFields;
  }): void {
    const {bookData, rawDoc, bonusCatalog} = bookParams;
    const bookId = bookData.id;
    const bookRef = booksCollection.doc(bookId);
    const detailRef = detailsCollection.doc(bookId);
    const bookDocPath = `/libraries/${libraryId}/books/${bookId}`;
    const detailDocPath = `/libraries/${libraryId}/bookDetails/${bookId}`;

    const existingStatus =
      rawDoc.enrichmentStatus && typeof rawDoc.enrichmentStatus === 'object'
        ? {...(rawDoc.enrichmentStatus as Record<string, unknown>)}
        : {};
    const existingDetailsMeta =
      rawDoc.bookDetailsMetadata &&
      typeof rawDoc.bookDetailsMetadata === 'object'
        ? {...(rawDoc.bookDetailsMetadata as Record<string, unknown>)}
        : {};

    const basePrunedPatch: MetadataPersistencePatch = {
      bookUpdate: {
        enrichmentStatus: {
          ...existingStatus,
          [statusKey]: 'unsupported',
        },
      },
      resultPreview: {id: bookId},
    };

    const {patch} = applyNonDestructiveBonusCatalogPatch({
      rawDoc,
      book: bookData,
      primaryStatusKey: statusKey,
      patch: basePrunedPatch,
      bonusCatalog,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    });

    pendingWrites.push({
      type: 'update',
      ref: bookRef,
      targetEntity: 'StoredBookDoc',
      documentPath: bookDocPath,
      data: patch.bookUpdate,
    });

    if (patch.detailsUpdate) {
      pendingWrites.push({
        type: 'set_merge',
        ref: detailRef,
        targetEntity: 'StoredBookDetailsDoc',
        documentPath: detailDocPath,
        data: patch.detailsUpdate,
      });
    }

    prunedCount++;
    pendingProgressUpdates.push({
      bookId,
      stage: 'skipped',
    });
  }

  function commitUnresolvedBook(bookParams: {
    bookData: CoreBookData;
    rawDoc: Record<string, unknown>;
    bonusCatalog?: BonusCatalogFields;
  }): void {
    const {bookData, rawDoc, bonusCatalog} = bookParams;
    const bookId = bookData.id;
    const bookRef = booksCollection.doc(bookId);
    const detailRef = detailsCollection.doc(bookId);
    const bookDocPath = `/libraries/${libraryId}/books/${bookId}`;
    const detailDocPath = `/libraries/${libraryId}/bookDetails/${bookId}`;

    const existingStatus =
      rawDoc.enrichmentStatus && typeof rawDoc.enrichmentStatus === 'object'
        ? {...(rawDoc.enrichmentStatus as Record<string, unknown>)}
        : {};
    const existingDetailsMeta =
      rawDoc.bookDetailsMetadata &&
      typeof rawDoc.bookDetailsMetadata === 'object'
        ? {...(rawDoc.bookDetailsMetadata as Record<string, unknown>)}
        : {};

    const skippedAiFallback =
      pluginSpec.supportsHybridAiFallback && allowAiFallback === false;

    const baseBookUpdate: Record<string, unknown> = skippedAiFallback
      ? {}
      : {
          enrichmentStatus: {
            ...existingStatus,
            [statusKey]: 'unsupported',
          },
        };

    const {patch} = applyNonDestructiveBonusCatalogPatch({
      rawDoc,
      book: bookData,
      primaryStatusKey: statusKey,
      patch: {
        bookUpdate: baseBookUpdate,
        resultPreview: {id: bookId},
      },
      bonusCatalog,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    });

    if (Object.keys(patch.bookUpdate).length > 0) {
      pendingWrites.push({
        type: 'update',
        ref: bookRef,
        targetEntity: 'StoredBookDoc',
        documentPath: bookDocPath,
        data: patch.bookUpdate,
      });
    }

    if (patch.detailsUpdate) {
      pendingWrites.push({
        type: 'set_merge',
        ref: detailRef,
        targetEntity: 'StoredBookDetailsDoc',
        documentPath: detailDocPath,
        data: patch.detailsUpdate,
      });
    }

    pendingProgressUpdates.push({
      bookId,
      stage: 'skipped',
    });
  }

  return {
    pendingWrites,
    pendingProgressUpdates,
    results,
    getProcessedCount: () => processedCount,
    getPrunedCount: () => prunedCount,
    commitResolvedBook,
    commitPrunedBook,
    commitUnresolvedBook,
  };
}

export async function commitPendingEnrichmentWrites(
  db: FirebaseFirestore.Firestore,
  pendingWrites: readonly PendingEnrichmentWriteOperation[],
): Promise<void> {
  if (pendingWrites.length === 0) {
    return;
  }
  const maxBatchOps = 400;
  for (let i = 0; i < pendingWrites.length; i += maxBatchOps) {
    const chunk = pendingWrites.slice(i, i + maxBatchOps);
    const writeBatch = db.batch();
    for (const op of chunk) {
      validateFirestoreWritePayload(
        op.targetEntity === 'StoredBookDoc'
          ? storedBookDocSchema.partial()
          : storedBookDetailsDocSchema.partial(),
        op.data,
        {
          entity: op.targetEntity,
          documentPath: op.documentPath,
          operation: op.type === 'update' ? 'update' : 'upsert',
        },
      );
      if (op.type === 'update') {
        writeBatch.update(op.ref, op.data);
      } else {
        writeBatch.set(op.ref, op.data, {merge: true});
      }
    }
    await writeBatch.commit();
  }
}
