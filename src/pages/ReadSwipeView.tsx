import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from 'motion/react';
import {ArrowLeft, ArrowRight, Check, RotateCcw} from 'lucide-react';
import {useAuth} from '../stores/authStore';
import {useLibraryData} from '../hooks/useLibraryData';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {ArchivalCoverImage} from '../components/book/ArchivalCoverImage';
import {TidyShelfCheckIllustration} from '@/components/ui/empty-state-illustrations';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/book/BookLoader';
import {trpc, trpcVanilla} from '../lib/trpc';
import {instrumentMutation} from '../lib/telemetry';
import {toTitleCase} from '../lib/utils';
import type {Book, ReadingStatusValue} from '../types';
import {
  formatFriendlyReturnTime,
  getBookReadingStatusForUser,
  partitionUnreadSwipeBooks,
  reconcileSwipeQueue,
  shuffleEligibleBooks,
} from './read-swipe/readSwipeMath';

const SWIPE_THRESHOLD_PX = 90;
const SWIPE_VELOCITY_THRESHOLD = 400;
const UNDO_BANNER_DURATION_MS = 4000;

interface LastSwipeRecord {
  bookId: string;
  title: string;
  action: 'read' | 'skip';
  previousStatus: string | null;
  previousReviewedAt: string | null;
}

interface SwipeBookFaceProps {
  book: Book;
  synopsisText?: string;
  isTopCard: boolean;
}

function SwipeBookFace({book, synopsisText, isTopCard}: SwipeBookFaceProps) {
  const coverSrc = book.coverUrl || book.coverUrlRaw;

  const yearLabel = useMemo(() => {
    if (!book.publishedDate) {
      return null;
    }
    const match = String(book.publishedDate).match(/\b(\d{4})\b/);
    return match ? match[1] : null;
  }, [book.publishedDate]);

  const currentStatusLabel = useMemo(() => {
    const raw = getBookReadingStatusForUser(book);
    if (raw === 'reading') {
      return 'Currently Reading';
    }
    if (raw === 'want_to_read') {
      return 'Want to Read';
    }
    return null;
  }, [book]);

  const metadataParts = useMemo(() => {
    const parts: string[] = [];
    if (book.primaryGenre) {
      parts.push(book.primaryGenre);
    } else if (book.subgenres?.[0]) {
      parts.push(book.subgenres[0]);
    }
    if (yearLabel) {
      parts.push(yearLabel);
    }
    if (currentStatusLabel) {
      parts.push(currentStatusLabel);
    }
    return parts;
  }, [book.primaryGenre, book.subgenres, currentStatusLabel, yearLabel]);

  const resolvedSynopsis = (synopsisText || book.synopsis || '').trim();

  return (
    <div className="flex flex-col h-full select-none">
      {/* Cover Stage */}
      <div className="relative flex-1 min-h-[230px] sm:min-h-[265px] bg-surface-container-low border-b border-outline-variant/50 flex items-center justify-center p-5 sm:p-6 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-50 bg-gradient-to-b from-surface-container-lowest/80 via-transparent to-surface-container/60"
          aria-hidden="true"
        />

        <ArchivalCoverImage
          src={coverSrc}
          alt={book.title}
          author={book.author}
          publishedYear={yearLabel}
          variant="card"
          draggable={false}
          loading={isTopCard ? 'eager' : 'lazy'}
          className="relative z-10 w-36 sm:w-44 aspect-[2/3] rounded-lg overflow-hidden book-cover-shadow border border-outline-variant/50 bg-surface"
          imgClassName="pointer-events-none select-none"
        />
      </div>

      {/* Editorial Card Footer: Genre · Year, Title, Author, and Short Synopsis */}
      <div className="p-5 sm:p-6 bg-surface flex flex-col justify-between gap-3">
        <div>
          {metadataParts.length > 0 && (
            <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5 truncate">
              {metadataParts.join(' · ')}
            </p>
          )}
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-on-surface tracking-tight leading-snug line-clamp-2 text-balance">
            {toTitleCase(book.title)}
          </h2>
          <p className="font-sans text-sm font-medium text-on-surface-variant mt-1 line-clamp-1">
            {book.author ? toTitleCase(book.author) : 'Unknown Author'}
          </p>
        </div>

        <p className="font-sans text-xs text-on-surface-variant leading-relaxed line-clamp-3 pt-2.5 border-t border-outline-variant/40">
          {resolvedSynopsis ||
            (book.primaryGenre
              ? `A ${book.primaryGenre.toLowerCase()} edition on your shelves—swipe right if you've read it, or left to leave unchanged.`
              : "Cataloged on your library shelves—swipe right if you've read it, or left to leave unchanged.")}
        </p>
      </div>
    </div>
  );
}

interface DraggableSwipeCardProps {
  book: Book;
  synopsisText?: string;
  isOnline: boolean;
  onSwipeDecision: (action: 'read' | 'skip') => void;
}

function DraggableSwipeCard({
  book,
  synopsisText,
  isOnline,
  onSwipeDecision,
}: DraggableSwipeCardProps) {
  const dragX = useMotionValue(0);
  const cardRotate = useTransform(dragX, [-220, 0, 220], [-9, 0, 9]);
  const readStampOpacity = useTransform(dragX, [20, 90], [0, 1]);
  const readStampScale = useTransform(dragX, [20, 90], [0.92, 1]);
  const skipStampOpacity = useTransform(dragX, [-90, -20], [1, 0]);
  const skipStampScale = useTransform(dragX, [-90, -20], [1, 0.92]);

  return (
    <motion.div
      data-testid="active-swipe-card"
      drag="x"
      dragConstraints={{left: 0, right: 0}}
      dragElastic={0.88}
      style={{
        x: dragX,
        rotate: cardRotate,
      }}
      onDragEnd={(_event, info) => {
        const offsetX = info.offset.x;
        const velocityX = info.velocity.x;

        if (
          offsetX > SWIPE_THRESHOLD_PX ||
          velocityX > SWIPE_VELOCITY_THRESHOLD
        ) {
          if (isOnline) {
            onSwipeDecision('read');
          } else {
            dragX.set(0);
          }
        } else if (
          offsetX < -SWIPE_THRESHOLD_PX ||
          velocityX < -SWIPE_VELOCITY_THRESHOLD
        ) {
          onSwipeDecision('skip');
        } else {
          dragX.set(0);
        }
      }}
      className="w-full h-full rounded-2xl border border-outline-variant/70 bg-surface shadow-elevation-2 overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y will-change-transform pointer-events-auto"
    >
      {/* Right-swipe Archival Stamp: READ */}
      <motion.div
        style={{
          opacity: readStampOpacity,
          scale: readStampScale,
        }}
        className="pointer-events-none absolute top-5 left-5 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-emerald-700 bg-surface/95 text-emerald-800 dark:text-emerald-300 font-sans font-bold text-xs uppercase tracking-widest shadow-xs -rotate-6"
      >
        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
        Read
      </motion.div>

      {/* Left-swipe Archival Stamp: NOT YET */}
      <motion.div
        style={{
          opacity: skipStampOpacity,
          scale: skipStampScale,
        }}
        className="pointer-events-none absolute top-5 right-5 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-outline bg-surface/95 text-on-surface font-sans font-bold text-xs uppercase tracking-widest shadow-xs rotate-6"
      >
        <ArrowLeft className="w-3.5 h-3.5 stroke-[2.25]" />
        Not Yet
      </motion.div>

      <SwipeBookFace book={book} synopsisText={synopsisText} isTopCard={true} />
    </motion.div>
  );
}

interface CardSlotTransitionCustom {
  mode: 'swipe' | 'undo';
  exitDirection: 'left' | 'right' | null;
  rewindDirection: 'left' | 'right' | null;
}

const UNDO_SPRING_TRANSITION = {
  type: 'spring' as const,
  stiffness: 360,
  damping: 28,
  mass: 0.85,
};

const CARD_ENTER_SPRING_TRANSITION = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 32,
};

const cardSlotVariants = {
  initial: (custom: CardSlotTransitionCustom) =>
    custom?.mode === 'undo' && custom.rewindDirection
      ? {
          x: custom.rewindDirection === 'right' ? 88 : -88,
          y: -10,
          rotate: custom.rewindDirection === 'right' ? 4.5 : -4.5,
          scale: 1.02,
          opacity: 0,
        }
      : {
          x: 0,
          y: 10,
          rotate: 0,
          scale: 0.96,
          opacity: 0,
        },
  animate: (custom: CardSlotTransitionCustom) => ({
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    opacity: 1,
    transition:
      custom?.mode === 'undo'
        ? UNDO_SPRING_TRANSITION
        : CARD_ENTER_SPRING_TRANSITION,
  }),
  exit: (custom: CardSlotTransitionCustom) =>
    custom?.mode === 'undo'
      ? {
          x: 0,
          y: 10,
          rotate: 0,
          scale: 0.96,
          opacity: 0,
          transition: UNDO_SPRING_TRANSITION,
        }
      : {
          x: custom?.exitDirection === 'left' ? -380 : 380,
          y: 0,
          rotate: custom?.exitDirection === 'left' ? -12 : 12,
          scale: 0.98,
          opacity: 0,
          transition: {duration: 0.2, ease: 'easeOut' as const},
        },
};

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

export function ReadSwipeView() {
  const {id: libraryId} = useParams<{id: string}>();
  const {user} = useAuth();
  const isOnline = useOnlineStatus();
  const utils = trpc.useUtils();
  const {library, books, isLoading, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
  );

  const loading = isLoading || (isBooksLoading && books.length === 0);

  // Map books by ID for O(1) lookup
  const booksById = useMemo(() => {
    const map = new Map<string, Book>();
    for (const book of books) {
      map.set(book.id, book);
    }
    return map;
  }, [books]);

  const [includeRecentlyChecked, setIncludeRecentlyChecked] = useState(false);

  // Partition unread books into ready-now vs. checked within the last 2 days
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

  // Shuffled deck order and session tracking
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

  // Reset session state if libraryId changes
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

  // Initialize or reconcile shuffled queue when books load or update
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

  // Cleanup confirmation timer on unmount
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

  // Idle-deferred cover pre-decoding and synopsis lookahead for upcoming cards
  useEffect(() => {
    if (!libraryId || queueIds.length === 0) {
      return undefined;
    }

    const upcomingWindow = queueIds.slice(0, 8);
    const schedule =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 16);
    const cancel =
      typeof window !== 'undefined' && 'cancelIdleCallback' in window
        ? window.cancelIdleCallback
        : (id: number) => clearTimeout(id);

    const handle = schedule(() => {
      // 1. Pre-warm cover bitmaps for next 3 cards
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

      // 2. Fetch heavy synopsis details for upcoming window if not yet loaded
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
          const detailsMap = (
            res as {details?: Record<string, {synopsis?: string}>} | undefined
          )?.details;
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
        .catch(() => {
          // Silently fall back to genre/default summary if chunk fetch fails
        });
    });

    return () => {
      cancel(handle as number);
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
        const nextBook: Book = {...oldBook};
        if (normalizedStatus !== undefined) {
          nextBook.readingStatus = normalizedStatus;
        }
        if (options.reviewedAtIso !== undefined) {
          nextBook.readStatusReviewedAt = options.reviewedAtIso ?? null;
        }
        return nextBook;
      });
    },
    [libraryId, utils.book],
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
            }),
        );

      try {
        setMutationError(null);
        try {
          await executeStatusUpdate();
        } catch (firstErr) {
          const msg =
            firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (
            msg.includes('warming up') ||
            msg.includes('SERVICE_UNAVAILABLE')
          ) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            await executeStatusUpdate();
          } else {
            throw firstErr;
          }
        }
        void (
          utils as {readingTracker?: {getShelf?: {invalidate?: () => unknown}}}
        ).readingTracker?.getShelf?.invalidate?.();
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
    [applyOptimisticBookPatch, libraryId, utils],
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
    [applyOptimisticBookPatch, isOnline, libraryId],
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

  // Keyboard support: ArrowLeft = Set Aside, ArrowRight = Mark as Read, Cmd/Ctrl+Z = Undo
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

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex-1 flex flex-col">
        {/* Minimal Archival Header */}
        <div className="flex flex-col gap-2.5 border-b border-outline-variant/60 pb-4">
          <div className="flex items-center justify-between gap-2">
            <BackToLibrary
              libraryId={libraryId}
              label={
                library?.name
                  ? `Back to ${toTitleCase(library.name)}`
                  : 'Back to Library'
              }
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <span className="metadata-eyebrow block">Shelf Triage</span>
              <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-on-surface tracking-tight mt-0.5">
                Have You Read It?
              </h1>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant mt-0.5">
                Swipe right to mark a book as read, or swipe left to set it
                aside for a couple of days.
              </p>
            </div>

            {/* Unboxed Live Session & Pool Counter */}
            <div
              data-testid="swipe-session-stats"
              className="font-mono text-xs font-medium text-on-surface-variant tabular-nums shrink-0 pt-1 sm:pt-0"
            >
              <span className="font-semibold text-on-surface">
                {remainingInQueueCount}
              </span>{' '}
              Remaining
              <span className="mx-1.5 text-outline-variant">·</span>
              <span className="font-semibold text-on-surface">
                {reviewedCount}
              </span>{' '}
              Reviewed
              <span className="mx-1.5 text-outline-variant">·</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {markedReadCount}
              </span>{' '}
              Marked Read
            </div>
          </div>
        </div>

        {/* Subtle Non-Blocking Confirmation & Undo Banner Slot */}
        <div className="h-10 flex items-center justify-center my-2">
          <AnimatePresence mode="wait">
            {mutationError ? (
              <motion.div
                key="mutation-error"
                initial={{opacity: 0, y: -6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                transition={{duration: 0.16}}
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-xs font-sans font-medium text-destructive shadow-2xs"
              >
                <span>{mutationError}</span>
              </motion.div>
            ) : lastSwipe ? (
              <motion.div
                key={`${lastSwipe.bookId}-${lastSwipe.action}`}
                data-testid={
                  lastSwipe.action === 'read'
                    ? 'read-confirmation-banner'
                    : 'skip-confirmation-banner'
                }
                initial={{opacity: 0, y: -6, scale: 0.98}}
                animate={{opacity: 1, y: 0, scale: 1}}
                exit={{opacity: 0, y: -6, scale: 0.98}}
                transition={{duration: 0.16}}
                role="status"
                aria-live="polite"
                className={
                  lastSwipe.action === 'read'
                    ? 'inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg border border-emerald-700/25 bg-emerald-500/10 text-xs font-sans font-medium text-emerald-800 dark:text-emerald-300 shadow-2xs max-w-full'
                    : 'inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/60 bg-surface-container text-xs font-sans font-medium text-on-surface-variant shadow-2xs max-w-full'
                }
              >
                {lastSwipe.action === 'read' ? (
                  <>
                    <span className="w-4 h-4 rounded bg-emerald-700 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                    <span className="truncate">
                      Marked{' '}
                      <strong className="font-semibold">
                        {toTitleCase(lastSwipe.title)}
                      </strong>{' '}
                      as Read
                    </span>
                  </>
                ) : (
                  <span className="truncate">
                    Set{' '}
                    <strong className="font-semibold text-on-surface">
                      {toTitleCase(lastSwipe.title)}
                    </strong>{' '}
                    aside for later
                  </span>
                )}

                <span
                  className={
                    lastSwipe.action === 'read'
                      ? 'h-3.5 w-px bg-emerald-700/25 shrink-0'
                      : 'h-3.5 w-px bg-outline-variant/60 shrink-0'
                  }
                  aria-hidden="true"
                />

                <button
                  type="button"
                  data-testid="undo-swipe-button"
                  onClick={handleUndoLastSwipe}
                  className={
                    lastSwipe.action === 'read'
                      ? 'inline-flex items-center gap-1 font-sans text-xs font-semibold text-emerald-900 dark:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded px-1 shrink-0 cursor-pointer'
                      : 'inline-flex items-center gap-1 font-sans text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded px-1 shrink-0 cursor-pointer'
                  }
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Undo</span>
                </button>
              </motion.div>
            ) : !isOnline ? (
              <motion.div
                key="offline-notice"
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-lg border border-outline-variant/60 bg-surface-container text-xs font-sans font-medium text-on-surface-variant"
              >
                <span>
                  You&apos;re offline — connect to the internet to mark books as
                  read.
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Main Gesture Card Deck Stage */}
        <div className="flex-1 flex flex-col items-center justify-center py-2">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <BookLoader size="md" />
              <p className="font-sans text-xs font-medium text-on-surface-variant">
                Shuffling unread books from your shelves…
              </p>
            </div>
          ) : currentBook ? (
            <div className="w-full max-w-sm sm:max-w-md flex flex-col items-center">
              {/* 2-Card Constant O(1) GPU Stack Stage */}
              <div className="relative w-full h-[460px] sm:h-[495px]">
                {/* Next card preview underneath */}
                {nextBook && (
                  <motion.div
                    key={`next-${nextBook.id}`}
                    initial={{opacity: 0, scale: 0.93, y: 16}}
                    animate={{opacity: 0.85, scale: 0.96, y: 10}}
                    transition={UNDO_SPRING_TRANSITION}
                    className="absolute inset-0 rounded-2xl border border-outline-variant/60 bg-surface shadow-elevation-1 overflow-hidden pointer-events-none will-change-transform"
                    aria-hidden="true"
                  >
                    <SwipeBookFace
                      book={nextBook}
                      synopsisText={synopsisByBookId[nextBook.id]}
                      isTopCard={false}
                    />
                  </motion.div>
                )}

                {/* Active Draggable Top Card (Outer Transition Slot + Inner Isolated Drag Card) */}
                <AnimatePresence
                  initial={false}
                  custom={{
                    mode: transitionMode,
                    exitDirection,
                    rewindDirection: rewindFromDirection,
                  }}
                >
                  <motion.div
                    key={currentBook.id}
                    custom={{
                      mode: transitionMode,
                      exitDirection,
                      rewindDirection: rewindFromDirection,
                    }}
                    variants={cardSlotVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="absolute inset-0 z-10 pointer-events-none will-change-transform"
                  >
                    <DraggableSwipeCard
                      book={currentBook}
                      synopsisText={synopsisByBookId[currentBook.id]}
                      isOnline={isOnline}
                      onSwipeDecision={handleSwipeDecision}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Quiet Directional Gesture Cue Bar */}
              <div className="mt-5 w-full flex items-center justify-between px-2 font-sans text-xs text-on-surface-variant select-none">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Swipe left to set aside</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span>Swipe right for Read</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ) : (
            /* Empty / Caught-Up State */
            <div
              data-testid="swipe-empty-state"
              className="max-w-md w-full mx-auto text-center rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-8 sm:p-10 shadow-elevation-1"
            >
              <div className="flex justify-center mb-4">
                <TidyShelfCheckIllustration className="w-24 h-20" />
              </div>

              {allUnreadBooks.length > 0 ? (
                <>
                  <span className="metadata-eyebrow block mb-1">
                    Checked Recently
                  </span>
                  <h2 className="font-serif text-2xl font-semibold text-on-surface tracking-tight text-balance">
                    You&apos;re All Caught Up for Now
                  </h2>
                  <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                    {reviewedCount > 0 ? (
                      <>
                        You flipped through{' '}
                        <span className="font-mono font-semibold text-on-surface tabular-nums">
                          {reviewedCount}
                        </span>{' '}
                        {reviewedCount === 1 ? 'book' : 'books'} and marked{' '}
                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {markedReadCount}
                        </span>{' '}
                        as read. We&apos;ll bring your{' '}
                        <span className="font-mono font-semibold text-on-surface tabular-nums">
                          {allUnreadBooks.length}
                        </span>{' '}
                        remaining unread{' '}
                        {allUnreadBooks.length === 1 ? 'book' : 'books'} back in{' '}
                        {friendlyReturnTime}—or you can flip through{' '}
                        {allUnreadBooks.length === 1 ? 'it' : 'them'} again
                        whenever you like.
                      </>
                    ) : (
                      <>
                        You&apos;ve looked over your{' '}
                        <span className="font-mono font-semibold text-on-surface tabular-nums">
                          {recentlyCheckedBooks.length || allUnreadBooks.length}
                        </span>{' '}
                        unread{' '}
                        {(recentlyCheckedBooks.length ||
                          allUnreadBooks.length) === 1
                          ? 'book'
                          : 'books'}{' '}
                        recently—we&apos;ll bring{' '}
                        {(recentlyCheckedBooks.length ||
                          allUnreadBooks.length) === 1
                          ? 'it'
                          : 'them'}{' '}
                        back in {friendlyReturnTime}, or you can flip through{' '}
                        {(recentlyCheckedBooks.length ||
                          allUnreadBooks.length) === 1
                          ? 'it'
                          : 'them'}{' '}
                        again whenever you like.
                      </>
                    )}
                  </p>
                  <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                    <Button
                      type="button"
                      onClick={handleBrowseRecentlyCheckedAgain}
                      className="w-full sm:w-auto rounded-lg font-sans font-semibold"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Browse Them Again
                    </Button>
                    <Link
                      to={`/library/${libraryId}`}
                      className="w-full sm:w-auto inline-flex items-center justify-center h-9 px-4 rounded-lg border border-outline-variant/60 bg-surface hover:bg-surface-container text-xs font-sans font-semibold text-on-surface transition-colors"
                    >
                      Back to Library
                      <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <span className="metadata-eyebrow block mb-1">
                    All Sorted
                  </span>
                  <h2 className="font-serif text-2xl font-semibold text-on-surface tracking-tight text-balance">
                    Every Book Is Accounted For
                  </h2>
                  <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                    {books.length === 0
                      ? 'This library does not have any books yet. Add or import books to start sorting your reading history.'
                      : 'Every book in this library has already been marked as read or abandoned.'}
                  </p>
                  <div className="mt-6 flex items-center justify-center">
                    <Link
                      to={`/library/${libraryId}`}
                      className="inline-flex items-center justify-center h-9 px-5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 text-xs font-sans font-semibold transition-colors"
                    >
                      Back to Library
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
