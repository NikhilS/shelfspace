import {trpcVanilla} from '../../lib/trpc';
import {Book} from '../../types';

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
