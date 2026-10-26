import {getAdminDb, formatFirestoreAdminError} from './firebaseAdmin';
import {TRPCError} from '@trpc/server';
import {LibraryService} from './library';
import {MetadataRegistry} from './metadata';
import {MetadataKey, CoreBookData, BookGenreData} from '../../types/metadata';
import {computeBookSearchTokens} from '../../lib/duplicateDetection';
import {
  bookDocConverter,
  bookDetailsDocConverter,
} from './book/bookPartitioner';
import {
  storedBookDocSchema,
  storedBookDetailsDocSchema,
} from '../../schemas/book';
import {
  SchemaValidationError,
  validateFirestoreWritePayload,
} from '../../schemas/common';

export type PerBookJobStage =
  | 'queued'
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

export interface TriggerBatchEnrichmentResult {
  status: 'success';
  enrichmentType: string;
  processedCount: number;
  results: Array<Record<string, unknown>>;
}

function resolveMetadataMapping(rawType: string): {
  metadataKey: MetadataKey;
  statusKey: string;
  providerLabel: string;
  isCatalogPrimary: boolean;
} {
  switch (rawType) {
    case 'geo':
    case 'geoMetadata':
      return {
        metadataKey: MetadataKey.GEO,
        statusKey: 'geo',
        providerLabel: 'Gemini AI + Geocoder',
        isCatalogPrimary: false,
      };
    case 'temporal':
    case 'temporalMetadata':
      return {
        metadataKey: MetadataKey.TEMPORAL,
        statusKey: 'temporal',
        providerLabel: 'Gemini AI',
        isCatalogPrimary: false,
      };
    case 'genre':
    case 'primaryGenre':
      return {
        metadataKey: MetadataKey.GENRE,
        statusKey: 'genre',
        providerLabel: 'Catalog + Gemini AI',
        isCatalogPrimary: false,
      };
    case 'synopsis':
      return {
        metadataKey: MetadataKey.SYNOPSIS,
        statusKey: 'synopsis',
        providerLabel: 'Catalog + Gemini AI',
        isCatalogPrimary: true,
      };
    case 'authorBio':
      return {
        metadataKey: MetadataKey.AUTHOR_BIO,
        statusKey: 'authorBio',
        providerLabel: 'Wikipedia + Gemini AI',
        isCatalogPrimary: true,
      };
    case 'coverImage':
    case 'coverUrl':
      return {
        metadataKey: MetadataKey.COVER_IMAGE,
        statusKey: 'coverImage',
        providerLabel: 'Multi-Source Catalog',
        isCatalogPrimary: true,
      };
    case 'series':
      return {
        metadataKey: MetadataKey.SERIES,
        statusKey: 'series',
        providerLabel: 'Catalog + Gemini AI',
        isCatalogPrimary: true,
      };
    case 'embedding':
    case 'embeddings':
      return {
        metadataKey: MetadataKey.EMBEDDING,
        statusKey: 'embedding',
        providerLabel: 'Gemini Embeddings',
        isCatalogPrimary: false,
      };
    default:
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported enrichment type: '${rawType}'`,
      });
  }
}

export class EnrichmentService {
  /**
   * Executes server-orchestrated batch metadata enrichment for a set of books
   * using the unified MetadataRegistry and scheduled catalog/AI providers.
   */
  static async triggerBatchEnrichment(
    userId: string,
    userEmail: string | undefined,
    input: TriggerBatchEnrichmentInput,
    options?: {
      skipAccessCheck?: boolean;
      callbacks?: BatchEnrichmentCallbacks;
    },
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

    const {metadataKey, statusKey, providerLabel, isCatalogPrimary} =
      resolveMetadataMapping(rawType);

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

    try {
      const db = getAdminDb();
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

      const needsSynopsisContext =
        metadataKey === MetadataKey.GENRE ||
        metadataKey === MetadataKey.GEO ||
        metadataKey === MetadataKey.TEMPORAL ||
        metadataKey === MetadataKey.SERIES ||
        metadataKey === MetadataKey.EMBEDDING;

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

        const synopsis =
          typeof leakedDetails.synopsis === 'string' &&
          leakedDetails.synopsis.trim()
            ? leakedDetails.synopsis.trim()
            : typeof leakedDetails.description === 'string' &&
                leakedDetails.description.trim()
              ? leakedDetails.description.trim()
              : undefined;

        const validIndex = validBooks.length;
        validBooks.push({
          rawDoc: parsedBook as unknown as Record<string, unknown>,
          bookData: {
            ...parsedBook,
            id: bookId,
            title,
            author: parsedBook.author,
            isbn: parsedBook.isbn,
            primaryGenre: parsedBook.primaryGenre ?? undefined,
            subgenres: parsedBook.subgenres,
            synopsis,
            description: leakedDetails.description ?? undefined,
          },
        });

        if (!synopsis && needsSynopsisContext) {
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
                (detailSnap.data?.() || {}) as Record<string, unknown>,
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
          // Non-fatal if bookDetails docs do not exist
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

      // Emit active stage telemetry for all valid books in this chunk
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
        {
          signal: callbacks?.signal,
          allowAiFallback: input.allowAiFallback,
          customGenres: input.customGenres,
        },
      );

      if (callbacks?.signal?.aborted) {
        return {
          status: 'success',
          enrichmentType: statusKey,
          processedCount: 0,
          results: [],
        };
      }

      const results: Array<Record<string, unknown>> = [];
      let processedCount = 0;

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

      for (const {bookData, rawDoc} of validBooks) {
        if (callbacks?.signal?.aborted) {
          break;
        }
        const bookId = bookData.id;
        const bookRef = booksCollection.doc(bookId);
        const detailRef = detailsCollection.doc(bookId);
        const bookDocPath = `/libraries/${libraryId}/books/${bookId}`;
        const detailDocPath = `/libraries/${libraryId}/bookDetails/${bookId}`;
        const value = extractedMap ? extractedMap[bookId] : undefined;

        const existingStatus =
          rawDoc.enrichmentStatus && typeof rawDoc.enrichmentStatus === 'object'
            ? {...(rawDoc.enrichmentStatus as Record<string, unknown>)}
            : {};
        const existingDetailsMeta =
          rawDoc.bookDetailsMetadata &&
          typeof rawDoc.bookDetailsMetadata === 'object'
            ? {...(rawDoc.bookDetailsMetadata as Record<string, unknown>)}
            : {};

        const hasValidValue =
          value !== undefined &&
          value !== null &&
          !(typeof value === 'string' && value.trim() === '') &&
          !(Array.isArray(value) && value.length === 0);

        if (!hasValidValue) {
          const isHybridWithAiFallback =
            metadataKey === MetadataKey.SYNOPSIS ||
            metadataKey === MetadataKey.AUTHOR_BIO ||
            metadataKey === MetadataKey.SERIES;
          const skippedAiFallback =
            isHybridWithAiFallback && input.allowAiFallback === false;

          if (!skippedAiFallback) {
            pendingWrites.push({
              type: 'update',
              ref: bookRef,
              targetEntity: 'StoredBookDoc',
              documentPath: bookDocPath,
              data: {
                enrichmentStatus: {
                  ...existingStatus,
                  [statusKey]: 'unsupported',
                },
              },
            });
          }
          pendingProgressUpdates.push({
            bookId,
            stage: 'skipped',
          });
          continue;
        }

        if (metadataKey === MetadataKey.GEO) {
          const geoObj = value as {isNonEarth?: boolean};
          const resolvedStatus = geoObj?.isNonEarth
            ? 'unsupported'
            : 'completed';
          pendingWrites.push({
            type: 'update',
            ref: bookRef,
            targetEntity: 'StoredBookDoc',
            documentPath: bookDocPath,
            data: {
              geoMetadata: value,
              enrichmentStatus: {
                ...existingStatus,
                geo: resolvedStatus,
              },
            },
          });
          processedCount++;
          results.push({id: bookId, geoMetadata: value});
        } else if (metadataKey === MetadataKey.TEMPORAL) {
          const tempObj = value as {isNonHistorical?: boolean};
          const resolvedStatus = tempObj?.isNonHistorical
            ? 'unsupported'
            : 'completed';
          pendingWrites.push({
            type: 'update',
            ref: bookRef,
            targetEntity: 'StoredBookDoc',
            documentPath: bookDocPath,
            data: {
              temporalMetadata: value,
              enrichmentStatus: {
                ...existingStatus,
                temporal: resolvedStatus,
              },
            },
          });
          processedCount++;
          results.push({id: bookId, temporalMetadata: value});
        } else if (metadataKey === MetadataKey.GENRE) {
          const genreVal = value as BookGenreData;
          pendingWrites.push({
            type: 'update',
            ref: bookRef,
            targetEntity: 'StoredBookDoc',
            documentPath: bookDocPath,
            data: {
              primaryGenre: genreVal.primaryGenre,
              subgenres: genreVal.subgenres || [],
              isCustomPrimary: Boolean(genreVal.isCustomPrimary),
              enrichmentStatus: {
                ...existingStatus,
                genre: 'completed',
              },
            },
          });
          processedCount++;
          results.push({
            id: bookId,
            primaryGenre: genreVal.primaryGenre,
            subgenres: genreVal.subgenres || [],
            isCustomPrimary: Boolean(genreVal.isCustomPrimary),
          });
        } else if (metadataKey === MetadataKey.COVER_IMAGE) {
          pendingWrites.push({
            type: 'update',
            ref: bookRef,
            targetEntity: 'StoredBookDoc',
            documentPath: bookDocPath,
            data: {
              coverUrl: value,
              enrichmentStatus: {
                ...existingStatus,
                coverImage: 'completed',
              },
            },
          });
          processedCount++;
          results.push({id: bookId, coverUrl: value});
        } else if (metadataKey === MetadataKey.SERIES) {
          const updatedSearchTokens = computeBookSearchTokens({
            title: bookData.title,
            author: bookData.author,
            isbn: bookData.isbn,
            series: typeof value === 'string' ? value : undefined,
          });
          pendingWrites.push({
            type: 'update',
            ref: bookRef,
            targetEntity: 'StoredBookDoc',
            documentPath: bookDocPath,
            data: {
              series: value,
              ...(updatedSearchTokens.length > 0
                ? {searchTokens: updatedSearchTokens}
                : {}),
              enrichmentStatus: {
                ...existingStatus,
                series: 'completed',
              },
            },
          });
          processedCount++;
          results.push({id: bookId, series: value});
        } else if (metadataKey === MetadataKey.SYNOPSIS) {
          pendingWrites.push(
            {
              type: 'update',
              ref: bookRef,
              targetEntity: 'StoredBookDoc',
              documentPath: bookDocPath,
              data: {
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasSynopsis: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  synopsis: 'completed',
                },
              },
            },
            {
              type: 'set_merge',
              ref: detailRef,
              targetEntity: 'StoredBookDetailsDoc',
              documentPath: detailDocPath,
              data: {
                synopsis: value,
                updatedAt: nowIso,
              },
            },
          );
          processedCount++;
          results.push({
            id: bookId,
            bookDetailsMetadata: {
              ...existingDetailsMeta,
              hasSynopsis: true,
            },
          });
        } else if (metadataKey === MetadataKey.AUTHOR_BIO) {
          pendingWrites.push(
            {
              type: 'update',
              ref: bookRef,
              targetEntity: 'StoredBookDoc',
              documentPath: bookDocPath,
              data: {
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasAuthorBio: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  authorBio: 'completed',
                },
              },
            },
            {
              type: 'set_merge',
              ref: detailRef,
              targetEntity: 'StoredBookDetailsDoc',
              documentPath: detailDocPath,
              data: {
                authorBio: value,
                updatedAt: nowIso,
              },
            },
          );
          processedCount++;
          results.push({
            id: bookId,
            bookDetailsMetadata: {
              ...existingDetailsMeta,
              hasAuthorBio: true,
            },
          });
        } else if (metadataKey === MetadataKey.EMBEDDING) {
          pendingWrites.push(
            {
              type: 'update',
              ref: bookRef,
              targetEntity: 'StoredBookDoc',
              documentPath: bookDocPath,
              data: {
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasEmbedding: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  embedding: 'completed',
                },
              },
            },
            {
              type: 'set_merge',
              ref: detailRef,
              targetEntity: 'StoredBookDetailsDoc',
              documentPath: detailDocPath,
              data: {
                embedding: value,
                updatedAt: nowIso,
              },
            },
          );
          processedCount++;
          results.push({
            id: bookId,
            bookDetailsMetadata: {
              ...existingDetailsMeta,
              hasEmbedding: true,
            },
          });
        }

        pendingProgressUpdates.push({
          bookId,
          stage: 'completed',
          winningProviders: {[statusKey]: providerLabel},
          updatedFields: [statusKey],
        });
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
      };
    } catch (err: unknown) {
      if (err instanceof TRPCError || err instanceof SchemaValidationError) {
        throw err;
      }
      const errMsg =
        typeof formatFirestoreAdminError === 'function'
          ? formatFirestoreAdminError(err)
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
