import {collection, doc, getDocs, deleteField} from 'firebase/firestore';
import {db} from '../../firebase';
import {ClientBulkWriter} from '../../lib/clientBulkWriter';
import {Book, BookDetailsMetadata} from '../../types';

export interface SanitizeStorageResult {
  scannedCount: number;
  sanitizedCount: number;
  purgedFieldsCount: number;
}

const LEAKED_FIELDS = [
  'synopsis',
  'authorBio',
  'embedding',
  'clusterCoordinates',
  'description',
  'genre',
  '_inBooks',
] as const;

export function hasHeavyLeaks(book: Book | Record<string, unknown>): boolean {
  return LEAKED_FIELDS.some(
    field => (book as Record<string, unknown>)[field] !== undefined,
  );
}

export async function sanitizeBookStorage(
  libraryId: string,
  books?: Book[],
  onProgress?: (progress: {completed: number; total: number}) => void,
): Promise<SanitizeStorageResult> {
  let booksToSanitize = books && books.length > 0 ? books : [];
  if (booksToSanitize.length === 0) {
    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const snap = await getDocs(booksRef);
    booksToSanitize = snap.docs.map(d => ({...d.data(), id: d.id}) as Book);
  }

  const writer = new ClientBulkWriter(db, 100);
  let sanitizedCount = 0;
  let purgedFieldsCount = 0;

  for (let i = 0; i < booksToSanitize.length; i++) {
    const b = booksToSanitize[i];
    const raw = b as Record<string, unknown>;
    const needsPurge = hasHeavyLeaks(b);
    const existingMeta = b.bookDetailsMetadata || {};

    const hasRawSynopsis =
      typeof raw.synopsis === 'string' && raw.synopsis.trim().length > 0;
    const hasRawDescription =
      typeof raw.description === 'string' && raw.description.trim().length > 0;
    const hasRawBio =
      typeof raw.authorBio === 'string' && raw.authorBio.trim().length > 0;
    const hasRawEmbedding =
      Array.isArray(raw.embedding) && raw.embedding.length > 0;
    const hasRawCluster =
      raw.clusterCoordinates !== undefined && raw.clusterCoordinates !== null;

    const synopsisToSave = raw.synopsis || raw.description;

    const updatedMetadata: BookDetailsMetadata = {
      ...existingMeta,
      hasSynopsis: Boolean(
        existingMeta.hasSynopsis || hasRawSynopsis || hasRawDescription,
      ),
      hasAuthorBio: Boolean(existingMeta.hasAuthorBio || hasRawBio),
      hasEmbedding: Boolean(existingMeta.hasEmbedding || hasRawEmbedding),
      hasClusterCoordinates: Boolean(
        existingMeta.hasClusterCoordinates || hasRawCluster,
      ),
    };

    if (needsPurge) {
      // 1. Ensure bookDetails document has the heavy data saved
      const detailPayload: Record<string, unknown> = {};
      if (hasRawSynopsis || hasRawDescription) {
        detailPayload.synopsis = synopsisToSave;
      }
      if (hasRawBio) {
        detailPayload.authorBio = raw.authorBio;
      }
      if (hasRawEmbedding) {
        detailPayload.embedding = raw.embedding;
      }
      if (hasRawCluster) {
        detailPayload.clusterCoordinates = raw.clusterCoordinates;
      }

      if (Object.keys(detailPayload).length > 0) {
        detailPayload.updatedAt = new Date().toISOString();
        const detailRef = doc(db, 'libraries', libraryId, 'bookDetails', b.id);
        writer.set(detailRef, detailPayload, {merge: true});
      }

      // 2. Prepare update payload for core book doc with deleteField() for all leaked fields
      const bookUpdatePayload: Record<string, unknown> = {
        bookDetailsMetadata: updatedMetadata,
        updatedAt: new Date().toISOString(),
      };

      for (const field of LEAKED_FIELDS) {
        if (raw[field] !== undefined) {
          bookUpdatePayload[field] = deleteField();
          purgedFieldsCount++;
        }
      }

      const bookRef = doc(db, 'libraries', libraryId, 'books', b.id);
      writer.update(bookRef, bookUpdatePayload);
      sanitizedCount++;
    } else if (!b.bookDetailsMetadata) {
      // Initialize bookDetailsMetadata if not present
      const bookRef = doc(db, 'libraries', libraryId, 'books', b.id);
      writer.update(bookRef, {
        bookDetailsMetadata: updatedMetadata,
      });
      sanitizedCount++;
    }

    if (onProgress) {
      onProgress({completed: i + 1, total: booksToSanitize.length});
    }
  }

  await writer.close();

  return {
    scannedCount: booksToSanitize.length,
    sanitizedCount,
    purgedFieldsCount,
  };
}
