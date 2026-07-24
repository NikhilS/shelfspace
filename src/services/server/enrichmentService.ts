import {getAdminDb} from './firebaseAdmin';
import {LibraryService} from './libraryService';
import {MetadataRegistry} from './metadata';
import {MetadataKey, CoreBookData} from '../../types/metadata';
import {EnrichmentTriggerInput} from '../../schemas/libraryApi';

export interface EnrichmentItemResult {
  bookId: string;
  status: 'updated' | 'failed';
  errorCode?: number;
  errorMessage?: string;
  data?: unknown;
}

export interface EnrichmentTriggerResponse {
  status: 'success' | 'partial_success' | 'failed';
  enrichmentType: string;
  processedCount: number;
  results: EnrichmentItemResult[];
}

export class EnrichmentService {
  /**
   * Executes a batch enrichment pipeline over a set of book IDs within a library.
   */
  static async triggerBatchEnrichment(
    userId: string,
    userEmail: string | undefined,
    input: EnrichmentTriggerInput,
  ): Promise<EnrichmentTriggerResponse> {
    const {libraryId, bookIds, enrichmentType} = input;

    // 1. Verify editor or owner permission
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'editor',
    );

    // 2. Map enrichmentType to MetadataKey
    const keyMap: Record<string, MetadataKey> = {
      geo: MetadataKey.GEO,
      temporal: MetadataKey.TEMPORAL,
      genre: MetadataKey.GENRE,
      synopsis: MetadataKey.SYNOPSIS,
      coverImage: MetadataKey.COVER_IMAGE,
    };

    const targetKey = keyMap[enrichmentType];
    if (!targetKey) {
      throw new Error(`Unsupported enrichment type: '${enrichmentType}'`);
    }

    const registry = MetadataRegistry.getInstance();
    const provider = registry.getProvider(targetKey);

    if (!provider) {
      throw new Error(
        `No provider registered for enrichment type '${enrichmentType}'`,
      );
    }

    if (!provider.isAvailable()) {
      throw new Error(
        `Provider for '${enrichmentType}' is currently unavailable (missing configuration/keys)`,
      );
    }

    const db = getAdminDb();
    const results: EnrichmentItemResult[] = [];

    let totalUpdated = 0;
    let totalFailed = 0;

    // Process in parallel chunks of 10 to maintain high throughput while respecting rate limits
    const CHUNK_SIZE = 10;
    for (let i = 0; i < bookIds.length; i += CHUNK_SIZE) {
      const chunkIds = bookIds.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunkIds.map(async bookId => {
          const bookRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('books')
            .doc(bookId);

          let bookSnap;
          try {
            bookSnap = await bookRef.get();
          } catch (err: unknown) {
            const errorObj = err as {message?: string};
            results.push({
              bookId,
              status: 'failed',
              errorCode: 500,
              errorMessage: `Database read error: ${errorObj?.message || 'Unknown error'}`,
            });
            totalFailed++;
            return;
          }

          if (!bookSnap.exists) {
            results.push({
              bookId,
              status: 'failed',
              errorCode: 404,
              errorMessage: `Book '${bookId}' not found in library '${libraryId}'`,
            });
            totalFailed++;
            return;
          }

          const bookData = bookSnap.data() || {};
          const title = bookData.title;
          const author = bookData.author;

          if (!title || typeof title !== 'string' || !title.trim()) {
            results.push({
              bookId,
              status: 'failed',
              errorCode: 422,
              errorMessage: `Book '${bookId}' lacks required 'title' field for enrichment`,
            });
            totalFailed++;
            return;
          }

          const coreBook: CoreBookData = {
            id: bookId,
            title: title.trim(),
            author: author || 'Unknown Author',
            isbn: bookData.isbn,
          };

          let extractedData: unknown;
          try {
            extractedData = await provider.fetch(coreBook);
          } catch (fetchErr: unknown) {
            const errObj = fetchErr as {message?: string};
            const errStr = String(errObj?.message || fetchErr);
            const isTimeout =
              errStr.toLowerCase().includes('timeout') ||
              errStr.toLowerCase().includes('etimedout');

            results.push({
              bookId,
              status: 'failed',
              errorCode: isTimeout ? 504 : 502,
              errorMessage: `Provider fetch failed: ${errStr}`,
            });
            totalFailed++;
            return;
          }

          if (!extractedData) {
            results.push({
              bookId,
              status: 'failed',
              errorCode: 422,
              errorMessage: `Provider returned no metadata for book '${bookId}'`,
            });
            totalFailed++;
            return;
          }

          // Write updated metadata back to Firestore
          const updatePayload: Record<string, unknown> = {
            updatedAt: new Date().toISOString(),
          };

          if (enrichmentType === 'geo') {
            updatePayload.geoMetadata = extractedData;
          } else if (enrichmentType === 'temporal') {
            updatePayload.temporalMetadata = extractedData;
          } else if (enrichmentType === 'genre') {
            updatePayload.genre = extractedData;
            updatePayload.genres = extractedData;
          } else if (enrichmentType === 'synopsis') {
            updatePayload.synopsis = extractedData;
          } else if (enrichmentType === 'coverImage') {
            updatePayload.coverUrl = extractedData;
            updatePayload.coverUrlRaw = extractedData;
          }

          try {
            await bookRef.update(updatePayload);
            results.push({
              bookId,
              status: 'updated',
              data: extractedData,
            });
            totalUpdated++;
          } catch (writeErr: unknown) {
            const writeErrObj = writeErr as {message?: string};
            results.push({
              bookId,
              status: 'failed',
              errorCode: 500,
              errorMessage: `Database write error: ${writeErrObj?.message || 'Unknown error'}`,
            });
            totalFailed++;
          }
        }),
      );
    }

    const overallStatus =
      totalFailed === 0
        ? 'success'
        : totalUpdated > 0
          ? 'partial_success'
          : 'failed';

    return {
      status: overallStatus,
      enrichmentType,
      processedCount: bookIds.length,
      results,
    };
  }
}
