import React, {useState, useEffect} from 'react';
import {useParams, useNavigate, useLocation} from 'react-router-dom';
import {BookContent} from './book-details/BookContent';
import {Swiper, SwiperSlide} from 'swiper/react';
import {Virtual} from 'swiper/modules';
import type {Swiper as SwiperClass} from 'swiper';
import {useQueryClient} from '@tanstack/react-query';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';
import {useAuth} from '../stores/authStore';
import {PrefetchAdjacentBooks} from '../components/PrefetchAdjacentBooks';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {BackToLibrary} from '../components/BackToLibrary';
import {Button} from '@/components/ui/button';
import {Book} from '../types';

import 'swiper/css';
import 'swiper/css/virtual';

export default function BookDetailsView() {
  const {libraryId, bookId} = useParams<{libraryId: string; bookId: string}>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const {user} = useAuth();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  // Fetch only library permissions for canEdit; do NOT subscribe to the entire books collection
  const {canEdit} = useLibraryPermissions(libraryId, user?.uid);

  // Check TanStack Query cache for existing books (present if navigated from bookshelf)
  const cachedBooks = libraryId
    ? queryClient.getQueryData<Book[]>(['books', libraryId])
    : undefined;

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

  const [swiperInstance, setSwiperInstance] = useState<SwiperClass | null>(
    null,
  );
  const [currentSlideIndex, setCurrentSlideIndex] = useState(activeIndex);

  // Sync internal slide tracker if activeIndex changes from URL change
  useEffect(() => {
    setCurrentSlideIndex(activeIndex);
  }, [activeIndex]);

  // Sync swiper physically when the derived activeIndex changes (e.g., via browser history)
  useEffect(() => {
    if (swiperInstance && swiperInstance.activeIndex !== activeIndex) {
      swiperInstance.slideTo(activeIndex, 0); // instantly slide without animation so it feels like history navigation
    }
  }, [activeIndex, swiperInstance]);

  const handleSlideChange = (swiper: SwiperClass) => {
    // Keep internal index in sync during swipe for responsive counter and desktop chevrons
    setCurrentSlideIndex(swiper.activeIndex);
  };

  const handleSlideChangeTransitionEnd = (swiper: SwiperClass) => {
    const newIndex = swiper.activeIndex;
    setCurrentSlideIndex(newIndex);

    // Commit URL route change ONLY when gesture transition has completely settled
    if (newIndex >= 0 && newIndex < bookList.length) {
      const currentBookId = bookList[newIndex];
      if (currentBookId !== bookId) {
        void navigate(`/library/${libraryId}/book/${currentBookId}`, {
          state: {from: backUrl, bookList},
          replace: true,
        });
      }
    }
  };

  const handleNavigateBack = () => {
    // If the book does not exist, or delete was performed, we want to go back
    void navigate(backUrl, {replace: true});
  };

  // Keyboard navigation support for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        swiperInstance?.slidePrev();
      } else if (e.key === 'ArrowRight') {
        swiperInstance?.slideNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [swiperInstance]);

  if (!libraryId || bookList.length === 0) {
    return (
      <div className="h-full w-full bg-surface flex flex-col">
        <div className="w-full bg-surface/90 backdrop-blur-md border-b border-surface-variant/40 z-20 shrink-0 shadow-xs">
          <div className="layout-container py-1.5 flex items-center justify-between">
            <BackToLibrary libraryId={libraryId} customTo={backUrl} />
          </div>
        </div>
        <div className="layout-page-content flex flex-col items-center justify-center min-h-[40vh] text-center">
          <p className="font-serif text-xl text-primary mb-2">Book Not Found</p>
          <p className="text-sm text-on-surface-variant mb-6">
            This volume could not be loaded or the library contains no books.
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
        currentIndex={currentSlideIndex}
        radius={2}
      />

      <div className="h-full w-full bg-surface overflow-hidden relative flex flex-col">
        {/* Top Navigation Bar with Back to Library */}
        <div className="w-full bg-surface/90 backdrop-blur-md border-b border-surface-variant/40 z-20 shrink-0 shadow-xs">
          <div className="layout-container py-1.5 flex items-center justify-between">
            <BackToLibrary libraryId={libraryId} customTo={backUrl} />
            {bookList.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-sans text-on-surface-variant font-medium">
                  {currentSlideIndex + 1} of {bookList.length}
                </span>
                <div className="flex items-center gap-0.5 border border-outline-variant/30 rounded-full p-0.5 bg-surface-container-low">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => swiperInstance?.slidePrev()}
                    disabled={currentSlideIndex <= 0}
                    className="w-7 h-7 min-w-[28px] min-h-[28px] rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface-variant disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous Book"
                    title="Previous Book"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => swiperInstance?.slideNext()}
                    disabled={currentSlideIndex >= bookList.length - 1}
                    className="w-7 h-7 min-w-[28px] min-h-[28px] rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface-variant disabled:cursor-not-allowed transition-colors"
                    aria-label="Next Book"
                    title="Next Book"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content & Swiper area */}
        <div className="flex-1 min-h-0 w-full relative">
          {/* Desktop Previous Book Chevron */}
          {currentSlideIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => swiperInstance?.slidePrev()}
              className="hidden md:flex fixed left-76 top-1/2 -translate-y-1/2 z-20 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-70 hover:opacity-100"
              title="Previous Book (Left Arrow)"
              aria-label="Previous Book"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}

          {/* Desktop Next Book Chevron */}
          {currentSlideIndex < bookList.length - 1 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => swiperInstance?.slideNext()}
              className="hidden md:flex fixed right-6 top-1/2 -translate-y-1/2 z-20 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-70 hover:opacity-100"
              title="Next Book (Right Arrow)"
              aria-label="Next Book"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          )}

          <Swiper
            modules={[Virtual]}
            virtual={{
              enabled: true,
              addSlidesAfter: 2,
              addSlidesBefore: 2,
              cache: true,
            }}
            slidesPerView={1}
            initialSlide={activeIndex}
            onSwiper={setSwiperInstance}
            onSlideChange={handleSlideChange}
            onSlideChangeTransitionEnd={handleSlideChangeTransitionEnd}
            className="h-full w-full"
            resistanceRatio={0.85} // Make 'bouncing' at edges feel nice
            threshold={12} // Require deliberate gesture before initiating swipe
            touchAngle={40} // Only swipe if gesture is predominantly horizontal
            noSwiping={true}
            noSwipingClass="swiper-no-swiping"
          >
            {bookList.map((id, index) => (
              <SwiperSlide key={id} virtualIndex={index}>
                {({isActive}) => {
                  // Lazily load BookContent based on distance from active slide
                  // to prevent Hook Spam and save connections.
                  const distance = Math.abs(currentSlideIndex - index);
                  const shouldLoad = distance <= 2; // only mount hooks for adjacent and active slides

                  if (!shouldLoad) {
                    return <div className="h-full w-full bg-surface" />; // skeleton placeholder
                  }

                  const isSlideActive = isActive || currentSlideIndex === index;

                  return (
                    <BookContent
                      libraryId={libraryId}
                      bookId={id}
                      isActive={isSlideActive}
                      onNavigateBack={handleNavigateBack}
                      canEdit={canEdit}
                    />
                  );
                }}
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      </div>
    </>
  );
}
