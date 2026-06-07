import {useSpruceUpIntegrity} from './useSpruceUpIntegrity';
import {useSpruceUpDeduplicator} from './useSpruceUpDeduplicator';
import {useSpruceUpMetadataFiller} from './useSpruceUpMetadataFiller';

export function useSpruceUp(libraryId: string | undefined) {
  const integrity = useSpruceUpIntegrity(libraryId);
  const deduplicator = useSpruceUpDeduplicator(
    libraryId,
    integrity.booksWithDetails,
  );
  const metadataFiller = useSpruceUpMetadataFiller({
    libraryId,
    booksWithDetails: integrity.booksWithDetails,
    selectedIds: integrity.selectedIds,
    setBooks: integrity.setBooks,
    setBookDetailsMap: integrity.setBookDetailsMap,
    activeJob: integrity.activeJob,
    missingMetadata: integrity.missingMetadata,
  });

  const loading = integrity.integrityLoading || deduplicator.allowedLoading;

  return {
    ...integrity,
    ...deduplicator,
    ...metadataFiller,
    loading,
  };
}
