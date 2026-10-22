import {useEffect} from 'react';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {Book} from '../../types';

const MAX_PRELOADED_COVERS = 150;
const preloadedCoverUrls = new Set<string>();

function preloadCoverImageBitmap(coverUrl: string | undefined): void {
  if (!coverUrl || typeof Image === 'undefined') {
    return;
  }
  if (preloadedCoverUrls.has(coverUrl)) {
    return;
  }
  if (preloadedCoverUrls.size >= MAX_PRELOADED_COVERS) {
    const oldest = preloadedCoverUrls.values().next().value;
    if (oldest) {
      preloadedCoverUrls.delete(oldest);
    }
  }
  preloadedCoverUrls.add(coverUrl);

  try {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = coverUrl;
    if (typeof img.decode === 'function') {
      void img.decode().catch(() => {
        // Ignore decode failures in headless/offline environments
      });
    }
  } catch {
    // Ignore image construction errors
  }
}

function extractBookList(cachedData: unknown): Book[] | undefined {
  if (Array.isArray(cachedData)) {
    return cachedData as Book[];
  }
  if (
    cachedData &&
    typeof cachedData === 'object' &&
    Array.isArray((cachedData as {books?: unknown}).books)
  ) {
    return (cachedData as {books: Book[]}).books;
  }
  return undefined;
}

export function PrefetchAdjacentBooks({
  libraryId,
  bookList,
  currentIndex,
  radius = 2,
}: {
  libraryId: string;
  bookList: string[];
  currentIndex: number;
  radius?: number;
}) {
  const utils = trpc.useUtils();
  const bookListKey = bookList.join(',');

  useEffect(() => {
    if (!libraryId || !bookList.length) {
      return;
    }

    let isCancelled = false;

    const runIdlePrewarm = () => {
      if (isCancelled) {
        return;
      }

      const cachedListData = utils.book?.list?.getData?.({libraryId});
      const cachedBooks = extractBookList(cachedListData);

      const start = Math.max(0, currentIndex - radius);
      const end = Math.min(bookList.length - 1, currentIndex + radius);

      for (let i = start; i <= end; i++) {
        if (i === currentIndex) {
          continue;
        }
        const bookId = bookList[i];
        if (!bookId) {
          continue;
        }

        // 1. Pre-decode cover image from list/detail cache if available
        const cachedDetail = utils.book?.get?.getData?.({
          libraryId,
          bookId,
        }) as Book | undefined;
        const cachedListItem = cachedBooks?.find(b => b.id === bookId);
        const coverUrl = cachedDetail?.coverUrl || cachedListItem?.coverUrl;
        preloadCoverImageBitmap(coverUrl);

        // 2. Prefetch full book record in the background
        if (typeof utils?.book?.get?.prefetch === 'function') {
          void utils.book.get
            .prefetch({libraryId, bookId}, {staleTime: 1000 * 60 * 5})
            .then(() => {
              const fetched = utils.book?.get?.getData?.({
                libraryId,
                bookId,
              }) as Book | undefined;
              preloadCoverImageBitmap(fetched?.coverUrl);
            })
            .catch(() => {
              // Ignore prefetch errors
            });
        } else if (trpcVanilla?.book?.get?.query) {
          void trpcVanilla.book.get
            .query({
              libraryId,
              bookId,
            })
            .then(fetched => {
              preloadCoverImageBitmap(
                (fetched as Book | null | undefined)?.coverUrl,
              );
            })
            .catch(() => {
              // Ignore prefetch errors
            });
        }
      }
    };

    // Defer network prefetch and bitmap decoding to idle frame after swipe spring settles
    if (
      typeof window !== 'undefined' &&
      'requestIdleCallback' in window &&
      typeof window.requestIdleCallback === 'function'
    ) {
      const idleId = window.requestIdleCallback(runIdlePrewarm, {timeout: 250});
      return () => {
        isCancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }

    const timerId = setTimeout(runIdlePrewarm, 120);
    return () => {
      isCancelled = true;
      clearTimeout(timerId);
    };
  }, [libraryId, bookListKey, currentIndex, radius, utils]);

  return null;
}
