import {getAdminDb} from './firebaseAdmin';
import {LibraryService} from './libraryService';
import {MetadataRegistry} from './metadata';
import {MetadataKey, CoreBookData} from '../../types/metadata';
import {EnrichmentTriggerInput} from '../../schemas/libraryApi';

export interface EnrichmentTriggerResponse {
  status: 'success' | 'failed';
  enrichmentType: string;
  processedCount: number;
  results: Record<string, unknown>[];
}

export class EnrichmentService {
  /**
   * Executes a batch enrichment pipeline over a set of book IDs within a library.
   * Delegates directly to provider.bulkFetch for unified batch handling.
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
      authorBio: MetadataKey.AUTHOR_BIO,
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
    const booksRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books');

    // 3. Retrieve target book documents from Firestore
    const validBooks: CoreBookData[] = [];
    await Promise.all(
      bookIds.map(async bookId => {
        try {
          const snap = await booksRef.doc(bookId).get();
          if (snap.exists) {
            const data = snap.data() || {};
            if (
              data.title &&
              typeof data.title === 'string' &&
              data.title.trim()
            ) {
              validBooks.push({
                id: bookId,
                title: data.title.trim(),
                author: data.author || 'Unknown Author',
                isbn: data.isbn,
                synopsis: data.synopsis || data.description,
              });
            }
          }
        } catch (err) {
          console.error(`Error reading book '${bookId}' for enrichment:`, err);
        }
      }),
    );

    if (validBooks.length === 0) {
      return {
        status: 'success',
        enrichmentType,
        processedCount: 0,
        results: [],
      };
    }

    // 4. Delegate to provider.bulkFetch for unified batch handling
    const extractedBatch = await provider.bulkFetch(validBooks);

    // 5. Write extracted metadata back to Firestore for each book
    const results: Record<string, unknown>[] = [];
    await Promise.all(
      Object.entries(extractedBatch).map(async ([bookId, metadata]) => {
        if (!metadata) return;

        const updatePayload: Record<string, unknown> = {
          updatedAt: new Date().toISOString(),
        };

        if (enrichmentType === 'geo') {
          updatePayload.geoMetadata = metadata;
        } else if (enrichmentType === 'temporal') {
          updatePayload.temporalMetadata = metadata;
        } else if (enrichmentType === 'genre') {
          updatePayload.genre = metadata;
          updatePayload.genres = metadata;
        } else if (enrichmentType === 'synopsis') {
          updatePayload.synopsis = metadata;
        } else if (enrichmentType === 'coverImage') {
          updatePayload.coverUrl = metadata;
          updatePayload.coverUrlRaw = metadata;
        } else if (enrichmentType === 'authorBio') {
          updatePayload.authorBio = metadata;
        }

        try {
          await booksRef.doc(bookId).update(updatePayload);
          results.push({id: bookId, [targetKey]: metadata});
        } catch (writeErr) {
          console.error(`Database write error for book ${bookId}:`, writeErr);
        }
      }),
    );

    return {
      status: 'success',
      enrichmentType,
      processedCount: results.length,
      results,
    };
  }
}
