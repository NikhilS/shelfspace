import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {motion, useMotionValue, animate} from 'motion/react';

export interface BookSwipeDeckHandle {
  slidePrev: () => void;
  slideNext: () => void;
  slideTo: (index: number, immediate?: boolean) => void;
}

export interface BookSwipeDeckSlotRenderParams {
  bookId: string;
  index: number;
  offset: -1 | 0 | 1;
  isActive: boolean;
}

export interface BookSwipeDeckProps {
  bookIds: string[];
  activeIndex: number;
  onIndexPreview?: (previewIndex: number) => void;
  onIndexCommit: (committedIndex: number) => void;
  renderSlide: (params: BookSwipeDeckSlotRenderParams) => React.ReactNode;
  className?: string;
}

interface TouchGestureState {
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityPxPerSec: number;
  axisLock: 'none' | 'horizontal' | 'vertical';
}

const SPRING_CONFIG = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 38,
  mass: 0.85,
};

const SNAP_BACK_SPRING_CONFIG = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 40,
  mass: 0.8,
};

const EDGE_RESISTANCE_FACTOR = 0.28;
const DIRECTION_LOCK_THRESHOLD_PX = 8;
const DIRECTION_LOCK_RATIO = 1.2;
const DISPLACEMENT_COMMIT_RATIO = 0.2;
const VELOCITY_COMMIT_PX_PER_SEC = 400;
const MIN_VELOCITY_TRAVEL_PX = 24;

function isInteractiveNoSwipeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      '[data-no-swipe="true"], .swiper-no-swiping, button, a, input, textarea, select, [role="button"], [role="combobox"], [role="slider"], [role="dialog"]',
    ),
  );
}

function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const BookSwipeDeck = forwardRef<
  BookSwipeDeckHandle,
  BookSwipeDeckProps
>(
  (
    {
      bookIds,
      activeIndex,
      onIndexPreview,
      onIndexCommit,
      renderSlide,
      className = '',
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragX = useMotionValue(0);

    const [deckIndex, setDeckIndex] = useState(() =>
      Math.max(0, Math.min(bookIds.length - 1, activeIndex)),
    );
    const deckIndexRef = useRef(deckIndex);
    deckIndexRef.current = deckIndex;

    const pendingTargetIndexRef = useRef<number | null>(null);
    const activeAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
    const gestureRef = useRef<TouchGestureState | null>(null);

    const stopActiveAnimation = useCallback(() => {
      if (activeAnimationRef.current) {
        activeAnimationRef.current.stop();
        activeAnimationRef.current = null;
      }
    }, []);

    const commitIndexAtomically = useCallback(
      (nextIndex: number) => {
        stopActiveAnimation();
        pendingTargetIndexRef.current = null;
        dragX.jump(0);
        deckIndexRef.current = nextIndex;
        setDeckIndex(nextIndex);
        onIndexPreview?.(nextIndex);
        onIndexCommit(nextIndex);
      },
      [dragX, onIndexCommit, onIndexPreview, stopActiveAnimation],
    );

    // Sync deckIndex if activeIndex changes externally (e.g. browser Back/Forward history)
    useEffect(() => {
      const clamped = Math.max(0, Math.min(bookIds.length - 1, activeIndex));
      if (
        clamped !== deckIndexRef.current &&
        pendingTargetIndexRef.current !== clamped
      ) {
        stopActiveAnimation();
        pendingTargetIndexRef.current = null;
        dragX.jump(0);
        deckIndexRef.current = clamped;
        setDeckIndex(clamped);
      }
    }, [activeIndex, bookIds.length, dragX, stopActiveAnimation]);

    // Cleanup animation on unmount
    useEffect(() => {
      return () => {
        stopActiveAnimation();
      };
    }, [stopActiveAnimation]);

    const getViewportWidth = useCallback((): number => {
      const width = containerRef.current?.clientWidth;
      if (width && width > 0) {
        return width;
      }
      return typeof window !== 'undefined' && window.innerWidth > 0
        ? window.innerWidth
        : 375;
    }, []);

    const animateStepBy = useCallback(
      (delta: -1 | 1, releaseVelocityPxPerSec = 0) => {
        // If a transition is already in flight, finalize it immediately so rapid taps/keys never drop or stutter
        if (pendingTargetIndexRef.current !== null) {
          commitIndexAtomically(pendingTargetIndexRef.current);
        }

        const currentIdx = deckIndexRef.current;
        const targetIdx = currentIdx + delta;
        if (targetIdx < 0 || targetIdx >= bookIds.length) {
          // Snap back if at boundary
          stopActiveAnimation();
          activeAnimationRef.current = animate(dragX, 0, {
            ...SNAP_BACK_SPRING_CONFIG,
            velocity: releaseVelocityPxPerSec,
          });
          return;
        }

        pendingTargetIndexRef.current = targetIdx;
        onIndexPreview?.(targetIdx);

        if (prefersReducedMotion()) {
          commitIndexAtomically(targetIdx);
          return;
        }

        const width = getViewportWidth();
        const targetX = delta === 1 ? -width : width;

        stopActiveAnimation();
        activeAnimationRef.current = animate(dragX, targetX, {
          ...SPRING_CONFIG,
          velocity: releaseVelocityPxPerSec,
          onComplete: () => {
            activeAnimationRef.current = null;
            if (pendingTargetIndexRef.current === targetIdx) {
              commitIndexAtomically(targetIdx);
            }
          },
        });
      },
      [
        bookIds.length,
        commitIndexAtomically,
        dragX,
        getViewportWidth,
        onIndexPreview,
        stopActiveAnimation,
      ],
    );

    const slidePrev = useCallback(() => {
      animateStepBy(-1, 0);
    }, [animateStepBy]);

    const slideNext = useCallback(() => {
      animateStepBy(1, 0);
    }, [animateStepBy]);

    const slideTo = useCallback(
      (targetIndex: number, immediate = false) => {
        const clamped = Math.max(0, Math.min(bookIds.length - 1, targetIndex));
        if (
          clamped === deckIndexRef.current &&
          pendingTargetIndexRef.current === null
        ) {
          return;
        }
        const diff = clamped - deckIndexRef.current;
        if (immediate || Math.abs(diff) > 1 || prefersReducedMotion()) {
          commitIndexAtomically(clamped);
          return;
        }
        animateStepBy(diff > 0 ? 1 : -1, 0);
      },
      [animateStepBy, bookIds.length, commitIndexAtomically],
    );

    useImperativeHandle(
      ref,
      () => ({
        slidePrev,
        slideNext,
        slideTo,
      }),
      [slidePrev, slideNext, slideTo],
    );

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length !== 1 || bookIds.length <= 1) {
        gestureRef.current = null;
        return;
      }

      if (isInteractiveNoSwipeTarget(e.target)) {
        gestureRef.current = null;
        return;
      }

      // If the user catches a settling card mid-flight, finalize the in-flight index if >50% complete or stop in place
      if (pendingTargetIndexRef.current !== null) {
        commitIndexAtomically(pendingTargetIndexRef.current);
      } else {
        stopActiveAnimation();
      }

      const touch = e.touches[0];
      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastTime: performance.now(),
        velocityPxPerSec: 0,
        axisLock: 'none',
      };
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || e.touches.length !== 1) {
        return;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;

      if (gesture.axisLock === 'none') {
        if (
          Math.abs(dx) < DIRECTION_LOCK_THRESHOLD_PX &&
          Math.abs(dy) < DIRECTION_LOCK_THRESHOLD_PX
        ) {
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) * DIRECTION_LOCK_RATIO) {
          gesture.axisLock = 'horizontal';
        } else {
          gesture.axisLock = 'vertical';
          return;
        }
      }

      if (gesture.axisLock === 'vertical') {
        return;
      }

      const now = performance.now();
      const dt = now - gesture.lastTime;
      if (dt > 0) {
        const instantVx = ((touch.clientX - gesture.lastX) / dt) * 1000;
        gesture.velocityPxPerSec =
          gesture.velocityPxPerSec * 0.35 + instantVx * 0.65;
        gesture.lastX = touch.clientX;
        gesture.lastTime = now;
      }

      const currentIdx = deckIndexRef.current;
      const isAtStartEdge = currentIdx <= 0 && dx > 0;
      const isAtEndEdge = currentIdx >= bookIds.length - 1 && dx < 0;

      const effectiveDx =
        isAtStartEdge || isAtEndEdge ? dx * EDGE_RESISTANCE_FACTOR : dx;

      dragX.set(effectiveDx);
    };

    const finishTouchGesture = (e: React.TouchEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;

      if (!gesture || gesture.axisLock !== 'horizontal') {
        return;
      }

      const changedTouch = e.changedTouches[0];
      const dx = changedTouch
        ? changedTouch.clientX - gesture.startX
        : dragX.get();
      const vx = gesture.velocityPxPerSec;
      const width = getViewportWidth();
      const currentIdx = deckIndexRef.current;

      const shouldAdvanceNext =
        currentIdx < bookIds.length - 1 &&
        (dx < -width * DISPLACEMENT_COMMIT_RATIO ||
          (dx < -MIN_VELOCITY_TRAVEL_PX && vx < -VELOCITY_COMMIT_PX_PER_SEC));

      const shouldAdvancePrev =
        currentIdx > 0 &&
        (dx > width * DISPLACEMENT_COMMIT_RATIO ||
          (dx > MIN_VELOCITY_TRAVEL_PX && vx > VELOCITY_COMMIT_PX_PER_SEC));

      if (shouldAdvanceNext) {
        animateStepBy(1, vx);
      } else if (shouldAdvancePrev) {
        animateStepBy(-1, vx);
      } else {
        stopActiveAnimation();
        activeAnimationRef.current = animate(dragX, 0, {
          ...SNAP_BACK_SPRING_CONFIG,
          velocity: vx,
        });
      }
    };

    // Compute constant O(1) 3-slot window: [prev, active, next]
    const slots: BookSwipeDeckSlotRenderParams[] = [];
    if (deckIndex > 0 && bookIds[deckIndex - 1]) {
      slots.push({
        bookId: bookIds[deckIndex - 1],
        index: deckIndex - 1,
        offset: -1,
        isActive: false,
      });
    }
    if (bookIds[deckIndex]) {
      slots.push({
        bookId: bookIds[deckIndex],
        index: deckIndex,
        offset: 0,
        isActive: true,
      });
    }
    if (deckIndex < bookIds.length - 1 && bookIds[deckIndex + 1]) {
      slots.push({
        bookId: bookIds[deckIndex + 1],
        index: deckIndex + 1,
        offset: 1,
        isActive: false,
      });
    }

    return (
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={finishTouchGesture}
        onTouchCancel={finishTouchGesture}
        data-testid="book-swipe-deck"
        className={`relative h-full w-full overflow-hidden touch-pan-y select-text ${className}`}
      >
        <motion.div
          style={{x: dragX}}
          className="relative h-full w-full will-change-transform"
        >
          {slots.map(slot => (
            <div
              key={slot.bookId}
              data-testid={`book-swipe-slot-${slot.offset}`}
              data-book-id={slot.bookId}
              aria-hidden={!slot.isActive}
              style={{
                transform: `translate3d(${slot.offset * 100}%, 0, 0)`,
              }}
              className="absolute inset-0 h-full w-full overflow-hidden"
            >
              {renderSlide(slot)}
            </div>
          ))}
        </motion.div>
      </div>
    );
  },
);
