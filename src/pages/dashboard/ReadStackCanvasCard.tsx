import React, {useEffect, useRef, useState, useMemo, useCallback} from 'react';
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
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import type {TrackedBookItem} from '../../server/services/readingTracker';

interface ReadStackCanvasCardProps {
  finishedBooks: TrackedBookItem[];
  onOpenAllRead: () => void;
  onTrackBook: () => void;
}

interface StackPose {
  dxRatio: number;
  dyRatio: number;
  angleDeg: number;
}

// Deterministic messy bedside-table stack poses (slot 0 = bottom of pile -> slot 4 = top of pile)
const MESSY_STACK_POSES: StackPose[] = [
  {dxRatio: -0.15, dyRatio: 0.07, angleDeg: -13.5},
  {dxRatio: 0.14, dyRatio: 0.05, angleDeg: 10.5},
  {dxRatio: -0.1, dyRatio: -0.04, angleDeg: -7.5},
  {dxRatio: 0.09, dyRatio: -0.02, angleDeg: 6.5},
  {dxRatio: 0.0, dyRatio: 0.01, angleDeg: -2.0},
];

const MONOGRAPH_PALETTES = [
  {bgTop: '#FAF6EE', bgBottom: '#EDE5D5', accent: '#7C2D12', ink: '#292524'},
  {bgTop: '#F3F6F4', bgBottom: '#E0E8E3', accent: '#14532D', ink: '#1C2826'},
  {bgTop: '#F5F3F7', bgBottom: '#E5E0EC', accent: '#4C1D95', ink: '#272130'},
  {bgTop: '#FDF8F3', bgBottom: '#EFE4D8', accent: '#9A3412', ink: '#2A221E'},
  {bgTop: '#F4F6F8', bgBottom: '#E1E6EC', accent: '#1E3A8A', ink: '#1E2530'},
];

interface AnimatedBookPose {
  dxRatio: number;
  dyRatio: number;
  angleDeg: number;
  lift: number;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        if (lines.length >= maxLines) {
          const last = lines[lines.length - 1];
          lines[lines.length - 1] =
            last.length > 3 ? `${last.slice(0, -2)}…` : `${last}…`;
          return lines;
        }
      }
      currentLine = word;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines;
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

  // stackBooks[0] is #1 (most recently read), up to stackBooks[4] (#5 most recent)
  const stackBooks = useMemo(() => {
    return finishedBooks.slice(0, 5);
  }, [finishedBooks]);

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [imageTick, setImageTick] = useState(0);

  const safeActiveIndex = activeIndex < stackBooks.length ? activeIndex : 0;
  const activeBook = stackBooks[safeActiveIndex] || null;

  // Draw order from bottom of pile (slot 0) to top of pile (slot N-1):
  // All non-active books sit underneath in chronological order, and safeActiveIndex sits on top!
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

  // Preload cover images for the 5 books in the stack
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

  // Compute target pose for a given book index based on its current slot in drawOrder and live drag offset
  const getTargetPoseForBook = useCallback(
    (bookIndex: number): AnimatedBookPose => {
      const total = stackBooks.length;
      const slotIndex = drawOrder.indexOf(bookIndex);
      const effectiveSlot = slotIndex >= 0 ? slotIndex : 0;
      const poseOffset = MESSY_STACK_POSES.length - total + effectiveSlot;
      const basePose =
        MESSY_STACK_POSES[
          Math.max(0, Math.min(MESSY_STACK_POSES.length - 1, poseOffset))
        ];

      const isTopBook = bookIndex === safeActiveIndex;
      const isHovered = hoveredIndex === bookIndex;
      const dragPx = dragOffsetPxRef.current;
      const isDragging = Math.abs(dragPx) > 1;

      if (isTopBook && isDragging) {
        const clampedDrag = Math.max(-140, Math.min(140, dragPx));
        return {
          dxRatio: basePose.dxRatio + (clampedDrag / 280) * 0.65,
          dyRatio: basePose.dyRatio - Math.abs(clampedDrag / 280) * 0.04,
          angleDeg: basePose.angleDeg + (clampedDrag / 280) * 16,
          lift: 1.1,
        };
      }

      if (isDragging && total > 1) {
        const nextCandidateIndex =
          dragPx < 0
            ? (safeActiveIndex + 1) % total
            : (safeActiveIndex - 1 + total) % total;
        if (bookIndex === nextCandidateIndex) {
          const topPose = MESSY_STACK_POSES[MESSY_STACK_POSES.length - 1];
          const progress = Math.min(1, Math.abs(dragPx) / 85);
          return {
            dxRatio:
              basePose.dxRatio +
              (topPose.dxRatio - basePose.dxRatio) * progress,
            dyRatio:
              basePose.dyRatio +
              (topPose.dyRatio - basePose.dyRatio) * progress,
            angleDeg:
              basePose.angleDeg +
              (topPose.angleDeg - basePose.angleDeg) * progress,
            lift: 0.35 * progress,
          };
        }
      }

      const lift = isHovered ? 1 : isTopBook ? 0.35 : 0;

      return {
        dxRatio: basePose.dxRatio,
        dyRatio: basePose.dyRatio,
        angleDeg: basePose.angleDeg * (isHovered ? 0.55 : 1),
        lift,
      };
    },
    [stackBooks.length, drawOrder, safeActiveIndex, hoveredIndex],
  );

  const getBookGeometry = useCallback(
    (bookIndex: number, width: number, height: number) => {
      const currentPose =
        animatedPosesRef.current[bookIndex] || getTargetPoseForBook(bookIndex);

      const bookH = Math.min(height * 0.68, 156);
      const bookW = bookH * 0.67;
      const lift = currentPose.lift;

      const cx = width * 0.5 + currentPose.dxRatio * width;
      const cy = height * 0.52 + currentPose.dyRatio * height - lift * 7;
      const angleRad = (currentPose.angleDeg * Math.PI) / 180;
      const scale = 1 + lift * 0.045;

      return {
        cx,
        cy,
        bookW: bookW * scale,
        bookH: bookH * scale,
        angleRad,
        lift,
      };
    },
    [getTargetPoseForBook],
  );

  // Render the 2D Canvas scene
  const renderStackCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') {
      return;
    }
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) {
      return;
    }

    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 320;
    const height = rect.height || 220;

    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Subtle desk mat / archival ring watermark beneath the pile
    const centerGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.54,
      12,
      width * 0.5,
      height * 0.54,
      Math.min(width, height) * 0.46,
    );
    centerGrad.addColorStop(0, 'rgba(120, 113, 108, 0.10)');
    centerGrad.addColorStop(1, 'rgba(120, 113, 108, 0.0)');
    ctx.fillStyle = centerGrad;
    ctx.beginPath();
    ctx.ellipse(
      width * 0.5,
      height * 0.55,
      width * 0.38,
      height * 0.32,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Draw books in drawOrder (bottom of pile -> top of pile)
    drawOrder.forEach(bookIndex => {
      const book = stackBooks[bookIndex];
      if (!book) {
        return;
      }

      const {cx, cy, bookW, bookH, angleRad, lift} = getBookGeometry(
        bookIndex,
        width,
        height,
      );
      const halfW = bookW / 2;
      const halfH = bookH / 2;
      const pageBlockDepth = 6;
      const isTopBook = bookIndex === safeActiveIndex;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);

      // 1. Ambient & elevation drop shadow
      ctx.save();
      ctx.shadowColor =
        isTopBook || lift > 0.2
          ? 'rgba(28, 25, 23, 0.32)'
          : 'rgba(28, 25, 23, 0.20)';
      ctx.shadowBlur = 13 + lift * 12;
      ctx.shadowOffsetX = 3 + lift * 2;
      ctx.shadowOffsetY = 5 + lift * 6;
      drawRoundedRect(
        ctx,
        -halfW,
        -halfH,
        bookW + pageBlockDepth * 0.6,
        bookH + pageBlockDepth * 0.6,
        6,
      );
      ctx.fillStyle = '#E7E0D3';
      ctx.fill();
      ctx.restore();

      // 2. 3D Paper page-block edge (right + bottom thickness)
      drawRoundedRect(
        ctx,
        -halfW + pageBlockDepth,
        -halfH + pageBlockDepth,
        bookW,
        bookH,
        5,
      );
      ctx.fillStyle = '#EAE3D5';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 113, 108, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // 3. Book Cover surface
      ctx.save();
      drawRoundedRect(ctx, -halfW, -halfH, bookW, bookH, 5);
      ctx.clip();

      const cachedImg = book.coverUrl
        ? imageCacheRef.current.get(book.coverUrl)
        : undefined;

      if (cachedImg && cachedImg !== 'error') {
        try {
          ctx.drawImage(cachedImg, -halfW, -halfH, bookW, bookH);
        } catch {
          // Fallback if drawImage fails
        }
      } else {
        // Bespoke Archival Monograph Cover on Canvas
        const palette =
          MONOGRAPH_PALETTES[bookIndex % MONOGRAPH_PALETTES.length];
        const bgGrad = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
        bgGrad.addColorStop(0, palette.bgTop);
        bgGrad.addColorStop(1, palette.bgBottom);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(-halfW, -halfH, bookW, bookH);

        ctx.strokeStyle = 'rgba(120, 113, 108, 0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-halfW + 7, -halfH + 7, bookW - 14, bookH - 14);

        ctx.fillStyle = palette.accent;
        ctx.fillRect(-halfW + 12, -halfH + 13, bookW - 24, 2);

        ctx.fillStyle = palette.ink;
        ctx.font = '600 11px Georgia, "Newsreader", serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const titleLines = wrapCanvasText(
          ctx,
          toTitleCase(book.title),
          bookW - 26,
          3,
        );
        titleLines.forEach((line, lineIdx) => {
          ctx.fillText(line, -halfW + 12, -halfH + 22 + lineIdx * 13.5);
        });

        ctx.fillStyle = 'rgba(68, 64, 60, 0.85)';
        ctx.font = '500 8.5px system-ui, sans-serif';
        const authorLines = wrapCanvasText(
          ctx,
          toTitleCase(book.author || 'Unknown'),
          bookW - 26,
          1,
        );
        if (authorLines[0]) {
          ctx.fillText(authorLines[0], -halfW + 12, halfH - 21);
        }
      }

      // 4. Tactile Book Spine Crease & Specular Highlight
      const spineGrad = ctx.createLinearGradient(-halfW, 0, -halfW + 10, 0);
      spineGrad.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
      spineGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.24)');
      spineGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
      spineGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spineGrad;
      ctx.fillRect(-halfW, -halfH, 10, bookH);

      ctx.restore();

      // 5. Outer Cover Rim & Active Highlight Ring
      drawRoundedRect(ctx, -halfW, -halfH, bookW, bookH, 5);
      ctx.strokeStyle = isTopBook
        ? 'rgba(154, 52, 18, 0.78)'
        : 'rgba(68, 64, 60, 0.25)';
      ctx.lineWidth = isTopBook ? 1.6 : 0.9;
      ctx.stroke();

      ctx.restore();
    });

    ctx.restore();
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

  // Smoothly animate book positions, angles, and lift when activeIndex or hoveredIndex changes
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

  // Repaint on resize
  useEffect(() => {
    const handleResize = () => renderStackCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderStackCanvas]);

  // Hit-test pointer coordinates in reverse drawOrder (from visually top-most book down to bottom)
  const hitTestStack = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || stackBooks.length === 0) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const width = rect.width || 320;
    const height = rect.height || 220;

    for (let s = drawOrder.length - 1; s >= 0; s--) {
      const bookIndex = drawOrder[s];
      const {cx, cy, bookW, bookH, angleRad} = getBookGeometry(
        bookIndex,
        width,
        height,
      );
      const dx = x - cx;
      const dy = y - cy;
      const cos = Math.cos(-angleRad);
      const sin = Math.sin(-angleRad);
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;

      if (
        Math.abs(localX) <= bookW / 2 + 4 &&
        Math.abs(localY) <= bookH / 2 + 4
      ) {
        return bookIndex;
      }
    }
    return null;
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
      // Tapping a peeking book underneath brings it to the top of the stack first
      setActiveIndex(hit);
      return;
    }

    const targetBook = activeBook || stackBooks[0];
    if (targetBook) {
      void navigate(
        `/library/${encodeURIComponent(targetBook.libraryId)}/book/${encodeURIComponent(targetBook.id)}`,
        {state: {from: '/'}},
      );
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
              onClick={() =>
                void navigate(
                  `/library/${encodeURIComponent(activeBook.libraryId)}/book/${encodeURIComponent(activeBook.id)}`,
                  {state: {from: '/'}},
                )
              }
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
