import {trpcVanilla} from './trpc';
import {Book} from '../types';

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

export function needsIndexBackfill(
  book: Book | Record<string, unknown>,
): boolean {
  const rec = book as Record<string, unknown>;
  const hasDedupeKey =
    typeof rec.dedupeKey === 'string' && rec.dedupeKey.length > 0;
  const hasSearchTokens =
    rec.hasSearchTokens === true ||
    (Array.isArray(rec.searchTokens) && rec.searchTokens.length > 0);
  const hasUnindexedIsbn =
    typeof rec.isbn === 'string' &&
    rec.isbn.trim().length > 0 &&
    (!rec.cleanIsbn || typeof rec.cleanIsbn !== 'string');
  return !hasDedupeKey || !hasSearchTokens || hasUnindexedIsbn;
}

export function needsStorageOptimization(
  book: Book | Record<string, unknown>,
): boolean {
  return hasHeavyLeaks(book) || needsIndexBackfill(book);
}

export async function sanitizeBookStorage(
  libraryId: string,
  books?: Book[],
  onProgress?: (progress: {completed: number; total: number}) => void,
): Promise<SanitizeStorageResult> {
  const result = await trpcVanilla.library.resetMetadata.mutate({
    libraryId,
    metadataType: 'sanitize',
  });

  const count = result?.count || 0;
  if (onProgress) {
    onProgress({completed: count, total: count});
  }

  return {
    scannedCount: books?.length || count,
    sanitizedCount: count,
    purgedFieldsCount: count,
  };
}
