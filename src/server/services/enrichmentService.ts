import {getAdminDb, formatFirestoreAdminError} from './firebaseAdmin';
import {TRPCError} from '@trpc/server';
import {LibraryService} from './library';
import {MetadataRegistry} from './metadata';
import {MetadataKey, CoreBookData, BookGenreData} from '../../types/metadata';

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

      await Promise.all(
        bookIds.map(async bookId => {
          if (callbacks?.signal?.aborted) return;
          const snap = await booksCollection.doc(bookId).get();
          if (!snap.exists) {
            callbacks?.onBookProgress?.({
              bookId,
              stage: 'skipped',
            });
            return;
          }

          const rawDoc = (snap.data() || {}) as Record<string, unknown>;
          const title =
            typeof rawDoc.title === 'string' ? rawDoc.title.trim() : '';
          if (!title) {
            callbacks?.onBookProgress?.({
              bookId,
              stage: 'skipped',
            });
            return;
          }

          let synopsis =
            typeof rawDoc.synopsis === 'string' && rawDoc.synopsis.trim()
              ? rawDoc.synopsis.trim()
              : typeof rawDoc.description === 'string' &&
                  rawDoc.description.trim()
                ? rawDoc.description.trim()
                : undefined;

          if (!synopsis && needsSynopsisContext) {
            try {
              const detailDoc = detailsCollection.doc(bookId) as {
                get?: () => Promise<{
                  exists?: boolean;
                  data?: () => Record<string, unknown> | undefined;
                }>;
              };
              if (typeof detailDoc?.get === 'function') {
                const detailSnap = await detailDoc.get();
                if (detailSnap?.exists) {
                  const detailData = detailSnap.data() || {};
                  const detailSyn =
                    typeof detailData.synopsis === 'string' &&
                    detailData.synopsis.trim()
                      ? detailData.synopsis.trim()
                      : typeof detailData.description === 'string' &&
                          detailData.description.trim()
                        ? detailData.description.trim()
                        : undefined;
                  if (detailSyn) {
                    synopsis = detailSyn;
                  }
                }
              }
            } catch {
              // Non-fatal if bookDetails doc does not exist or mock lacks .get()
            }
          }

          validBooks.push({
            rawDoc,
            bookData: {
              ...rawDoc,
              id: bookId,
              title,
              author:
                typeof rawDoc.author === 'string' && rawDoc.author.trim()
                  ? rawDoc.author.trim()
                  : 'Unknown Author',
              isbn: typeof rawDoc.isbn === 'string' ? rawDoc.isbn : undefined,
              primaryGenre:
                typeof rawDoc.primaryGenre === 'string'
                  ? rawDoc.primaryGenre
                  : undefined,
              subgenres: Array.isArray(rawDoc.subgenres)
                ? (rawDoc.subgenres as string[])
                : undefined,
              synopsis,
              description:
                typeof rawDoc.description === 'string'
                  ? rawDoc.description
                  : undefined,
            },
          });
        }),
      );

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
        {signal: callbacks?.signal},
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

      await Promise.all(
        validBooks.map(async ({bookData, rawDoc}) => {
          if (callbacks?.signal?.aborted) return;
          const bookId = bookData.id;
          const value = extractedMap ? extractedMap[bookId] : undefined;

          const existingStatus =
            rawDoc.enrichmentStatus &&
            typeof rawDoc.enrichmentStatus === 'object'
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
            await booksCollection.doc(bookId).update({
              enrichmentStatus: {
                ...existingStatus,
                [statusKey]: 'unsupported',
              },
            });
            callbacks?.onBookProgress?.({
              bookId,
              stage: 'skipped',
            });
            return;
          }

          if (metadataKey === MetadataKey.GEO) {
            const geoObj = value as {isNonEarth?: boolean};
            const resolvedStatus = geoObj?.isNonEarth
              ? 'unsupported'
              : 'completed';
            await booksCollection.doc(bookId).update({
              geoMetadata: value,
              enrichmentStatus: {
                ...existingStatus,
                geo: resolvedStatus,
              },
            });
            processedCount++;
            results.push({id: bookId, geoMetadata: value});
          } else if (metadataKey === MetadataKey.TEMPORAL) {
            const tempObj = value as {isNonHistorical?: boolean};
            const resolvedStatus = tempObj?.isNonHistorical
              ? 'unsupported'
              : 'completed';
            await booksCollection.doc(bookId).update({
              temporalMetadata: value,
              enrichmentStatus: {
                ...existingStatus,
                temporal: resolvedStatus,
              },
            });
            processedCount++;
            results.push({id: bookId, temporalMetadata: value});
          } else if (metadataKey === MetadataKey.GENRE) {
            const genreVal = value as BookGenreData;
            await booksCollection.doc(bookId).update({
              primaryGenre: genreVal.primaryGenre,
              subgenres: genreVal.subgenres || [],
              isCustomPrimary: Boolean(genreVal.isCustomPrimary),
              enrichmentStatus: {
                ...existingStatus,
                genre: 'completed',
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
            await booksCollection.doc(bookId).update({
              coverUrl: value,
              enrichmentStatus: {
                ...existingStatus,
                coverImage: 'completed',
              },
            });
            processedCount++;
            results.push({id: bookId, coverUrl: value});
          } else if (metadataKey === MetadataKey.SERIES) {
            await booksCollection.doc(bookId).update({
              series: value,
              enrichmentStatus: {
                ...existingStatus,
                series: 'completed',
              },
            });
            processedCount++;
            results.push({id: bookId, series: value});
          }

          const upsertDetailDoc = async (payload: Record<string, unknown>) => {
            const detailDocRef = detailsCollection.doc(bookId) as {
              set?: (
                data: Record<string, unknown>,
                opts?: {merge?: boolean},
              ) => Promise<unknown>;
              update?: (data: Record<string, unknown>) => Promise<unknown>;
            };
            if (typeof detailDocRef.set === 'function') {
              await detailDocRef.set(payload, {merge: true});
            } else if (typeof detailDocRef.update === 'function') {
              await detailDocRef.update(payload);
            }
          };

          if (metadataKey === MetadataKey.SYNOPSIS) {
            await Promise.all([
              booksCollection.doc(bookId).update({
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasSynopsis: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  synopsis: 'completed',
                },
              }),
              upsertDetailDoc({
                synopsis: value,
                updatedAt: new Date().toISOString(),
              }),
            ]);
            processedCount++;
            results.push({
              id: bookId,
              bookDetailsMetadata: {
                ...existingDetailsMeta,
                hasSynopsis: true,
              },
            });
          } else if (metadataKey === MetadataKey.AUTHOR_BIO) {
            await Promise.all([
              booksCollection.doc(bookId).update({
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasAuthorBio: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  authorBio: 'completed',
                },
              }),
              upsertDetailDoc({
                authorBio: value,
                updatedAt: new Date().toISOString(),
              }),
            ]);
            processedCount++;
            results.push({
              id: bookId,
              bookDetailsMetadata: {
                ...existingDetailsMeta,
                hasAuthorBio: true,
              },
            });
          } else if (metadataKey === MetadataKey.EMBEDDING) {
            await Promise.all([
              booksCollection.doc(bookId).update({
                bookDetailsMetadata: {
                  ...existingDetailsMeta,
                  hasEmbedding: true,
                },
                enrichmentStatus: {
                  ...existingStatus,
                  embedding: 'completed',
                },
              }),
              upsertDetailDoc({
                embedding: value,
                updatedAt: new Date().toISOString(),
              }),
            ]);
            processedCount++;
            results.push({
              id: bookId,
              bookDetailsMetadata: {
                ...existingDetailsMeta,
                hasEmbedding: true,
              },
            });
          }

          callbacks?.onBookProgress?.({
            bookId,
            stage: 'completed',
            winningProviders: {[statusKey]: providerLabel},
            updatedFields: [statusKey],
          });
        }),
      );

      return {
        status: 'success',
        enrichmentType: statusKey,
        processedCount,
        results,
      };
    } catch (err: unknown) {
      if (err instanceof TRPCError) {
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
