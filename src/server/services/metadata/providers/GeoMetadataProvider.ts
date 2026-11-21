import {z} from 'zod';
import {GEO_CONFIDENCE_THRESHOLD} from '../../../../constants/enrichment';
import {findGazetteerPlaceByName} from '../../../../constants/literaryGazetteer';
import {
  bookGeoMetadataSchema,
  type BookGeoMetadata,
} from '../../../../schemas/book';
import {
  type CoreBookData,
  type EnrichmentPipelineStage,
  type MetadataBulkFetchOptions,
  MetadataKey,
  type MetadataPersistenceContext,
  type MetadataPersistencePatch,
  type MetadataPlugin,
  type StageBookOutcome,
} from '../../../../types/metadata';
import {
  type BatchExtractedGeoBookResult,
  type ExtractedGeoLocation,
  extractBookGeoMetadataBatch,
} from '../../gemini';
import {
  cacheGeocodesBulk,
  geocodeLocation,
  getCachedGeocode,
  warmGeocodeCacheBulk,
} from '../../geolocation';
import {hydrateCatalogForResidualBooks} from '../bonusCatalogPatcher';
import {runPluginStagesToRecord} from '../stageRunner';

const geoPluginOutputSchema: z.ZodType<BookGeoMetadata | null> =
  bookGeoMetadataSchema.nullable();

function extractExistingSynopsis(book?: CoreBookData): string | undefined {
  if (!book) {
    return undefined;
  }
  const raw = book.synopsis;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

const EFFECTIVE_GEO_CONFIDENCE_THRESHOLD = GEO_CONFIDENCE_THRESHOLD;

export class GeoMetadataProvider implements MetadataPlugin<BookGeoMetadata | null> {
  readonly statusKey = 'geo' as const;
  readonly needsSynopsis = true;
  readonly supportsHybridAiFallback = false;
  readonly outputSchema = geoPluginOutputSchema;

  readonly stages: ReadonlyArray<
    EnrichmentPipelineStage<BookGeoMetadata | null>
  > = [
    {
      id: 'geo-decision',
      tier: 'decision',
      execute: async ({books, options}) => {
        const outcomes = new Map<
          string,
          StageBookOutcome<BookGeoMetadata | null>
        >();
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false
        ) {
          return outcomes;
        }

        const bookById = new Map(books.map(b => [b.id, b]));
        const batchedBooks = books.map(b => ({
          id: b.id,
          title: b.title,
          author: b.author,
          synopsis: extractExistingSynopsis(b),
        }));

        const evaluated = await this.evaluateGeoBatchInChunks(
          batchedBooks,
          options,
        );
        const confidenceThreshold = EFFECTIVE_GEO_CONFIDENCE_THRESHOLD;

        for (const [bookId, entry] of evaluated.entries()) {
          const sourceBook = bookById.get(bookId);
          const hasSavedSynopsis = Boolean(extractExistingSynopsis(sourceBook));
          const isLowConfidence =
            typeof entry.confidence === 'number' &&
            entry.confidence < confidenceThreshold;

          if (!hasSavedSynopsis && isLowConfidence) {
            outcomes.set(bookId, {
              status: 'escalate',
              fallbackValue: entry.metadata,
            });
          } else {
            outcomes.set(bookId, {
              status: 'resolved',
              value: entry.metadata,
              winningProvider: 'gemini_decisions',
            });
          }
        }

        return outcomes;
      },
    },
    {
      id: 'geo-catalog-repass',
      tier: 'catalog',
      execute: async ({books, options, priorEscalations}) => {
        const outcomes = new Map<
          string,
          StageBookOutcome<BookGeoMetadata | null>
        >();
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false
        ) {
          return outcomes;
        }

        const catalogMap = await hydrateCatalogForResidualBooks(books, {
          signal: options?.signal,
          verifyCovers: false,
          preferField: 'synopsis',
        });

        if (options?.signal?.aborted) {
          return outcomes;
        }

        const booksForRepass: Array<{
          id: string;
          title: string;
          author: string;
          synopsis: string;
        }> = [];

        for (const book of books) {
          const catalogHit = catalogMap.get(book.id);
          const hydratedSynopsis = catalogHit?.details?.synopsis?.trim();
          const priorFallback = priorEscalations?.get(book.id)?.fallbackValue;

          if (hydratedSynopsis && hydratedSynopsis.length > 0) {
            booksForRepass.push({
              id: book.id,
              title: book.title,
              author: book.author,
              synopsis: hydratedSynopsis,
            });
          } else if (priorFallback !== undefined) {
            outcomes.set(book.id, {
              status: 'resolved',
              value: priorFallback,
              winningProvider: 'gemini_decisions',
              ...(catalogHit?.bonusCatalog
                ? {bonusCatalog: catalogHit.bonusCatalog}
                : {}),
            });
          }
        }

        if (booksForRepass.length > 0 && !options?.signal?.aborted) {
          const repassed = await this.evaluateGeoBatchInChunks(
            booksForRepass,
            options,
          );
          for (const b of booksForRepass) {
            const refreshed = repassed.get(b.id);
            const catalogHit = catalogMap.get(b.id);
            const priorFallback = priorEscalations?.get(b.id)?.fallbackValue;
            if (refreshed) {
              outcomes.set(b.id, {
                status: 'resolved',
                value: refreshed.metadata,
                winningProvider: 'gemini_decisions',
                ...(catalogHit?.bonusCatalog
                  ? {bonusCatalog: catalogHit.bonusCatalog}
                  : {}),
              });
            } else if (priorFallback !== undefined) {
              outcomes.set(b.id, {
                status: 'resolved',
                value: priorFallback,
                winningProvider: 'gemini_decisions',
                ...(catalogHit?.bonusCatalog
                  ? {bonusCatalog: catalogHit.bonusCatalog}
                  : {}),
              });
            }
          }
        }

        return outcomes;
      },
    },
  ];

  getKey(): MetadataKey {
    return MetadataKey.GEO;
  }

  private async evaluateGeoBatchInChunks(
    batchedBooks: Array<{
      id: string;
      title: string;
      author: string;
      synopsis?: string;
    }>,
    options?: MetadataBulkFetchOptions,
  ): Promise<Map<string, {metadata: BookGeoMetadata; confidence?: number}>> {
    const CHUNK_SIZE = 10;
    const evaluated = new Map<
      string,
      {metadata: BookGeoMetadata; confidence?: number}
    >();
    const chunks: Array<typeof batchedBooks> = [];

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      chunks.push(batchedBooks.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map(async chunk => {
        if (options?.signal?.aborted) {
          return;
        }
        const geoResult = await extractBookGeoMetadataBatch(chunk, {
          priority: 'BATCH',
          signal: options?.signal,
          includeConfidence: true,
        });

        if (geoResult && geoResult.enrichment) {
          const unresolvedLocationNames: string[] = [];
          for (const item of geoResult.enrichment) {
            if (!item.isNonEarth && Array.isArray(item.locations)) {
              for (const loc of item.locations.slice(0, 5)) {
                if (
                  loc?.name &&
                  !loc.coordinates &&
                  !findGazetteerPlaceByName(loc.name)
                ) {
                  unresolvedLocationNames.push(loc.name);
                }
              }
            }
          }

          if (unresolvedLocationNames.length > 0) {
            await warmGeocodeCacheBulk(unresolvedLocationNames);
          }

          const pendingCacheEntries: Array<{
            name: string;
            coordinates: {lat: number; lng: number};
          }> = [];

          await Promise.all(
            geoResult.enrichment.map(
              async (item: BatchExtractedGeoBookResult) => {
                if (options?.signal?.aborted || !item.id) {
                  return;
                }
                const metadata = await this.processLocations(
                  item,
                  pendingCacheEntries,
                );
                evaluated.set(item.id, {
                  metadata,
                  confidence: item.confidence,
                });
              },
            ),
          );

          if (pendingCacheEntries.length > 0) {
            await cacheGeocodesBulk(pendingCacheEntries);
          }
        }
      }),
    );

    return evaluated;
  }

  private async processLocations(
    item: {
      isNonEarth: boolean;
      locations: ExtractedGeoLocation[] | undefined;
    },
    pendingCacheEntries?: Array<{
      name: string;
      coordinates: {lat: number; lng: number};
    }>,
  ): Promise<BookGeoMetadata> {
    if (item.isNonEarth) {
      return {
        isNonEarth: true,
        locations: [],
        lastSyncedAt: new Date().toISOString(),
      };
    }

    const rawLocations = (item.locations || []).slice(0, 5);
    const locationsWithCoords = await Promise.all(
      rawLocations.map(async loc => {
        const gazetteerCoords =
          loc.coordinates ?? findGazetteerPlaceByName(loc.name)?.coordinates;

        let coords: {lat: number; lng: number} | null | undefined =
          gazetteerCoords;

        if (!coords) {
          const preCached = pendingCacheEntries
            ? await getCachedGeocode(loc.name, {skipL2Read: true})
            : undefined;
          coords =
            preCached ??
            (await geocodeLocation(
              loc.name,
              pendingCacheEntries
                ? {skipPersist: true, skipL2Read: true}
                : undefined,
            ));

          if (coords && !preCached && pendingCacheEntries) {
            pendingCacheEntries.push({name: loc.name, coordinates: coords});
          }
        }

        if (!coords) {
          const staticDict: Record<string, {lat: number; lng: number}> = {
            'paris, france': {lat: 48.8566, lng: 2.3522},
            'kyoto, japan': {lat: 35.0116, lng: 135.7681},
            'delhi, india': {lat: 28.6139, lng: 77.209},
            'kyiv, ukraine': {lat: 50.4501, lng: 30.5234},
            'new york, ny, usa': {lat: 40.7128, lng: -74.006},
            'london, uk': {lat: 51.5074, lng: -0.1278},
            'karachi, pakistan': {lat: 24.8607, lng: 67.0011},
            'bombay, india': {lat: 18.975, lng: 72.8258},
            'mumbai, india': {lat: 18.975, lng: 72.8258},
            'gettysburg, pa, usa': {lat: 39.8309, lng: -77.2311},
            'rome, italy': {lat: 41.9028, lng: 12.4964},
          };
          const lowerKey = loc.name.toLowerCase().trim();
          if (staticDict[lowerKey]) {
            coords = staticDict[lowerKey];
          } else {
            for (const [key, val] of Object.entries(staticDict)) {
              if (lowerKey.includes(key) || key.includes(lowerKey)) {
                coords = val;
                break;
              }
            }
          }
        }

        return {
          name: loc.name,
          adminLevel: loc.adminLevel,
          rationale: loc.rationale,
          ...(coords ? {coordinates: coords} : {}),
        };
      }),
    );

    return {
      isNonEarth: false,
      locations: locationsWithCoords,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<BookGeoMetadata | null> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || null;
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, BookGeoMetadata | null>> {
    return runPluginStagesToRecord(this.stages, books, options);
  }

  toPersistencePatch({
    book,
    value,
    existingStatus,
  }: MetadataPersistenceContext<BookGeoMetadata | null>): MetadataPersistencePatch {
    const resolvedStatus = value?.isNonEarth ? 'unsupported' : 'completed';
    return {
      bookUpdate: {
        geoMetadata: value,
        enrichmentStatus: {
          ...existingStatus,
          geo: resolvedStatus,
        },
      },
      resultPreview: {
        id: book.id,
        geoMetadata: value,
      },
    };
  }

  shouldFetchOnCreate(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }
}
