import React, {useMemo} from 'react';
import {Link} from 'react-router-dom';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from 'motion/react';
import {ArrowLeft, ArrowRight, Check, RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {TidyShelfCheckIllustration} from '@/components/ui/empty-state-illustrations';
import {ArchivalCoverImage} from '../../components/book/ArchivalCoverImage';
import {toTitleCase} from '../../lib/utils';
import type {Book} from '../../types';
import {getBookReadingStatusForUser} from './readSwipeMath';

const SWIPE_THRESHOLD_PX = 90;
const SWIPE_VELOCITY_THRESHOLD = 400;

export interface LastSwipeRecord {
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

export function SwipeBookFace({
  book,
  synopsisText,
  isTopCard,
}: SwipeBookFaceProps) {
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

export function DraggableSwipeCard({
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

export const UNDO_SPRING_TRANSITION = {
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

export const cardSlotVariants = {
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

export interface ReadSwipeStatusBannerProps {
  mutationError: string | null;
  lastSwipe: LastSwipeRecord | null;
  isOnline: boolean;
  onUndoLastSwipe: () => void;
}

export function ReadSwipeStatusBanner({
  mutationError,
  lastSwipe,
  isOnline,
  onUndoLastSwipe,
}: ReadSwipeStatusBannerProps) {
  return (
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
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-error/30 bg-error/10 text-xs font-sans font-medium text-error shadow-2xs"
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
              onClick={onUndoLastSwipe}
              className={
                lastSwipe.action === 'read'
                  ? 'inline-flex items-center gap-1 font-sans text-xs font-semibold text-emerald-900 dark:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded px-1 shrink-0 cursor-pointer'
                  : 'inline-flex items-center gap-1 font-sans text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded px-1 shrink-0 cursor-pointer'
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
  );
}

export interface ReadSwipeEmptyStateProps {
  libraryId: string | undefined;
  totalBooksCount: number;
  allUnreadCount: number;
  recentlyCheckedCount: number;
  reviewedCount: number;
  markedReadCount: number;
  friendlyReturnTime: string;
  onBrowseAgain: () => void;
}

export function ReadSwipeEmptyState({
  libraryId,
  totalBooksCount,
  allUnreadCount,
  recentlyCheckedCount,
  reviewedCount,
  markedReadCount,
  friendlyReturnTime,
  onBrowseAgain,
}: ReadSwipeEmptyStateProps) {
  const checkedDisplayCount = recentlyCheckedCount || allUnreadCount;

  return (
    <div
      data-testid="swipe-empty-state"
      className="max-w-md w-full mx-auto text-center rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-8 sm:p-10 shadow-elevation-1"
    >
      <div className="flex justify-center mb-4">
        <TidyShelfCheckIllustration className="w-24 h-20" />
      </div>

      {allUnreadCount > 0 ? (
        <>
          <span className="metadata-eyebrow block mb-1">Checked Recently</span>
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
                  {allUnreadCount}
                </span>{' '}
                remaining unread {allUnreadCount === 1 ? 'book' : 'books'} back
                in {friendlyReturnTime}—or you can flip through{' '}
                {allUnreadCount === 1 ? 'it' : 'them'} again whenever you like.
              </>
            ) : (
              <>
                You&apos;ve looked over your{' '}
                <span className="font-mono font-semibold text-on-surface tabular-nums">
                  {checkedDisplayCount}
                </span>{' '}
                unread {checkedDisplayCount === 1 ? 'book' : 'books'}{' '}
                recently—we&apos;ll bring{' '}
                {checkedDisplayCount === 1 ? 'it' : 'them'} back in{' '}
                {friendlyReturnTime}, or you can flip through{' '}
                {checkedDisplayCount === 1 ? 'it' : 'them'} again whenever you
                like.
              </>
            )}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              type="button"
              onClick={onBrowseAgain}
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
          <span className="metadata-eyebrow block mb-1">All Sorted</span>
          <h2 className="font-serif text-2xl font-semibold text-on-surface tracking-tight text-balance">
            Every Book Is Accounted For
          </h2>
          <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
            {totalBooksCount === 0
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
  );
}
