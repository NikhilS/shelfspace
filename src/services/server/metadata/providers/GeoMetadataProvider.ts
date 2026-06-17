import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {
  extractBookGeoMetadata,
  extractBookGeoMetadataBatch,
  BatchExtractedGeoBookResult,
} from '../../gemini';
import {MetadataRegistry} from '../registry';
import {geocodeLocation} from '../../geolocation';

export class GeoMetadataProvider implements IMetadataProvider<unknown> {
  getKey(): MetadataKey {
    return MetadataKey.GEO;
  }

  private async getSynopsis(book: CoreBookData): Promise<string | undefined> {
    if ('synopsis' in book)
      return (book as Record<string, unknown>).synopsis as string | undefined;
    const synopsisProvider = MetadataRegistry.getInstance().getProvider(
      MetadataKey.SYNOPSIS,
    );
    return synopsisProvider ? await synopsisProvider.fetch(book) : undefined;
  }

  private async processLocations(item: BatchExtractedGeoBookResult) {
    if (item.isNonEarth) {
      return {
        isNonEarth: true,
        locations: [],
        lastSyncedAt: new Date().toISOString(),
      };
    }

    const locationsWithCoords = [];
    for (const loc of item.locations || []) {
      let coords = await geocodeLocation(loc.name);

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

      locationsWithCoords.push({
        name: loc.name,
        adminLevel: loc.adminLevel,
        rationale: loc.rationale,
        ...(coords ? {coordinates: coords} : {}),
      });
    }

    return {
      isNonEarth: false,
      locations: locationsWithCoords.slice(0, 5),
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async fetch(book: CoreBookData): Promise<unknown> {
    const synopsis = await this.getSynopsis(book);
    const result = await extractBookGeoMetadata(
      book.title,
      book.author,
      synopsis,
    );
    if (!result) return null;
    return await this.processLocations(result);
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, unknown>> {
    const batchedBooks = await Promise.all(
      books.map(async b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        synopsis: await this.getSynopsis(b),
      })),
    );

    const geoResult = await extractBookGeoMetadataBatch(batchedBooks);

    const results: Record<string, unknown> = {};
    if (geoResult && geoResult.enrichment) {
      await Promise.all(
        geoResult.enrichment.map(async (item: BatchExtractedGeoBookResult) => {
          if (item.id) {
            results[item.id] = await this.processLocations(item);
          }
        }),
      );
    }
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false; // Typically a tier 2 / batch op
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
