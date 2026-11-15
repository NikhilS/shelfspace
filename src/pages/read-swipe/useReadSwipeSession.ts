import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLibraryData} from '../../hooks/useLibraryData';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {
  applyOptimisticReadingStatusPatch,
  buildBookSnapshotHint,
  commitReadingStatusDelta,
} from '../../lib/readingStatusCache';
import {instrumentMutation} from '../../lib/telemetry';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {useAuth} from '../../stores/authStore';
import type {Book, Library, ReadingStatusValue} from '../../types';
import type {LastSwipeRecord} from './ReadSwipeCardDeck';
import {
  formatFriendlyReturnTime,
  getBookReadingStatusForUser,
  partitionUnreadSwipeBooks,
  reconcileSwipeQueue,
  shuffleEligibleBooks,
} from './readSwipeMath';

const UNDO_BANNER_DURATION_MS = 4000;

interface OptimisticBookPatch {
  nextStatus?: ReadingStatusValue;
  reviewedAtIso?: string | null;
}

function patchBookInCachedList(
  oldData: unknown,
  bookId: string,
  patch: OptimisticBookPatch,
): unknown {
  if (!oldData) {
    return oldData;
  }
  const updateOne = (book: Book): Book => {
    if (book.id !== bookId) {
      return book;
    }
    const nextBook: Book = {...book};
    if (patch.nextStatus !== undefined) {
      nextBook.readingStatus = patch.nextStatus;
    }
    if (patch.reviewedAtIso !== undefined) {
      nextBook.readStatusReviewedAt = patch.reviewedAtIso ?? null;
    }
    return nextBook;
  };

  if (Array.isArray(oldData)) {
    return (oldData as Book[]).map(updateOne);
  }
  if (
    typeof oldData === 'object' &&
    'books' in oldData &&
    Array.isArray((oldData as {books?: unknown}).books)
  ) {
    const container = oldData as {books: Book[]; [k: string]: unknown};
    return {
      ...container,
      books: container.books.map(updateOne),
    };
  }
  return oldData;
}

export interface ReadSwipeSessionState {
  library: Library | null;
  books: Book[];
  loading: boolean;
  isOnline: boolean;
  currentBook: Book | null;
  nextBook: Book | null;
  synopsisByBookId: Record<string, string>;
  remainingInQueueCount: number;
  reviewedCount: number;
  markedReadCount: number;
  allUnreadCount: number;
  recentlyCheckedCount: number;
  friendlyReturnTime: string;
  lastSwipe: LastSwipeRecord | null;
  exitDirection: 'left' | 'right' | null;
  transitionMode: 'swipe' | 'undo';
  rewindFromDirection: 'left' | 'right' | null;
  mutationError: string | null;
  handleSwipeDecision: (action: 'read' | 'skip') => void;
  handleUndoLastSwipe: () => void;
  handleBrowseRecentlyCheckedAgain: () => void;
}

export function useReadSwipeSession(
  libraryId: string | undefined,
): ReadSwipeSessionState {
  const {user} = useAuth();
  const isOnline = useOnlineStatus();
  const utils = trpc.useUtils();
  const {library, books, isLoading, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
  );

  const loading = isLoading || (isBooksLoading && books.length === 0);

  const booksById = useMemo(() => {
    const map = new Map<string, Book>();
    for (const book of books) {
      map.set(book.id, book);
    }
    return map;
  }, [books]);

  const [includeRecentlyChecked, setIncludeRecentlyChecked] = useState(false);

  const {readyBooks, recentlyCheckedBooks, allUnreadBooks, nextReadyAtMs} =
    useMemo(() => partitionUnreadSwipeBooks(books), [books]);

  const activePoolBooks = useMemo(
    () => (includeRecentlyChecked ? allUnreadBooks : readyBooks),
    [allUnreadBooks, includeRecentlyChecked, readyBooks],
  );

  const activePoolIdsSet = useMemo(
    () => new Set(activePoolBooks.map(book => book.id)),
    [activePoolBooks],
  );

  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [markedReadCount, setMarkedReadCount] = useState(0);
  const [lastSwipe, setLastSwipe] = useState<LastSwipeRecord | null>(null);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(
    null,
  );
  const [transitionMode, setTransitionMode] = useState<'swipe' | 'undo'>(
    'swipe',
  );
  const [rewindFromDirection, setRewindFromDirection] = useState<
    'left' | 'right' | null
  >(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [synopsisByBookId, setSynopsisByBookId] = useState<
    Record<string, string>
  >({});

  const reviewedIdsRef = useRef<Set<string>>(new Set());
  const restoredIdsRef = useRef<Set<string>>(new Set());
  const fetchedDetailsIdsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);
  const lastLibraryIdRef = useRef<string | undefined>(libraryId);
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (lastLibraryIdRef.current !== libraryId) {
      lastLibraryIdRef.current = libraryId;
      isInitializedRef.current = false;
      reviewedIdsRef.current = new Set();
      restoredIdsRef.current = new Set();
      fetchedDetailsIdsRef.current = new Set();
      setIncludeRecentlyChecked(false);
      setQueueIds([]);
      setReviewedCount(0);
      setMarkedReadCount(0);
      setLastSwipe(null);
      setExitDirection(null);
      setTransitionMode('swipe');
      setRewindFromDirection(null);
      setMutationError(null);
      setSynopsisByBookId({});
    }
  }, [libraryId]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isInitializedRef.current) {
      if (activePoolBooks.length > 0) {
        isInitializedRef.current = true;
        setQueueIds(shuffleEligibleBooks(activePoolBooks.map(b => b.id)));
      }
      return;
    }

    const eligibleWithRestored = new Set<string>(activePoolIdsSet);
    for (const restoredId of restoredIdsRef.current) {
      if (booksById.has(restoredId)) {
        eligibleWithRestored.add(restoredId);
      }
    }

    setQueueIds(prev =>
      reconcileSwipeQueue(prev, eligibleWithRestored, reviewedIdsRef.current),
    );
  }, [loading, activePoolBooks, activePoolIdsSet, booksById]);

  useEffect(() => {
    return () => {
      if (confirmationTimerRef.current) {
        clearTimeout(confirmationTimerRef.current);
      }
    };
  }, []);

  const currentBookId = queueIds[0] ?? null;
  const nextBookId = queueIds[1] ?? null;
  const currentBook = currentBookId
    ? (booksById.get(currentBookId) ?? null)
    : null;
  const nextBook = nextBookId ? (booksById.get(nextBookId) ?? null) : null;

  useEffect(() => {
    if (!libraryId || queueIds.length === 0) {
      return undefined;
    }

    const upcomingWindow = queueIds.slice(0, 8);
    const runLookahead = () => {
      for (const id of upcomingWindow.slice(1, 4)) {
        const b = booksById.get(id);
        const url = b?.coverUrl || b?.coverUrlRaw;
        if (url && typeof Image !== 'undefined') {
          const img = new Image();
          img.referrerPolicy = 'no-referrer';
          img.src = url;
          if (typeof img.decode === 'function') {
            void img.decode().catch(() => {});
          }
        }
      }

      if (!isOnline || !trpcVanilla.book?.getBookDetailsChunk?.mutate) {
        return;
      }
      const missingDetailIds = upcomingWindow.filter(id => {
        const b = booksById.get(id);
        return (
          b &&
          !b.synopsis &&
          !synopsisByBookId[id] &&
          !fetchedDetailsIdsRef.current.has(id)
        );
      });

      if (missingDetailIds.length === 0) {
        return;
      }

      for (const id of missingDetailIds) {
        fetchedDetailsIdsRef.current.add(id);
      }

      void trpcVanilla.book.getBookDetailsChunk
        .mutate({
          libraryId,
          bookIds: missingDetailIds,
        })
        .then(res => {
          const detailsMap = res?.details;
          if (!detailsMap) {
            return;
          }
          const nextSynopses: Record<string, string> = {};
          for (const [id, payload] of Object.entries(detailsMap)) {
            if (payload?.synopsis) {
              nextSynopses[id] = payload.synopsis;
            }
          }
          if (Object.keys(nextSynopses).length > 0) {
            setSynopsisByBookId(prev => ({...prev, ...nextSynopses}));
          }
        })
        .catch(() => {});
    };

    let idleId: number | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runLookahead);
    } else {
      fallbackTimer = setTimeout(runLookahead, 16);
    }

    return () => {
      if (
        idleId !== null &&
        typeof window !== 'undefined' &&
        'cancelIdleCallback' in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
    };
  }, [booksById, isOnline, libraryId, queueIds, synopsisByBookId]);

  const applyOptimisticBookPatch = useCallback(
    (
      bookId: string,
      options: {
        nextStatus?: string | null;
        reviewedAtIso?: string | null;
      },
    ) => {
      if (!libraryId) {
        return;
      }
      const normalizedStatus: ReadingStatusValue | undefined =
        options.nextStatus !== undefined
          ? options.nextStatus === 'reading' ||
            options.nextStatus === 'want_to_read' ||
            options.nextStatus === 'finished' ||
            options.nextStatus === 'completed' ||
            options.nextStatus === 'abandoned'
            ? options.nextStatus
            : 'unset'
          : undefined;

      const patch: OptimisticBookPatch = {
        ...(normalizedStatus !== undefined
          ? {nextStatus: normalizedStatus}
          : {}),
        ...(options.reviewedAtIso !== undefined
          ? {reviewedAtIso: options.reviewedAtIso}
          : {}),
      };

      utils.book?.list?.setData?.(
        {libraryId},
        oldData =>
          patchBookInCachedList(oldData, bookId, patch) as typeof oldData,
      );

      utils.book?.get?.setData?.({libraryId, bookId}, oldBook => {
        if (!oldBook) {
          return oldBook;
        }
        const nextBook = {...oldBook};
        if (normalizedStatus !== undefined) {
          nextBook.readingStatus = normalizedStatus;
        }
        if (options.reviewedAtIso !== undefined) {
          nextBook.readStatusReviewedAt = options.reviewedAtIso ?? null;
        }
        return nextBook;
      });
      if (normalizedStatus !== undefined) {
        applyOptimisticReadingStatusPatch(utils, {
          libraryId,
          bookId,
          status: normalizedStatus,
          reviewedAtIso: options.reviewedAtIso,
          bookHint: booksById.get(bookId),
        });
      }
    },
    [booksById, libraryId, utils],
  );

  const persistBookStatus = useCallback(
    async (
      bookId: string,
      statusToSave:
        'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned',
      fallbackStatus: string | null,
      fallbackReviewedAt: string | null,
      reviewedAtOverride?: string | null,
    ) => {
      if (!libraryId) {
        return;
      }
      const existingBook = booksById.get(bookId);
      const snapshotHint = buildBookSnapshotHint(existingBook, {
        libraryId,
        bookId,
        libraryName: library?.name,
      });
      const executeStatusUpdate = () =>
        instrumentMutation(
          'update',
          `libraries/${libraryId}/books/${bookId}`,
          {status: statusToSave},
          () =>
            trpcVanilla.book.updateStatus.mutate({
              libraryId,
              bookId,
              status: statusToSave,
              ...(reviewedAtOverride !== undefined
                ? {reviewedAtOverride}
                : {recordReadStatusReview: true}),
              ...(snapshotHint ? {bookSnapshot: snapshotHint} : {}),
            }),
        );

      try {
        setMutationError(null);
        let response:
          | Awaited<ReturnType<typeof trpcVanilla.book.updateStatus.mutate>>
          | undefined;
        try {
          response = await executeStatusUpdate();
        } catch (firstErr) {
          const msg =
            firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (
            msg.includes('warming up') ||
            msg.includes('SERVICE_UNAVAILABLE')
          ) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            response = await executeStatusUpdate();
          } else {
            throw firstErr;
          }
        }
        commitReadingStatusDelta(utils, {
          libraryId,
          bookId,
          status: response?.status ?? statusToSave,
          reviewedAt: response?.reviewedAt ?? reviewedAtOverride,
          rating: response?.rating,
          startedAt: response?.startedAt,
          finishedAt: response?.finishedAt,
          bookSnapshot: response?.bookSnapshot,
          bookHint: existingBook
            ? {...existingBook, libraryName: library?.name}
            : undefined,
        });
      } catch (err) {
        console.warn('Failed to update reading status during swipe:', err);
        applyOptimisticBookPatch(bookId, {
          nextStatus: fallbackStatus,
          reviewedAtIso: fallbackReviewedAt,
        });
        setMutationError(
          'Could not save status change. Your last action was restored.',
        );
      }
    },
    [applyOptimisticBookPatch, booksById, library?.name, libraryId, utils],
  );

  const persistReadSwipeSkip = useCallback(
    async (
      bookId: string,
      fallbackReviewedAt: string | null,
      reviewedAtOverride?: string | null,
    ) => {
      if (
        !libraryId ||
        !isOnline ||
        !trpcVanilla.book?.recordReadSwipeReview?.mutate
      ) {
        return;
      }
      const existingBook = booksById.get(bookId);
      const snapshotHint = buildBookSnapshotHint(existingBook, {
        libraryId,
        bookId,
        libraryName: library?.name,
      });
      const executeSkipReview = () =>
        instrumentMutation(
          'update',
          `libraries/${libraryId}/books/${bookId}`,
          {action: 'recordReadSwipeReview'},
          () =>
            trpcVanilla.book.recordReadSwipeReview.mutate({
              libraryId,
              bookId,
              ...(reviewedAtOverride !== undefined
                ? {reviewedAt: reviewedAtOverride}
                : {}),
              ...(snapshotHint ? {bookSnapshot: snapshotHint} : {}),
            }),
        );

      try {
        try {
          await executeSkipReview();
        } catch (firstErr) {
          const msg =
            firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (
            msg.includes('warming up') ||
            msg.includes('SERVICE_UNAVAILABLE')
          ) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            await executeSkipReview();
          } else {
            throw firstErr;
          }
        }
      } catch (err) {
        console.warn('Failed to record swipe review timestamp:', err);
        applyOptimisticBookPatch(bookId, {
          reviewedAtIso: fallbackReviewedAt,
        });
      }
    },
    [applyOptimisticBookPatch, booksById, isOnline, library?.name, libraryId],
  );

  const scheduleUndoBanner = useCallback((record: LastSwipeRecord) => {
    if (confirmationTimerRef.current) {
      clearTimeout(confirmationTimerRef.current);
    }
    setLastSwipe(record);
    confirmationTimerRef.current = setTimeout(() => {
      setLastSwipe(current =>
        current?.bookId === record.bookId ? null : current,
      );
    }, UNDO_BANNER_DURATION_MS);
  }, []);

  const handleSwipeDecision = useCallback(
    (action: 'read' | 'skip') => {
      if (!currentBook) {
        return;
      }
      if (action === 'read' && !isOnline) {
        return;
      }

      const targetBook = currentBook;
      const previousStatus = getBookReadingStatusForUser(targetBook);
      const previousReviewedAt = targetBook.readStatusReviewedAt ?? null;
      const nowIso = new Date().toISOString();

      const direction = action === 'read' ? 'right' : 'left';
      setTransitionMode('swipe');
      setRewindFromDirection(null);
      setExitDirection(direction);
      restoredIdsRef.current.delete(targetBook.id);
      reviewedIdsRef.current.add(targetBook.id);

      setQueueIds(prev => prev.filter(id => id !== targetBook.id));
      setReviewedCount(count => count + 1);

      scheduleUndoBanner({
        bookId: targetBook.id,
        title: targetBook.title,
        action,
        previousStatus,
        previousReviewedAt,
      });

      if (action === 'read') {
        setMarkedReadCount(count => count + 1);
        applyOptimisticBookPatch(targetBook.id, {
          nextStatus: 'finished',
          reviewedAtIso: nowIso,
        });
        void persistBookStatus(
          targetBook.id,
          'finished',
          previousStatus,
          previousReviewedAt,
        );
      } else {
        applyOptimisticBookPatch(targetBook.id, {
          reviewedAtIso: nowIso,
        });
        void persistReadSwipeSkip(targetBook.id, previousReviewedAt);
      }
    },
    [
      applyOptimisticBookPatch,
      currentBook,
      isOnline,
      persistBookStatus,
      persistReadSwipeSkip,
      scheduleUndoBanner,
    ],
  );

  const handleUndoLastSwipe = useCallback(() => {
    if (!lastSwipe) {
      return;
    }
    if (confirmationTimerRef.current) {
      clearTimeout(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }

    const {bookId, action, previousStatus, previousReviewedAt} = lastSwipe;
    setLastSwipe(null);
    setTransitionMode('undo');
    setRewindFromDirection(action === 'read' ? 'right' : 'left');

    reviewedIdsRef.current.delete(bookId);
    restoredIdsRef.current.add(bookId);
    setQueueIds(prev => [bookId, ...prev.filter(id => id !== bookId)]);
    setReviewedCount(count => Math.max(0, count - 1));

    if (action === 'read') {
      setMarkedReadCount(count => Math.max(0, count - 1));
      const restoredStatus:
        'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned' =
        previousStatus === 'reading' ||
        previousStatus === 'want_to_read' ||
        previousStatus === 'finished' ||
        previousStatus === 'abandoned'
          ? previousStatus
          : 'unset';

      applyOptimisticBookPatch(bookId, {
        nextStatus: restoredStatus,
        reviewedAtIso: previousReviewedAt,
      });
      void persistBookStatus(
        bookId,
        restoredStatus,
        'finished',
        new Date().toISOString(),
        previousReviewedAt,
      );
    } else {
      applyOptimisticBookPatch(bookId, {
        reviewedAtIso: previousReviewedAt,
      });
      void persistReadSwipeSkip(
        bookId,
        new Date().toISOString(),
        previousReviewedAt,
      );
    }
  }, [
    applyOptimisticBookPatch,
    lastSwipe,
    persistBookStatus,
    persistReadSwipeSkip,
  ]);

  const handleBrowseRecentlyCheckedAgain = useCallback(() => {
    reviewedIdsRef.current = new Set();
    restoredIdsRef.current = new Set();
    isInitializedRef.current = true;
    setTransitionMode('swipe');
    setRewindFromDirection(null);
    setIncludeRecentlyChecked(true);
    const allUnreadIds = allUnreadBooks.map(b => b.id);
    setQueueIds(shuffleEligibleBooks(allUnreadIds));
  }, [allUnreadBooks]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        if (lastSwipe) {
          event.preventDefault();
          handleUndoLastSwipe();
        }
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleSwipeDecision('skip');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleSwipeDecision('read');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSwipeDecision, handleUndoLastSwipe, lastSwipe]);

  const remainingInQueueCount = queueIds.length;
  const friendlyReturnTime = useMemo(
    () => formatFriendlyReturnTime(nextReadyAtMs),
    [nextReadyAtMs],
  );

  return {
    library,
    books,
    loading,
    isOnline,
    currentBook,
    nextBook,
    synopsisByBookId,
    remainingInQueueCount,
    reviewedCount,
    markedReadCount,
    allUnreadCount: allUnreadBooks.length,
    recentlyCheckedCount: recentlyCheckedBooks.length,
    friendlyReturnTime,
    lastSwipe,
    exitDirection,
    transitionMode,
    rewindFromDirection,
    mutationError,
    handleSwipeDecision,
    handleUndoLastSwipe,
    handleBrowseRecentlyCheckedAgain,
  };
}
