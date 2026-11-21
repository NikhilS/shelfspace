import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  Layers,
  Star,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {BedsideStackIllustration} from '@/components/ui/empty-state-illustrations';
import {ArchivalCoverImage} from '../../components/book/ArchivalCoverImage';
import {SharedCoverFrame} from '../../components/book/SharedCoverFrame';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {navigateWithCoverTransition} from '../../lib/bookCoverTransition';
import {
  useCoverTransitionStore,
  useShelfCoverLayoutId,
} from '../../stores/coverTransitionStore';
import type {TrackedBookItem} from '../../types';
import {
  type AnimatedBookPose,
  computeBookStackGeometry,
  computeTargetPoseForBook,
  hitTestReadStack,
  paintReadStackCanvas,
} from './readStackCanvasRenderer';

interface ReadStackCanvasCardProps {
  finishedBooks: TrackedBookItem[];
  onOpenAllRead: () => void;
  onTrackBook: () => void;
}

export function ReadStackCanvasCard({
  finishedBooks,
  onOpenAllRead,
  onTrackBook,
}: ReadStackCanvasCardProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement | 'error'>>(
    new Map(),
  );
  const animatedPosesRef = useRef<AnimatedBookPose[]>([]);
  const rafRef = useRef<number | null>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    lastX: number;
    lastTime: number;
    velocityPxPerSec: number;
    axisLock: 'none' | 'horizontal' | 'vertical';
  } | null>(null);
  const dragOffsetPxRef = useRef<number>(0);
  const didSwipeRef = useRef(false);

  const stackBooks = useMemo(() => {
    return finishedBooks.slice(0, 5);
  }, [finishedBooks]);

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [imageTick, setImageTick] = useState(0);

  const returnMatchedIndex = useCoverTransitionStore(state => {
    const active = state.activeTransition;
    if (
      !active ||
      active.phase !== 'to-shelf' ||
      active.originSurface !== 'bedside-stack'
    ) {
      return -1;
    }
    return stackBooks.findIndex(
      b => b.libraryId === active.libraryId && b.id === active.bookId,
    );
  });

  useLayoutEffect(() => {
    if (returnMatchedIndex >= 0 && returnMatchedIndex !== activeIndex) {
      setActiveIndex(returnMatchedIndex);
    }
  }, [returnMatchedIndex, activeIndex]);

  const effectiveActiveIndex =
    returnMatchedIndex >= 0 ? returnMatchedIndex : activeIndex;
  const safeActiveIndex =
    effectiveActiveIndex < stackBooks.length ? effectiveActiveIndex : 0;
  const activeBook = stackBooks[safeActiveIndex] || null;
  const bedsideCoverLayoutId = useShelfCoverLayoutId(
    'bedside-stack',
    activeBook?.libraryId,
    activeBook?.id,
  );

  const openStackBookDetails = useCallback(
    (targetBook: TrackedBookItem) => {
      navigateWithCoverTransition({
        navigate,
        libraryId: targetBook.libraryId,
        bookId: targetBook.id,
        originSurface: 'bedside-stack',
        fromRouteKey: '/',
        coverPreview: {
          title: targetBook.title,
          author: targetBook.author,
          coverUrl: targetBook.coverUrl,
          publishedDate: targetBook.publishedDate,
          primaryGenre: targetBook.primaryGenre,
          subgenres: targetBook.subgenres,
          series: targetBook.series,
          synopsis: targetBook.synopsis,
          readingStatus: targetBook.readingStatus,
          ownershipStatus: targetBook.ownershipStatus,
          format: targetBook.format,
          isbn: targetBook.isbn,
        },
      });
    },
    [navigate],
  );

  const drawOrder = useMemo(() => {
    const total = stackBooks.length;
    if (total === 0) {
      return [];
    }
    const others: number[] = [];
    for (let i = total - 1; i >= 0; i--) {
      if (i !== safeActiveIndex) {
        others.push(i);
      }
    }
    return [...others, safeActiveIndex];
  }, [stackBooks.length, safeActiveIndex]);

  useEffect(() => {
    let isMounted = true;
    stackBooks.forEach(book => {
      const url = book.coverUrl;
      if (!url || imageCacheRef.current.has(url)) {
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        imageCacheRef.current.set(url, img);
        if (isMounted) {
          setImageTick(t => t + 1);
        }
      };
      img.onerror = () => {
        const fallbackImg = new Image();
        fallbackImg.referrerPolicy = 'no-referrer';
        fallbackImg.onload = () => {
          imageCacheRef.current.set(url, fallbackImg);
          if (isMounted) {
            setImageTick(t => t + 1);
          }
        };
        fallbackImg.onerror = () => {
          imageCacheRef.current.set(url, 'error');
          if (isMounted) {
            setImageTick(t => t + 1);
          }
        };
        fallbackImg.src = url;
      };
      img.src = url;
    });
    return () => {
      isMounted = false;
    };
  }, [stackBooks]);

  const getTargetPoseForBook = useCallback(
    (bookIndex: number): AnimatedBookPose =>
      computeTargetPoseForBook({
        bookIndex,
        totalBooks: stackBooks.length,
        drawOrder,
        safeActiveIndex,
        hoveredIndex,
        dragOffsetPx: dragOffsetPxRef.current,
      }),
    [stackBooks.length, drawOrder, safeActiveIndex, hoveredIndex],
  );

  const getBookGeometry = useCallback(
    (bookIndex: number, width: number, height: number) => {
      const currentPose =
        animatedPosesRef.current[bookIndex] || getTargetPoseForBook(bookIndex);
      return computeBookStackGeometry(currentPose, width, height);
    },
    [getTargetPoseForBook],
  );

  const renderStackCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    paintReadStackCanvas({
      canvas,
      stackBooks,
      drawOrder,
      safeActiveIndex,
      imageCache: imageCacheRef.current,
      getGeometry: getBookGeometry,
    });
  }, [stackBooks, drawOrder, getBookGeometry, safeActiveIndex]);

  const startPoseAnimationLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }

    const step = () => {
      let needsMoreFrames = false;
      for (let i = 0; i < stackBooks.length; i++) {
        const target = getTargetPoseForBook(i);
        const current = animatedPosesRef.current[i] || {...target};

        const dDx = target.dxRatio - current.dxRatio;
        const dDy = target.dyRatio - current.dyRatio;
        const dAngle = target.angleDeg - current.angleDeg;
        const dLift = target.lift - current.lift;

        if (
          Math.abs(dDx) > 0.002 ||
          Math.abs(dDy) > 0.002 ||
          Math.abs(dAngle) > 0.08 ||
          Math.abs(dLift) > 0.01
        ) {
          animatedPosesRef.current[i] = {
            dxRatio: current.dxRatio + dDx * 0.28,
            dyRatio: current.dyRatio + dDy * 0.28,
            angleDeg: current.angleDeg + dAngle * 0.28,
            lift: current.lift + dLift * 0.28,
          };
          needsMoreFrames = true;
        } else {
          animatedPosesRef.current[i] = target;
        }
      }
      renderStackCanvas();
      if (needsMoreFrames) {
        rafRef.current = window.requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = window.requestAnimationFrame(step);
  }, [stackBooks.length, getTargetPoseForBook, renderStackCanvas]);

  useEffect(() => {
    startPoseAnimationLoop();
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    safeActiveIndex,
    hoveredIndex,
    stackBooks,
    imageTick,
    startPoseAnimationLoop,
  ]);

  useEffect(() => {
    const handleResize = () => renderStackCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderStackCanvas]);

  const hitTestStack = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || stackBooks.length === 0) {
      return null;
    }
    return hitTestReadStack({
      canvas,
      clientX,
      clientY,
      drawOrder,
      getGeometry: getBookGeometry,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestStack(e.clientX, e.clientY);
    if (hit !== hoveredIndex) {
      setHoveredIndex(hit);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const now = performance.now();
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        lastX: e.touches[0].clientX,
        lastTime: now,
        velocityPxPerSec: 0,
        axisLock: 'none',
      };
      dragOffsetPxRef.current = 0;
      didSwipeRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const gesture = touchStartRef.current;
    if (!gesture || e.touches.length !== 1 || stackBooks.length <= 1) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;

    if (gesture.axisLock === 'none') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        gesture.axisLock = 'horizontal';
      } else {
        gesture.axisLock = 'vertical';
        return;
      }
    }

    if (gesture.axisLock !== 'horizontal') {
      return;
    }

    const now = performance.now();
    const dt = now - gesture.lastTime;
    if (dt > 0) {
      const instVx = ((touch.clientX - gesture.lastX) / dt) * 1000;
      gesture.velocityPxPerSec =
        gesture.velocityPxPerSec * 0.35 + instVx * 0.65;
      gesture.lastX = touch.clientX;
      gesture.lastTime = now;
    }

    dragOffsetPxRef.current = dx;
    if (animatedPosesRef.current[safeActiveIndex]) {
      animatedPosesRef.current[safeActiveIndex] =
        getTargetPoseForBook(safeActiveIndex);
    }
    startPoseAnimationLoop();
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const gesture = touchStartRef.current;
    touchStartRef.current = null;
    dragOffsetPxRef.current = 0;

    if (!gesture || e.changedTouches.length === 0) {
      startPoseAnimationLoop();
      return;
    }

    const deltaX = e.changedTouches[0].clientX - gesture.x;
    const deltaY = e.changedTouches[0].clientY - gesture.y;
    const vx = gesture.velocityPxPerSec;

    const isHorizontalGesture =
      gesture.axisLock === 'horizontal' ||
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

    if (
      stackBooks.length > 1 &&
      isHorizontalGesture &&
      (Math.abs(deltaX) > 30 || (Math.abs(deltaX) > 16 && Math.abs(vx) > 350))
    ) {
      didSwipeRef.current = true;
      if (deltaX < 0) {
        setActiveIndex(prev => (prev + 1) % stackBooks.length);
      } else {
        setActiveIndex(
          prev => (prev - 1 + stackBooks.length) % stackBooks.length,
        );
      }
    } else {
      startPoseAnimationLoop();
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }

    const hit = hitTestStack(e.clientX, e.clientY);
    if (hit !== null && hit !== safeActiveIndex) {
      setActiveIndex(hit);
      return;
    }

    const targetBook = activeBook || stackBooks[0];
    if (targetBook) {
      openStackBookDetails(targetBook);
    }
  };

  const handleStepPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stackBooks.length <= 1) {
      return;
    }
    setActiveIndex(prev => (prev - 1 + stackBooks.length) % stackBooks.length);
  };

  const handleStepNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stackBooks.length <= 1) {
      return;
    }
    setActiveIndex(prev => (prev + 1) % stackBooks.length);
  };

  return (
    <div className="bento-card p-5 sm:p-6 flex flex-col justify-between h-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="metadata-eyebrow flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Recently Finished Stack
          </span>
          <h3 className="font-serif text-lg sm:text-xl font-semibold text-on-surface tracking-tight mt-0.5">
            {finishedBooks.length > 0
              ? `Last ${stackBooks.length} Read`
              : 'Books You’ve Read'}
          </h3>
        </div>
        {finishedBooks.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenAllRead}
            className="text-xs font-sans font-semibold text-primary hover:text-primary/80 h-8 px-2.5 -mr-2 flex items-center gap-1 shrink-0"
          >
            <span>All {finishedBooks.length} Read</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {stackBooks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
          <BedsideStackIllustration className="mb-2.5" />
          <p className="font-serif text-base font-semibold text-on-surface mb-1">
            Your Finished Stack is Waiting
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-xs mb-4 leading-relaxed">
            Finish a book and your last five reads will pile up here in a
            tactile bedside stack.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={onTrackBook}
            className="text-xs font-sans font-semibold rounded-lg h-8 px-3.5 disabled:opacity-50"
          >
            Log a Finished Book
          </Button>
        </div>
      ) : (
        <>
          {/* Interactive 2D Canvas Messy Pile */}
          <div className="relative w-full h-[210px] sm:h-[225px] flex items-center justify-center my-1 select-none">
            <canvas
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredIndex(null)}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onClick={handleCanvasClick}
              aria-label={`Interactive stack of your last ${stackBooks.length} finished books`}
              className="w-full h-full block cursor-pointer touch-pan-y"
            />

            {/* Shared-Element Cover Anchor for Top Book on Pile */}
            {activeBook && (
              <SharedCoverFrame
                surface="bedside-stack"
                libraryId={activeBook.libraryId}
                bookId={activeBook.id}
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[49%] -rotate-2 w-[100px] sm:w-[104px] aspect-[2/3] rounded-[5px] overflow-hidden"
              >
                {bedsideCoverLayoutId && (
                  <ArchivalCoverImage
                    src={activeBook.coverUrl}
                    alt={activeBook.title}
                    author={activeBook.author}
                    variant="compact"
                    showSpineHighlight={true}
                    className="w-full h-full book-cover-shadow border border-outline-variant/60"
                  />
                )}
              </SharedCoverFrame>
            )}

            {/* Touch-Friendly Stack Shuffle Stepper (‹ 1 / 5 ›) */}
            {stackBooks.length > 1 && (
              <div
                className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 bg-surface/92 backdrop-blur-md px-1 py-0.5 rounded-full border border-outline-variant/60 shadow-xs"
                role="group"
                aria-label="Cycle through stacked books"
              >
                <button
                  type="button"
                  onClick={handleStepPrev}
                  aria-label="Previous book in stack"
                  title="Previous book in stack"
                  className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono tabular-nums text-[11px] font-semibold text-on-surface px-1.5 select-none">
                  {safeActiveIndex + 1} / {stackBooks.length}
                </span>
                <button
                  type="button"
                  onClick={handleStepNext}
                  aria-label="Next book in stack"
                  title="Next book in stack"
                  className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Active Top-of-Stack Book Callout Footer */}
          {activeBook && (
            <div
              onClick={() => openStackBookDetails(activeBook)}
              className="mt-2 pt-3 border-t border-outline-variant/50 flex items-center justify-between gap-3 cursor-pointer group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                    {safeActiveIndex === 0
                      ? 'Most Recent Read'
                      : `#${safeActiveIndex + 1} in Recent Stack`}
                  </span>
                  {typeof activeBook.userRating === 'number' &&
                    activeBook.userRating > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-mono tabular-nums text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        {activeBook.userRating}/5
                      </span>
                    )}
                </div>
                <p className="font-serif text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                  {toTitleCase(activeBook.title)}
                </p>
                <p className="font-sans text-xs text-on-surface-variant truncate">
                  {toTitleCase(activeBook.author)}
                  {' · '}
                  {activeBook.ownershipStatus === 'unowned' ||
                  activeBook.isVirtual
                    ? 'Un-owned'
                    : `In ${toTitleCase(activeBook.libraryName)}`}
                </p>
              </div>
              <span className="text-xs font-sans font-semibold text-primary group-hover:translate-x-0.5 transition-transform shrink-0">
                Open →
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
