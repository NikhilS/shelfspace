import React, {useState, useEffect} from 'react';
import {useParams, useNavigate, useLocation} from 'react-router-dom';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {BookContent} from './book-details/BookContent';
import {Swiper, SwiperSlide} from 'swiper/react';
import {Virtual} from 'swiper/modules';
import type {Swiper as SwiperClass} from 'swiper';
import {useLibraryData} from '../hooks/useLibraryData';
import {useAuth} from '../contexts/AuthContext';
import {PrefetchAdjacentBooks} from '../components/PrefetchAdjacentBooks';

import 'swiper/css';
import 'swiper/css/virtual';

export default function BookDetailsView() {
  const {libraryId, bookId} = useParams<{libraryId: string; bookId: string}>();
  const navigate = useNavigate();
  const location = useLocation();

  const {user} = useAuth();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  // If we navigated here with a specified bookList, use it. Otherwise, fallback to library data.
  const {books: libraryBooks} = useLibraryData(libraryId, user?.uid, navigate);

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

  if (!libraryId || bookList.length === 0) {
    return (
      <>
        <LibrarySidebarNav libraryId={libraryId} />
        <div className="h-full w-full bg-surface" />
      </>
    );
  }

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />

      <PrefetchAdjacentBooks
        libraryId={libraryId}
        bookList={bookList}
        currentIndex={activeIndex}
        radius={3}
      />

      <div className="h-full w-full bg-surface overflow-hidden">
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
