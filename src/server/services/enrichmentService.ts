import {TRPCError} from '@trpc/server';
import {
  type EnrichmentStageProgressLabel,
  type EnrichmentTier,
  TIER_EXECUTION_PROFILES,
} from '../../constants/enrichment';
import {findEnrichmentDescriptor} from '../../constants/enrichmentDescriptors';
import {
  storedBookDetailsDocSchema,
  storedBookDocSchema,
} from '../../schemas/book';
import {
  SchemaValidationError,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import type {
  BonusCatalogFields,
  CoreBookData,
  EnrichmentPipelineStage,
  MetadataBulkFetchOptions,
  MetadataPersistencePatch,
  MetadataPlugin,
  MetadataProvider,
  StageEscalationState,
} from '../../types/metadata';
import {
  bookDetailsDocConverter,
  bookDocConverter,
} from './book/bookPartitioner';
import * as firebaseAdmin from './firebaseAdmin';
import {LibraryService} from './library';
import {MetadataRegistry} from './metadata';
import {
  applyNonDestructiveBonusCatalogPatch,
  mergeBonusCatalogFields,
} from './metadata/bonusCatalogPatcher';
import {
  getBuiltInMetadataPluginSpec,
  type MetadataPluginSpec,
} from './metadata/pluginSpecs';
import {
  executePluginStagesHorizontally,
  getOptionalModuleFunction,
} from './metadata/stageRunner';

export type PerBookJobStage =
  | 'queued'
  | 'evaluating_decisions'
  | 'fetching_catalog'
  | 'fetching_ai'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface PerBookProgressUpdate {
  bookId: string;
  stage: PerBookJobStage;
  winningProviders?: Record<string, string>;
  updatedFields?: string[];
  error?: string;
}

export interface BatchEnrichmentCallbacks {
  signal?: AbortSignal;
  onBookProgress?: (update: PerBookProgressUpdate) => void;
}

export interface TriggerBatchEnrichmentInput {
  libraryId: string;
  enrichmentType?: string;
  flow?: string;
  bookIds: string[];
  overwrite?: boolean;
  customGenres?: string[];
  allowAiFallback?: boolean;
}

export interface PipelineStageDescriptor {
  readonly stageIndex: number;
  readonly id: string;
  readonly tier: EnrichmentTier;
  readonly microBatchSize: number;
  readonly progressStage: EnrichmentStageProgressLabel;
}

export interface EscalatedBookContext {
  bookId: string;
  state: StageEscalationState<unknown>;
}

export interface TriggerBatchEnrichmentOptions {
  skipAccessCheck?: boolean;
  stageIndex?: number;
  priorEscalations?: ReadonlyMap<string, StageEscalationState<unknown>>;
  callbacks?: BatchEnrichmentCallbacks;
}

export interface TriggerBatchEnrichmentResult {
  status: 'success';
  enrichmentType: string;
  processedCount: number;
  results: Array<Record<string, unknown>>;
  escalatedBooks?: EscalatedBookContext[];
  prunedCount?: number;
}

function isNonEmptyMetadataValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    !(typeof value === 'string' && value.trim() === '') &&
    !(Array.isArray(value) && value.length === 0)
  );
}

function resolvePluginCapabilities(
  provider: MetadataProvider<unknown>,
  fallbackSpec?: MetadataPluginSpec<unknown>,
): MetadataPluginSpec<unknown> | undefined {
  const candidate = provider as Partial<MetadataPlugin<unknown>>;
  if (
    typeof candidate.toPersistencePatch === 'function' &&
    candidate.statusKey
  ) {
    return {
      statusKey: candidate.statusKey,
      needsSynopsis: Boolean(candidate.needsSynopsis),
      supportsHybridAiFallback: Boolean(candidate.supportsHybridAiFallback),
      outputSchema: candidate.outputSchema,
      toPersistencePatch: context => candidate.toPersistencePatch!(context),
    };
  }
  return fallbackSpec;
}

function getPluginStages(
  provider?: MetadataProvider<unknown>,
): ReadonlyArray<EnrichmentPipelineStage<unknown>> | undefined {
  const stages = (provider as Partial<MetadataPlugin<unknown>> | undefined)
    ?.stages;
  return stages && stages.length > 0 ? stages : undefined;
}

export class EnrichmentService {
  /**
   * Introspects the declarative `EnrichmentPipelineStage[]` registered on a
   * `MetadataPlugin` so job coordinators derive wave order, micro-batch sizes,
   * and SSE progress labels generically without per-field branching.
   */
  static getPipelineStages(rawType: string): PipelineStageDescriptor[] {
    const descriptor = findEnrichmentDescriptor(rawType);
    if (!descriptor) {
      const fallbackProfile = TIER_EXECUTION_PROFILES.decision;
      return [
        {
          stageIndex: 0,
          id: 'default-decision',
          tier: 'decision',
          microBatchSize: fallbackProfile.microBatchSize,
          progressStage: fallbackProfile.progressStage,
        },
      ];
    }

    const registry = MetadataRegistry.getInstance();
    const provider = registry?.getProvider?.(descriptor.key);
    const stages = getPluginStages(provider);

    if (stages) {
      return stages.map((stage, stageIndex) => {
        const profile = TIER_EXECUTION_PROFILES[stage.tier];
        return {
          stageIndex,
          id: stage.id,
          tier: stage.tier,
          microBatchSize: Math.max(1, profile.microBatchSize),
          progressStage: profile.progressStage,
        };
      });
    }

    const fallbackTier: EnrichmentTier =
      descriptor.statusKey === 'embedding'
        ? 'embedding'
        : descriptor.isCatalogPrimary
          ? 'catalog'
          : 'decision';
    const fallbackProfile = TIER_EXECUTION_PROFILES[fallbackTier];
    return [
      {
        stageIndex: 0,
        id: `${descriptor.statusKey}-${fallbackTier}`,
        tier: fallbackTier,
        microBatchSize: Math.max(1, fallbackProfile.microBatchSize),
        progressStage: fallbackProfile.progressStage,
      },
    ];
  }

  /**
   * Executes server-orchestrated batch metadata enrichment for a set of books
   * using the unified MetadataRegistry and typed MetadataPlugin contracts.
   * Supports both single-wave execution (`options.stageIndex`) for streaming
   * horizontal sieve jobs and full multi-stage execution for direct RPC calls.
   */
  static async triggerBatchEnrichment(
    userId: string,
    userEmail: string | undefined,
    input: TriggerBatchEnrichmentInput,
    options?: TriggerBatchEnrichmentOptions,
  ): Promise<TriggerBatchEnrichmentResult> {
    const {libraryId, bookIds} = input;
    const rawType = input.enrichmentType || input.flow || 'genre';
    const callbacks = options?.callbacks;

    if (!options?.skipAccessCheck) {
      await LibraryService.verifyLibraryAccess(
        userId,
        userEmail,
        libraryId,
        'editor',
      );
    }

    const descriptor = findEnrichmentDescriptor(rawType);
    if (!descriptor) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported enrichment type: '${rawType}'`,
      });
    }

    const {
      key: metadataKey,
      statusKey,
      providerLabel,
      isCatalogPrimary,
    } = descriptor;

    if (!bookIds || bookIds.length === 0) {
      return {
        status: 'success',
        enrichmentType: statusKey,
        processedCount: 0,
        results: [],
      };
    }

    const registry = MetadataRegistry.getInstance();
    const provider = registry.getProvider(metadataKey);

    if (!provider || !provider.isAvailable()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Metadata provider for '${statusKey}' is currently unavailable.`,
      });
    }

    const pluginSpec = resolvePluginCapabilities(
      provider,
      getBuiltInMetadataPluginSpec(metadataKey),
    );
    if (!pluginSpec) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `No persistence specification registered for '${statusKey}'.`,
      });
    }

    const pluginStages = getPluginStages(provider);

    try {
      const db = firebaseAdmin.getAdminDb();
      const booksCollection = db
        .collection('libraries')
        .doc(libraryId)
        .collection('books');
      const detailsCollection = db
        .collection('libraries')
        .doc(libraryId)
        .collection('bookDetails');

      const validBooks: Array<{
        bookData: CoreBookData;
        rawDoc: Record<string, unknown>;
      }> = [];

      if (callbacks?.signal?.aborted) {
        return {
          status: 'success',
          enrichmentType: statusKey,
          processedCount: 0,
          results: [],
        };
      }

      const bookRefs = bookIds.map(bookId => booksCollection.doc(bookId));
      const bookSnaps = await db.getAll(...bookRefs);

      const missingSynopsisIndices: Array<{
        bookId: string;
        validIndex: number;
      }> = [];

      for (let i = 0; i < bookIds.length; i++) {
        if (callbacks?.signal?.aborted) {
          break;
        }
        const bookId = bookIds[i];
        const snap = bookSnaps[i];
        if (!snap?.exists) {
          callbacks?.onBookProgress?.({
            bookId,
            stage: 'skipped',
          });
          continue;
        }

        const rawDoc = (snap.data?.() || {}) as Record<string, unknown>;
        const {book: parsedBook, leakedDetails} =
          bookDocConverter.fromFirestoreWithLegacyLeaks(
            bookId,
            rawDoc,
            `/libraries/${libraryId}/books/${bookId}`,
          );
        const title =
          typeof rawDoc.title === 'string' ? rawDoc.title.trim() : '';
        if (!title) {
          callbacks?.onBookProgress?.({
            bookId,
            stage: 'skipped',
          });
          continue;
        }

        const inlineSynopsis =
          typeof leakedDetails.synopsis === 'string' &&
          leakedDetails.synopsis.trim()
            ? leakedDetails.synopsis.trim()
            : typeof leakedDetails.description === 'string' &&
                leakedDetails.description.trim()
              ? leakedDetails.description.trim()
              : undefined;

        const priorEscalation = options?.priorEscalations?.get(bookId);
        const baseBookData: CoreBookData = {
          ...parsedBook,
          id: bookId,
          title,
          author: parsedBook.author,
          isbn: parsedBook.isbn,
          primaryGenre: parsedBook.primaryGenre ?? undefined,
          subgenres: parsedBook.subgenres,
          synopsis: inlineSynopsis,
          description: leakedDetails.description ?? undefined,
        };
        const mergedBookData: CoreBookData = priorEscalation?.enrichedBook
          ? {
              ...baseBookData,
              ...priorEscalation.enrichedBook,
              id: bookId,
            }
          : baseBookData;

        const validIndex = validBooks.length;
        validBooks.push({
          rawDoc: parsedBook,
          bookData: mergedBookData,
        });

        if (!mergedBookData.synopsis && pluginSpec.needsSynopsis) {
          missingSynopsisIndices.push({bookId, validIndex});
        }
      }

      if (missingSynopsisIndices.length > 0 && !callbacks?.signal?.aborted) {
        try {
          const detailRefs = missingSynopsisIndices.map(item =>
            detailsCollection.doc(item.bookId),
          );
          const detailSnaps = await db.getAll(...detailRefs);

          for (let i = 0; i < missingSynopsisIndices.length; i++) {
            const detailSnap = detailSnaps[i];
            if (detailSnap?.exists) {
              const detailBookId = missingSynopsisIndices[i].bookId;
              const detailData = bookDetailsDocConverter.fromFirestore(
                detailBookId,
                detailSnap.data?.() || {},
                `/libraries/${libraryId}/bookDetails/${detailBookId}`,
              );
              const detailSyn =
                typeof detailData.synopsis === 'string' &&
                detailData.synopsis.trim()
                  ? detailData.synopsis.trim()
                  : typeof detailData.description === 'string' &&
                      detailData.description.trim()
                    ? detailData.description.trim()
                    : undefined;
              if (detailSyn) {
                const target = validBooks[missingSynopsisIndices[i].validIndex];
                if (target) {
                  target.bookData.synopsis = detailSyn;
                }
              }
            }
          }
        } catch (err) {
          if (err instanceof SchemaValidationError) {
            throw err;
          }
        }
      }

      if (validBooks.length === 0 || callbacks?.signal?.aborted) {
        return {
          status: 'success',
          enrichmentType: statusKey,
          processedCount: 0,
          results: [],
        };
      }

      const fetchOptions: MetadataBulkFetchOptions = {
        signal: callbacks?.signal,
        allowAiFallback: input.allowAiFallback,
        customGenres: input.customGenres,
      };

      const results: Array<Record<string, unknown>> = [];
      let processedCount = 0;
      let prunedCount = 0;
      const escalatedBooks: EscalatedBookContext[] = [];

      interface PendingWriteOperation {
        type: 'update' | 'set_merge';
        ref: FirebaseFirestore.DocumentReference;
        data: Record<string, unknown>;
        targetEntity: 'StoredBookDoc' | 'StoredBookDetailsDoc';
        documentPath: string;
      }

      const pendingWrites: PendingWriteOperation[] = [];
      const pendingProgressUpdates: PerBookProgressUpdate[] = [];
      const nowIso = new Date().toISOString();

      const commitResolvedBook = (params: {
        bookData: CoreBookData;
        rawDoc: Record<string, unknown>;
        value: unknown;
        winningProvider?: string;
        bonusCatalog?: BonusCatalogFields;
      }): void => {
        const {bookData, rawDoc, value, winningProvider, bonusCatalog} = params;
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

        const {patch, bonusUpdatedFields} =
          applyNonDestructiveBonusCatalogPatch({
            rawDoc,
            book: bookData,
            primaryStatusKey: statusKey,
            patch: basePatch,
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

        processedCount++;
        results.push(patch.resultPreview);

        pendingProgressUpdates.push({
          bookId,
          stage: 'completed',
          winningProviders: {[statusKey]: winningProvider || providerLabel},
          updatedFields: [statusKey, ...bonusUpdatedFields],
        });
      };

      const commitPrunedBook = (params: {
        bookData: CoreBookData;
        rawDoc: Record<string, unknown>;
        bonusCatalog?: BonusCatalogFields;
      }): void => {
        const {bookData, rawDoc, bonusCatalog} = params;
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
      };

      const commitUnresolvedBook = (params: {
        bookData: CoreBookData;
        rawDoc: Record<string, unknown>;
        bonusCatalog?: BonusCatalogFields;
      }): void => {
        const {bookData, rawDoc, bonusCatalog} = params;
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
          pluginSpec.supportsHybridAiFallback &&
          input.allowAiFallback === false;

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
      };

      if (pluginStages && typeof options?.stageIndex === 'number') {
        const targetStage = pluginStages[options.stageIndex];
        if (!targetStage) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
            escalatedBooks: [],
            prunedCount: 0,
          };
        }

        const stageProfile = TIER_EXECUTION_PROFILES[targetStage.tier];
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: stageProfile.progressStage,
            });
          }
        }

        const stageOutcomes = await targetStage.execute({
          books: validBooks.map(v => v.bookData),
          options: fetchOptions,
          priorEscalations: options.priorEscalations,
        });

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        const hasRunnableSubsequentStage = pluginStages
          .slice(options.stageIndex + 1)
          .some(
            nextStage =>
              !(
                input.allowAiFallback === false &&
                TIER_EXECUTION_PROFILES[nextStage.tier].requiresAi
              ),
          );

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const prior = options.priorEscalations?.get(bookId);
          const outcome = stageOutcomes.get(bookId);
          const mergedBonus = mergeBonusCatalogFields(
            prior?.bonusCatalog,
            outcome?.bonusCatalog,
          );

          if (
            outcome?.status === 'resolved' &&
            isNonEmptyMetadataValue(outcome.value)
          ) {
            commitResolvedBook({
              bookData,
              rawDoc,
              value: outcome.value,
              winningProvider: outcome.winningProvider,
              bonusCatalog: mergedBonus,
            });
          } else if (outcome?.status === 'pruned') {
            commitPrunedBook({
              bookData,
              rawDoc,
              bonusCatalog: mergedBonus,
            });
          } else if (outcome?.status === 'escalate') {
            const nextFallback =
              outcome.fallbackValue !== undefined
                ? outcome.fallbackValue
                : prior?.fallbackValue;
            const mergedEnrichedPatch =
              prior?.enrichedBook || outcome.enrichedBook
                ? {
                    ...(prior?.enrichedBook ?? {}),
                    ...(outcome.enrichedBook ?? {}),
                  }
                : undefined;

            if (hasRunnableSubsequentStage) {
              escalatedBooks.push({
                bookId,
                state: {
                  ...(mergedEnrichedPatch
                    ? {enrichedBook: mergedEnrichedPatch}
                    : {}),
                  ...(nextFallback !== undefined
                    ? {fallbackValue: nextFallback}
                    : {}),
                  ...(mergedBonus ? {bonusCatalog: mergedBonus} : {}),
                },
              });
            } else if (isNonEmptyMetadataValue(nextFallback)) {
              commitResolvedBook({
                bookData,
                rawDoc,
                value: nextFallback,
                bonusCatalog: mergedBonus,
              });
            } else {
              commitUnresolvedBook({
                bookData,
                rawDoc,
                bonusCatalog: mergedBonus,
              });
            }
          } else if (isNonEmptyMetadataValue(prior?.fallbackValue)) {
            commitResolvedBook({
              bookData,
              rawDoc,
              value: prior!.fallbackValue,
              bonusCatalog: mergedBonus,
            });
          } else {
            commitUnresolvedBook({
              bookData,
              rawDoc,
              bonusCatalog: mergedBonus,
            });
          }
        }
      } else if (pluginStages) {
        const firstStageProfile = TIER_EXECUTION_PROFILES[pluginStages[0].tier];
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: firstStageProfile.progressStage,
            });
          }
        }

        const horizontalRun = await executePluginStagesHorizontally(
          pluginStages,
          validBooks.map(v => v.bookData),
          fetchOptions,
        );

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const outcome = horizontalRun.outcomes.get(bookId);

          if (
            outcome?.status === 'resolved' &&
            isNonEmptyMetadataValue(outcome.value)
          ) {
            commitResolvedBook({
              bookData,
              rawDoc,
              value: outcome.value,
              winningProvider: outcome.winningProvider,
              bonusCatalog: outcome.bonusCatalog,
            });
          } else if (outcome?.status === 'pruned') {
            commitPrunedBook({
              bookData,
              rawDoc,
              bonusCatalog: outcome.bonusCatalog,
            });
          } else {
            commitUnresolvedBook({
              bookData,
              rawDoc,
              bonusCatalog:
                outcome?.bonusCatalog ??
                horizontalRun.unresolvedBonusByBookId.get(bookId),
            });
          }
        }
      } else {
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: isCatalogPrimary ? 'fetching_catalog' : 'fetching_ai',
            });
          }
        }

        const extractedMap = await provider.bulkFetch(
          validBooks.map(v => v.bookData),
          fetchOptions,
        );

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const value = extractedMap ? extractedMap[bookId] : undefined;

          if (isNonEmptyMetadataValue(value)) {
            commitResolvedBook({
              bookData,
              rawDoc,
              value,
            });
          } else {
            commitUnresolvedBook({
              bookData,
              rawDoc,
            });
          }
        }
      }

      if (pendingWrites.length > 0 && !callbacks?.signal?.aborted) {
        const MAX_BATCH_OPS = 400;
        for (let i = 0; i < pendingWrites.length; i += MAX_BATCH_OPS) {
          const chunk = pendingWrites.slice(i, i + MAX_BATCH_OPS);
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

      if (callbacks?.onBookProgress && !callbacks?.signal?.aborted) {
        for (const progressUpdate of pendingProgressUpdates) {
          callbacks.onBookProgress(progressUpdate);
        }
      }

      return {
        status: 'success',
        enrichmentType: statusKey,
        processedCount,
        results,
        ...(typeof options?.stageIndex === 'number'
          ? {escalatedBooks, prunedCount}
          : {}),
      };
    } catch (err: unknown) {
      if (err instanceof TRPCError || err instanceof SchemaValidationError) {
        throw err;
      }
      const formatErrFn = getOptionalModuleFunction<
        typeof firebaseAdmin.formatFirestoreAdminError
      >(firebaseAdmin, 'formatFirestoreAdminError');
      const errMsg = formatErrFn
        ? formatErrFn(err)
        : err instanceof Error
          ? err.message
          : String(err);
      console.error(
        `[EnrichmentService] Error in triggerBatchEnrichment (${statusKey}):`,
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to enrich metadata (${statusKey}): ${errMsg}`,
      });
    }
  }
}
