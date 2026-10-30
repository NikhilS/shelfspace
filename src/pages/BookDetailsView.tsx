import React, {useState, useEffect, useRef, useCallback} from 'react';
import {useParams, useNavigate, useLocation} from 'react-router-dom';
import {BookContent} from './book-details/BookContent';
import {
  BookSwipeDeck,
  type BookSwipeDeckHandle,
} from '../components/book/BookSwipeDeck';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';
import {useAuth} from '../stores/authStore';
import {PrefetchAdjacentBooks} from '../components/book/PrefetchAdjacentBooks';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {Button} from '@/components/ui/button';
import {MagnifyingBookmarkIllustration} from '@/components/ui/empty-state-illustrations';
import {Book} from '../types';
import {trpc} from '../lib/trpc';

export function BookDetailsView() {
  const {libraryId, bookId} = useParams<{libraryId: string; bookId: string}>();
  const navigate = useNavigate();
  const location = useLocation();
  const utils = trpc.useUtils();

  const {user} = useAuth();

  const backUrl =
    location.state?.from ||
    (libraryId?.startsWith('virtual_') ? '/' : `/library/${libraryId}`);

  // Fetch only library permissions for canEdit; do NOT subscribe to the entire books collection
  const {canEdit} = useLibraryPermissions(libraryId, user?.uid);

  // Check tRPC Query cache for existing books (present if navigated from bookshelf)
  const cachedData = libraryId
    ? utils.book.list.getData({libraryId})
    : undefined;

  const cachedBooks = Array.isArray(cachedData)
    ? (cachedData as Book[])
    : (cachedData as {books?: Book[]})?.books;

  // Single-subscriber pattern:
  // If navigated with state.bookList, use it.
  // Else if books are cached from bookshelf view, use cached IDs for carousel navigation.
  // Else (cold direct URL visit), use [bookId] without subscribing to the collection.
  const bookList: string[] =
    location.state?.bookList ||
    (cachedBooks && cachedBooks.length > 0
      ? cachedBooks.map(b => b.id)
      : bookId
        ? [bookId]
        : []);

  const computedIndex = bookList.findIndex(id => id === bookId);
  const activeIndex = computedIndex >= 0 ? computedIndex : 0;

  const deckRef = useRef<BookSwipeDeckHandle | null>(null);
  const [committedIndex, setCommittedIndex] = useState(activeIndex);

  // Sync committedIndex when activeIndex changes from URL/history navigation
  useEffect(() => {
    setCommittedIndex(activeIndex);
  }, [activeIndex]);

  const handleIndexCommit = useCallback(
    (newIndex: number) => {
      setCommittedIndex(newIndex);

      if (newIndex >= 0 && newIndex < bookList.length && libraryId) {
        const nextBookId = bookList[newIndex];
        if (nextBookId && nextBookId !== bookId) {
          void navigate(`/library/${libraryId}/book/${nextBookId}`, {
            state: {from: backUrl, bookList},
            replace: true,
          });
        }
      }
    },
    [backUrl, bookId, bookList, libraryId, navigate],
  );

  const handleNavigateBack = useCallback(() => {
    void navigate(backUrl, {replace: true});
  }, [backUrl, navigate]);

  // Keyboard navigation support for desktop (ArrowLeft / ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        deckRef.current?.slidePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        deckRef.current?.slideNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!libraryId || bookList.length === 0) {
    const isVirtualShelf = Boolean(libraryId?.startsWith('virtual_'));
    return (
      <div className="h-full w-full bg-surface flex flex-col">
        <div className="w-full bg-surface/90 backdrop-blur-md border-b border-surface-variant/40 z-20 shrink-0 shadow-xs">
          <div className="layout-container py-1.5 flex items-center justify-between">
            <BackToLibrary libraryId={libraryId} customTo={backUrl} />
          </div>
        </div>
        <div className="layout-page-content flex flex-col items-center justify-center min-h-[40vh] text-center">
          <MagnifyingBookmarkIllustration className="mb-3" />
          <p className="font-serif font-semibold text-xl text-primary mb-1.5">
            We Couldn&apos;t Find That Book
          </p>
          <p className="text-sm text-on-surface-variant mb-6 max-w-sm">
            {isVirtualShelf
              ? 'It may have been removed from your reading shelf.'
              : 'It may have been moved or removed from this library.'}
          </p>
          <BackToLibrary libraryId={libraryId} customTo={backUrl} />
        </div>
      </div>
    );
  }

  return (
    <>
      <PrefetchAdjacentBooks
        libraryId={libraryId}
        bookList={bookList}
        currentIndex={committedIndex}
        radius={2}
      />

      <div className="h-[calc(100dvh-4rem)] w-full bg-surface overflow-hidden relative flex flex-col">
        {/* Top Navigation Bar with Back to Library */}
        <div className="w-full bg-surface/90 backdrop-blur-md border-b border-surface-variant/40 z-20 shrink-0 shadow-xs">
          <div className="layout-container py-1.5 flex items-center justify-between">
            <BackToLibrary libraryId={libraryId} customTo={backUrl} />
            {bookList.length > 1 && (
              <div className="flex items-center gap-2">
                <span
                  data-testid="book-deck-counter"
                  className="text-xs font-sans font-mono tabular-nums text-on-surface-variant font-medium"
                >
                  {committedIndex + 1} of {bookList.length}
                </span>
                <div className="flex items-center gap-0.5 border border-outline-variant/30 rounded-lg p-0.5 bg-surface-container-low">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deckRef.current?.slidePrev()}
                    disabled={committedIndex <= 0}
                    className="w-7 h-7 min-w-[28px] min-h-[28px] rounded-md flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface-variant disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous Book"
                    title="Previous Book (Left Arrow)"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deckRef.current?.slideNext()}
                    disabled={committedIndex >= bookList.length - 1}
                    className="w-7 h-7 min-w-[28px] min-h-[28px] rounded-md flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface-variant disabled:cursor-not-allowed transition-colors"
                    aria-label="Next Book"
                    title="Next Book (Right Arrow)"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3-Slot GPU Motion Deck Area */}
        <div className="flex-1 min-h-0 w-full relative">
          {/* Desktop Previous Book Chevron */}
          {committedIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => deckRef.current?.slidePrev()}
              className="hidden md:flex fixed left-6 top-1/2 -translate-y-1/2 z-20 min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-75 hover:opacity-100"
              title="Previous Book (Left Arrow)"
              aria-label="Previous Book"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}

          {/* Desktop Next Book Chevron */}
          {committedIndex < bookList.length - 1 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => deckRef.current?.slideNext()}
              className="hidden md:flex fixed right-6 top-1/2 -translate-y-1/2 z-20 min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-75 hover:opacity-100"
              title="Next Book (Right Arrow)"
              aria-label="Next Book"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          )}

          <BookSwipeDeck
            ref={deckRef}
            bookIds={bookList}
            activeIndex={activeIndex}
            onIndexCommit={handleIndexCommit}
            renderSlide={({bookId: slideBookId, isActive}) => (
              <BookContent
                libraryId={libraryId}
                bookId={slideBookId}
                isActive={isActive}
                onNavigateBack={handleNavigateBack}
                canEdit={canEdit}
              />
            )}
          />
        </div>
      </div>
    </>
  );
}
