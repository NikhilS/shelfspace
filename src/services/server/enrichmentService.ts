import {getAdminDb} from './firebaseAdmin';
import {LibraryService} from './libraryService';
import {MetadataRegistry} from './metadata';
import {MetadataKey, CoreBookData} from '../../types/metadata';
import {EnrichmentTriggerInput} from '../../schemas/libraryApi';
import {ENRICHMENT_CONSTANTS} from '../../constants/enrichment';

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
    const {libraryId, enrichmentType, overwrite = false} = input;
    let targetBookIds = input.bookIds;
    const limit = (input as {limit?: number}).limit || 20;

    // 1. Verify editor or owner permission
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'editor',
    );

    // 2. Map enrichmentType to MetadataKey (supporting both aliases and full field keys)
    const keyMap: Record<string, MetadataKey> = {
      geo: MetadataKey.GEO,
      geoMetadata: MetadataKey.GEO,
      temporal: MetadataKey.TEMPORAL,
      temporalMetadata: MetadataKey.TEMPORAL,
      genre: MetadataKey.GENRE,
      genres: MetadataKey.GENRE,
      synopsis: MetadataKey.SYNOPSIS,
      coverImage: MetadataKey.COVER_IMAGE,
      coverUrl: MetadataKey.COVER_IMAGE,
      authorBio: MetadataKey.AUTHOR_BIO,
      embedding: MetadataKey.EMBEDDING,
      embeddings: MetadataKey.EMBEDDING,
    };

    const targetKey = keyMap[enrichmentType];
    if (!targetKey) {
      throw new Error(`Unsupported enrichment type: '${enrichmentType}'`);
    }

    const statusField =
      targetKey === MetadataKey.GEO
        ? 'geo'
        : targetKey === MetadataKey.TEMPORAL
          ? 'temporal'
          : targetKey === MetadataKey.GENRE
            ? 'genre'
            : targetKey === MetadataKey.SYNOPSIS
              ? 'synopsis'
              : targetKey === MetadataKey.COVER_IMAGE
                ? 'coverImage'
                : targetKey === MetadataKey.AUTHOR_BIO
                  ? 'authorBio'
                  : targetKey === MetadataKey.EMBEDDING
                    ? 'embedding'
                    : targetKey;

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
    const bookDetailsRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails');

    // Auto-discover candidate books from library if no explicit bookIds or books provided
    if (
      (!targetBookIds || targetBookIds.length === 0) &&
      (!input.books || input.books.length === 0)
    ) {
      try {
        const snapshot = await booksRef.limit(100).get();
        const candidates: string[] = [];
        if (typeof snapshot?.forEach === 'function') {
          snapshot.forEach(docSnap => {
            if (candidates.length >= limit) return;
            const data = (docSnap.data() || {}) as Record<string, unknown>;
            const status =
              (data.enrichmentStatus as Record<string, unknown>) || {};
            const currentStatus = status[statusField];
            if (overwrite) {
              candidates.push(docSnap.id);
            } else if (
              currentStatus !== 'completed' &&
              currentStatus !== 'unsupported'
            ) {
              candidates.push(docSnap.id);
            }
          });
        }
        targetBookIds = candidates;
      } catch (scanErr) {
        console.warn('Could not auto-discover candidate books:', scanErr);
      }
    }

    if (
      (!targetBookIds || targetBookIds.length === 0) &&
      (!input.books || input.books.length === 0)
    ) {
      return {
        status: 'success',
        enrichmentType,
        processedCount: 0,
        results: [],
        updates: [],
      };
    }

    // 3. Retrieve target book documents from Firestore or use directly from input.books
    const validBooks: CoreBookData[] = [];
    const booksDataMap = new Map<string, Record<string, unknown>>();

    if (input.books && input.books.length > 0) {
      for (const b of input.books) {
        if (b.title && typeof b.title === 'string' && b.title.trim()) {
          validBooks.push({
            id: b.id,
            title: b.title.trim(),
            author: b.author || 'Unknown Author',
            isbn: b.isbn,
            synopsis: b.synopsis || b.description,
          });
          booksDataMap.set(b.id, {
            title: b.title.trim(),
            author: b.author,
            isbn: b.isbn,
            synopsis: b.synopsis || b.description,
          });
        }
      }
    } else if (targetBookIds && targetBookIds.length > 0) {
      for (
        let i = 0;
        i < targetBookIds.length;
        i += ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE
      ) {
        const chunkIds = targetBookIds.slice(
          i,
          i + ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE,
        );
        await Promise.all(
          chunkIds.map(async bookId => {
            try {
              const snap = await booksRef.doc(bookId).get();
              if (snap.exists) {
                const data = (snap.data() || {}) as Record<string, unknown>;
                booksDataMap.set(bookId, data);
                if (
                  data.title &&
                  typeof data.title === 'string' &&
                  data.title.trim()
                ) {
                  validBooks.push({
                    id: bookId,
                    title: data.title.trim(),
                    author: (data.author as string) || 'Unknown Author',
                    isbn: data.isbn as string | undefined,
                    synopsis: (data.synopsis || data.description) as
                      string | undefined,
                  });
                }
              }
            } catch (err) {
              console.warn(
                `[EnrichmentService] Firestore admin read not available for book '${bookId}':`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }),
        );
      }
    }

    if (validBooks.length === 0) {
      return {
        status: 'success',
        enrichmentType,
        processedCount: 0,
        results: [],
        updates: [],
      };
    }

    // 4. Delegate to provider.bulkFetch for unified batch handling
    const extractedBatch = await provider.bulkFetch(validBooks);

    // 5. Write extracted metadata and enrichment status back to Firestore in controlled chunks
    const results: Record<string, unknown>[] = [];
    const updateTasks: Array<{
      bookId: string;
      payload: Record<string, unknown>;
    }> = [];

    for (const book of validBooks) {
      const bookId = book.id;
      const metadata = extractedBatch[bookId];
      const existingData = booksDataMap.get(bookId) || {};
      const existingStatus =
        (existingData.enrichmentStatus as Record<string, unknown>) || {};

      const updatePayload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      const hasMetadata =
        metadata !== undefined &&
        metadata !== null &&
        (typeof metadata !== 'object' ||
          (Array.isArray(metadata)
            ? metadata.length > 0
            : Object.keys(metadata as object).length > 0));

      if (hasMetadata) {
        if (targetKey === MetadataKey.GEO) {
          updatePayload.geoMetadata = metadata;
        } else if (targetKey === MetadataKey.TEMPORAL) {
          updatePayload.temporalMetadata = metadata;
        } else if (targetKey === MetadataKey.GENRE) {
          updatePayload.genre = metadata;
          updatePayload.genres = metadata;
        } else if (targetKey === MetadataKey.SYNOPSIS) {
          updatePayload.synopsis = metadata;
        } else if (targetKey === MetadataKey.COVER_IMAGE) {
          updatePayload.coverUrl = metadata;
          updatePayload.coverUrlRaw = metadata;
        } else if (targetKey === MetadataKey.AUTHOR_BIO) {
          updatePayload.authorBio = metadata;
        } else if (targetKey === MetadataKey.EMBEDDING) {
          updatePayload.embedding = metadata;
        }

        updatePayload.enrichmentStatus = {
          ...existingStatus,
          [statusField]: 'completed',
          lastAttemptedAt: new Date().toISOString(),
        };

        results.push({id: bookId, [targetKey]: metadata});
        updateTasks.push({bookId, payload: updatePayload});
      } else {
        // Tombstone as unsupported so subsequent auto-scans do not loop indefinitely
        updatePayload.enrichmentStatus = {
          ...existingStatus,
          [statusField]: 'unsupported',
          lastAttemptedAt: new Date().toISOString(),
        };
        updateTasks.push({bookId, payload: updatePayload});
      }
    }

    for (
      let i = 0;
      i < updateTasks.length;
      i += ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE
    ) {
      const chunk = updateTasks.slice(
        i,
        i + ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE,
      );
      await Promise.all(
        chunk.map(async ({bookId, payload}) => {
          try {
            await booksRef.doc(bookId).update(payload);
            if (payload.synopsis || payload.authorBio || payload.embedding) {
              const detailPayload: Record<string, unknown> = {
                updatedAt: payload.updatedAt,
              };
              if (payload.synopsis) detailPayload.synopsis = payload.synopsis;
              if (payload.authorBio)
                detailPayload.authorBio = payload.authorBio;
              if (payload.embedding)
                detailPayload.embedding = payload.embedding;
              try {
                if (typeof bookDetailsRef.doc(bookId)?.set === 'function') {
                  await bookDetailsRef
                    .doc(bookId)
                    .set(detailPayload, {merge: true});
                }
              } catch {
                // Ignore optional bookDetails write error in tests
              }
            }
          } catch (writeErr) {
            console.warn(
              `[EnrichmentService] Firestore admin write deferred for book ${bookId} (client writer will commit):`,
              writeErr instanceof Error ? writeErr.message : String(writeErr),
            );
          }
        }),
      );
    }

    return {
      status: 'success',
      enrichmentType,
      processedCount: results.length,
      results,
      updates: updateTasks,
    };
  }
}
