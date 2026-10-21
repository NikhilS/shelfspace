import {useState} from 'react';
import {BookDetails} from '../../types';
import {toast} from 'sonner';
import {triggerHaptics, normalizeBookDetails} from '../../lib/utils';
import {uploadBase64Image} from '../../lib/storage';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {useAuth} from '../../stores/authStore';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import type {TrackedShelfStatus} from '../../server/services/readingTracker';

const MAX_CONCURRENT_IMAGE_UPLOADS = 3;

function generateBookId(index: number): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return `book_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runLane = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  };

  const lanes = Array.from({length: Math.min(concurrency, items.length)}, () =>
    runLane(),
  );
  await Promise.all(lanes);
  return results;
}

export interface UseAddBooksOptions {
  mode?: 'library' | 'reading';
  initialStatus?: TrackedShelfStatus | 'unset';
}

export function useAddBooks(libraryId?: string, options?: UseAddBooksOptions) {
  const {user} = useAuth();
  const isOnline = useOnlineStatus();
  const utils = trpc.useUtils();
  const [isAddingAll, setIsAddingAll] = useState(false);

  const isReadingMode =
    options?.mode === 'reading' ||
    !libraryId ||
    libraryId.startsWith('virtual_');
  const effectiveLibraryId =
    libraryId || (user?.uid ? `virtual_${user.uid}` : undefined);

  const addBooks = async (booksToAdd: BookDetails[]) => {
    if (!user?.uid || !effectiveLibraryId || booksToAdd.length === 0) return [];

    if (!isOnline) {
      toast.error('Network required: Connect to the internet to add books.');
      return [];
    }

    const ownershipStatus: 'owned' | 'unowned' = isReadingMode
      ? 'unowned'
      : 'owned';
    const targetStatus: TrackedShelfStatus | 'unset' =
      options?.initialStatus ?? (isReadingMode ? 'want_to_read' : 'unset');

    setIsAddingAll(true);
    try {
      const validBooksToAdd = booksToAdd.map(b => normalizeBookDetails(b));

      // Upload any base64 camera photos with bounded concurrency before sending to server
      const preparedOperations = await mapWithConcurrency(
        validBooksToAdd,
        MAX_CONCURRENT_IMAGE_UPLOADS,
        async (book, idx) => {
          const bookId = generateBookId(idx);
          let finalCoverUrl = book.coverUrl;
          let finalCoverUrlRaw = (book as BookDetails & {coverUrlRaw?: string})
            .coverUrlRaw;

          if (finalCoverUrl && finalCoverUrl.startsWith('data:image/')) {
            try {
              const path = `libraries/${effectiveLibraryId}/covers/${bookId}.jpg`;
              finalCoverUrl = await uploadBase64Image(
                finalCoverUrl,
                path,
                effectiveLibraryId,
              );
            } catch (e) {
              console.error('Failed to upload base64 cover image', e);
            }
          }

          if (finalCoverUrlRaw && finalCoverUrlRaw.startsWith('data:image/')) {
            try {
              const rawPath = `libraries/${effectiveLibraryId}/covers/${bookId}_raw.jpg`;
              finalCoverUrlRaw = await uploadBase64Image(
                finalCoverUrlRaw,
                rawPath,
                effectiveLibraryId,
              );
            } catch (e) {
              console.error('Failed to upload raw base64 cover image', e);
            }
          }

          const rawRecord: Record<string, unknown> = {
            ...book,
            ...(finalCoverUrl !== undefined ? {coverUrl: finalCoverUrl} : {}),
            ...(finalCoverUrlRaw !== undefined
              ? {coverUrlRaw: finalCoverUrlRaw}
              : {}),
            format: book.format || 'physical',
            ownershipStatus,
            ...(targetStatus !== 'unset' ? {status: targetStatus} : {}),
          };
          delete rawRecord.coverCandidates;
          delete rawRecord.sources;
          delete rawRecord.skippedProviders;

          const bookData = Object.fromEntries(
            Object.entries(rawRecord).filter(([, val]) => val !== undefined),
          );

          return {
            type: 'create' as const,
            bookId,
            data: bookData,
          };
        },
      );

      // Single-pass server ingestion + server-side catalog & metadata hydration
      await trpcVanilla.book.batchUpsert.mutate({
        libraryId: effectiveLibraryId,
        operations: preparedOperations,
        enrichOnCreate: true,
      });

      await Promise.allSettled([
        utils.book?.list?.invalidate?.({libraryId: effectiveLibraryId}),
        utils.library?.list?.invalidate?.(),
        utils.readingTracker?.getShelf?.invalidate?.(),
      ]);

      // Schedule a follow-up refresh to pick up any background server-side enrichment
      setTimeout(() => {
        void utils.book?.list?.invalidate?.({libraryId: effectiveLibraryId});
        void utils.readingTracker?.getShelf?.invalidate?.();
      }, 4500);

      triggerHaptics(20);
      const destinationLabel = isReadingMode ? 'reading list' : 'library';
      if (validBooksToAdd.length === 1) {
        toast.success(
          `Added "${validBooksToAdd[0].title}" to ${destinationLabel}!`,
        );
      } else {
        toast.success(
          `Added ${validBooksToAdd.length} books to ${destinationLabel}!`,
        );
      }

      return validBooksToAdd;
    } catch (err) {
      console.error('Failed to add books:', err);
      triggerHaptics([50, 100, 50]);
      toast.error(
        isReadingMode
          ? 'Failed to save books to reading list.'
          : 'Failed to save books to library.',
      );
      throw err;
    } finally {
      setIsAddingAll(false);
    }
  };

  return {
    addBooks,
    isAddingAll,
  };
}
