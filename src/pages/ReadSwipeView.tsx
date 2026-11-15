import React from 'react';
import {useParams} from 'react-router-dom';
import {AnimatePresence, motion} from 'motion/react';
import {ArrowLeft, ArrowRight} from 'lucide-react';
import {BookLoader} from '../components/book/BookLoader';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {toTitleCase} from '../lib/utils';
import {
  DraggableSwipeCard,
  ReadSwipeEmptyState,
  ReadSwipeStatusBanner,
  SwipeBookFace,
  UNDO_SPRING_TRANSITION,
  cardSlotVariants,
} from './read-swipe/ReadSwipeCardDeck';
import {useReadSwipeSession} from './read-swipe/useReadSwipeSession';

export function ReadSwipeView() {
  const {id: libraryId} = useParams<{id: string}>();
  const {
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
    allUnreadCount,
    recentlyCheckedCount,
    friendlyReturnTime,
    lastSwipe,
    exitDirection,
    transitionMode,
    rewindFromDirection,
    mutationError,
    handleSwipeDecision,
    handleUndoLastSwipe,
    handleBrowseRecentlyCheckedAgain,
  } = useReadSwipeSession(libraryId);

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex-1 flex flex-col">
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

        <ReadSwipeStatusBanner
          mutationError={mutationError}
          lastSwipe={lastSwipe}
          isOnline={isOnline}
          onUndoLastSwipe={handleUndoLastSwipe}
        />

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
              <div className="relative w-full h-[460px] sm:h-[495px]">
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
            <ReadSwipeEmptyState
              libraryId={libraryId}
              totalBooksCount={books.length}
              allUnreadCount={allUnreadCount}
              recentlyCheckedCount={recentlyCheckedCount}
              reviewedCount={reviewedCount}
              markedReadCount={markedReadCount}
              friendlyReturnTime={friendlyReturnTime}
              onBrowseAgain={handleBrowseRecentlyCheckedAgain}
            />
          )}
        </div>
      </div>
    </div>
  );
}
