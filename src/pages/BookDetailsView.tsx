import React, {useState, useEffect} from 'react';
import {useParams, useNavigate, useLocation} from 'react-router-dom';
import {BookContent} from './book-details/BookContent';
import {Swiper, SwiperSlide} from 'swiper/react';
import {Virtual} from 'swiper/modules';
import type {Swiper as SwiperClass} from 'swiper';
import {useLibraryData} from '../hooks/useLibraryData';
import {useAuth} from '../stores/authStore';
import {PrefetchAdjacentBooks} from '../components/PrefetchAdjacentBooks';
import {getAccessFromLibrary} from '../hooks/useLibraryAccess';
import {ChevronLeft, ChevronRight} from 'lucide-react';

import 'swiper/css';
import 'swiper/css/virtual';

export default function BookDetailsView() {
  const {libraryId, bookId} = useParams<{libraryId: string; bookId: string}>();
  const navigate = useNavigate();
  const location = useLocation();

  const {user} = useAuth();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  // If we navigated here with a specified bookList, use it. Otherwise, fallback to library data.
  const {library, books: libraryBooks} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

  const access = getAccessFromLibrary(library, user?.uid, user?.email);
  const canEdit = access.canEdit;

  // Create bookList safely. If hard refreshed, libraryBooks will load eventually
  const bookList: string[] =
    location.state?.bookList ||
    (libraryBooks && libraryBooks.length > 0
      ? libraryBooks.map(b => b.id)
      : bookId
        ? [bookId]
        : []);

  const computedIndex = bookList.findIndex(id => id === bookId);
  const activeIndex = computedIndex >= 0 ? computedIndex : 0;

  const [swiperInstance, setSwiperInstance] = useState<SwiperClass | null>(
    null,
  );

  // Sync swiper physically when the derived activeIndex changes (e.g., via browser history)
  useEffect(() => {
    if (swiperInstance && swiperInstance.activeIndex !== activeIndex) {
      swiperInstance.slideTo(activeIndex, 0); // instantly slide without animation so it feels like history navigation
    }
  }, [activeIndex, swiperInstance]);

  const handleSlideChange = (swiper: SwiperClass) => {
    const newIndex = swiper.activeIndex;

    // Use computed activeIndex to check if we actually need to update the URL
    if (newIndex >= 0 && newIndex < bookList.length) {
      const currentBookId = bookList[newIndex];
      if (currentBookId !== bookId) {
        // Sync URL with the new active slide without storing to history stack excessively
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
    return <div className="h-full w-full bg-surface" />;
  }

  return (
    <>
      <PrefetchAdjacentBooks
        libraryId={libraryId}
        bookList={bookList}
        currentIndex={activeIndex}
        radius={3}
      />

      <div className="h-full w-full bg-surface overflow-hidden relative">
        {/* Desktop Previous Book Chevron */}
        {activeIndex > 0 && (
          <button
            onClick={() => swiperInstance?.slidePrev()}
            className="hidden md:flex fixed left-76 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-70 hover:opacity-100 cursor-pointer"
            title="Previous Book (Left Arrow)"
            aria-label="Previous Book"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Desktop Next Book Chevron */}
        {activeIndex < bookList.length - 1 && (
          <button
            onClick={() => swiperInstance?.slideNext()}
            className="hidden md:flex fixed right-6 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-outline-variant/30 shadow-md items-center justify-center transition-all opacity-70 hover:opacity-100 cursor-pointer"
            title="Next Book (Right Arrow)"
            aria-label="Next Book"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
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
                const distance = Math.abs(activeIndex - index);
                const shouldLoad = distance <= 2; // only mount hooks for adjacent and active slides

                if (!shouldLoad) {
                  return <div className="h-full w-full bg-surface" />; // skeleton placeholder
                }

                return (
                  <BookContent
                    libraryId={libraryId}
                    bookId={id}
                    isActive={isActive || activeIndex === index}
                    onNavigateBack={handleNavigateBack}
                    canEdit={canEdit}
                  />
                );
              }}
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </>
  );
}
