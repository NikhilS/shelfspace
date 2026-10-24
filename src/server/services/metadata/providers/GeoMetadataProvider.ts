import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {
  extractBookGeoMetadataBatch,
  BatchExtractedGeoBookResult,
  ExtractedGeoLocation,
} from '../../gemini';
import {
  geocodeLocation,
  getCachedGeocode,
  warmGeocodeCacheBulk,
  cacheGeocodesBulk,
} from '../../geolocation';
import {resolveBookSynopses} from '../utils';

export class GeoMetadataProvider implements IMetadataProvider<unknown> {
  getKey(): MetadataKey {
    return MetadataKey.GEO;
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
  ) {
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
        const preCached = pendingCacheEntries
          ? await getCachedGeocode(loc.name, {skipL2Read: true})
          : undefined;
        let coords =
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

        // Fallback geocoding dictionary
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
  ): Promise<unknown> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || null;
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, unknown>> {
    if (options?.signal?.aborted || options?.allowAiFallback === false) {
      return {};
    }
    const synopsisMap = await resolveBookSynopses(books, options);
    if (options?.signal?.aborted) {
      return {};
    }

    const batchedBooks = books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      synopsis: synopsisMap.get(b.id),
    }));

    const CHUNK_SIZE = 10;
    const results: Record<string, unknown> = {};
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
        });

        if (geoResult && geoResult.enrichment) {
          const allLocationNames: string[] = [];
          for (const item of geoResult.enrichment) {
            if (!item.isNonEarth && Array.isArray(item.locations)) {
              for (const loc of item.locations.slice(0, 5)) {
                if (loc?.name) {
                  allLocationNames.push(loc.name);
                }
              }
            }
          }

          if (allLocationNames.length > 0) {
            await warmGeocodeCacheBulk(allLocationNames);
          }

          const pendingCacheEntries: Array<{
            name: string;
            coordinates: {lat: number; lng: number};
          }> = [];

          await Promise.all(
            geoResult.enrichment.map(
              async (item: BatchExtractedGeoBookResult) => {
                if (options?.signal?.aborted) {
                  return;
                }
                if (item.id) {
                  results[item.id] = await this.processLocations(
                    item,
                    pendingCacheEntries,
                  );
                }
              },
            ),
          );

          if (pendingCacheEntries.length > 0) {
            await cacheGeocodesBulk(pendingCacheEntries);
          }
        }
      }),
    );

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false; // Typically a tier 2 / batch op
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
