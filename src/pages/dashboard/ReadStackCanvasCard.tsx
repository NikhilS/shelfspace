import React, {useEffect, useRef, useState, useMemo, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {Layers, Star, ArrowRight, BookOpen} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
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

// Deterministic messy bedside-table stack poses (bottom of stack -> top of stack)
const MESSY_STACK_POSES: StackPose[] = [
  {dxRatio: -0.14, dyRatio: 0.08, angleDeg: -13},
  {dxRatio: 0.13, dyRatio: 0.05, angleDeg: 10},
  {dxRatio: -0.09, dyRatio: -0.04, angleDeg: -7},
  {dxRatio: 0.08, dyRatio: -0.02, angleDeg: 6},
  {dxRatio: -0.01, dyRatio: 0.01, angleDeg: -2.5},
];

const MONOGRAPH_PALETTES = [
  {bgTop: '#FAF6EE', bgBottom: '#EDE5D5', accent: '#7C2D12', ink: '#292524'},
  {bgTop: '#F3F6F4', bgBottom: '#E0E8E3', accent: '#14532D', ink: '#1C2826'},
  {bgTop: '#F5F3F7', bgBottom: '#E5E0EC', accent: '#4C1D95', ink: '#272130'},
  {bgTop: '#FDF8F3', bgBottom: '#EFE4D8', accent: '#9A3412', ink: '#2A221E'},
  {bgTop: '#F4F6F8', bgBottom: '#E1E6EC', accent: '#1E3A8A', ink: '#1E2530'},
];

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

export const ReadStackCanvasCard: React.FC<ReadStackCanvasCardProps> = ({
  finishedBooks,
  onOpenAllRead,
  onTrackBook,
}) => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement | 'error'>>(
    new Map(),
  );
  const liftValuesRef = useRef<number[]>([0, 0, 0, 0, 0]);
  const rafRef = useRef<number | null>(null);

  // Take the 5 most recently read books, ordered bottom-to-top so the newest sits on top
  const stackBooks = useMemo(() => {
    return finishedBooks.slice(0, 5).reverse();
  }, [finishedBooks]);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageTick, setImageTick] = useState(0);

  const activeIndex =
    hoveredIndex !== null
      ? hoveredIndex
      : selectedIndex !== null && selectedIndex < stackBooks.length
        ? selectedIndex
        : stackBooks.length > 0
          ? stackBooks.length - 1
          : null;

  const activeBook = activeIndex !== null ? stackBooks[activeIndex] : null;

  // Preload cover images for the 5 books in the stack
  useEffect(() => {
    let isMounted = true;
    stackBooks.forEach(book => {
      const url = book.coverUrl;
      if (!url || imageCacheRef.current.has(url)) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        imageCacheRef.current.set(url, img);
        if (isMounted) setImageTick(t => t + 1);
      };
      img.onerror = () => {
        // Retry without crossOrigin if CORS header isn't present (still allows drawing on non-readback canvas)
        const fallbackImg = new Image();
        fallbackImg.referrerPolicy = 'no-referrer';
        fallbackImg.onload = () => {
          imageCacheRef.current.set(url, fallbackImg);
          if (isMounted) setImageTick(t => t + 1);
        };
        fallbackImg.onerror = () => {
          imageCacheRef.current.set(url, 'error');
          if (isMounted) setImageTick(t => t + 1);
        };
        fallbackImg.src = url;
      };
      img.src = url;
    });
    return () => {
      isMounted = false;
    };
  }, [stackBooks]);

  const getBookGeometry = useCallback(
    (index: number, total: number, width: number, height: number) => {
      const poseOffset = MESSY_STACK_POSES.length - total + index;
      const pose =
        MESSY_STACK_POSES[
          Math.max(0, Math.min(MESSY_STACK_POSES.length - 1, poseOffset))
        ];

      const bookH = Math.min(height * 0.68, 156);
      const bookW = bookH * 0.67;
      const lift = liftValuesRef.current[index] || 0;

      const cx = width * 0.5 + pose.dxRatio * width;
      const cy = height * 0.52 + pose.dyRatio * height - lift * 9;
      const angleRad = (pose.angleDeg * (1 - lift * 0.45) * Math.PI) / 180;
      const scale = 1 + lift * 0.055;

      return {
        cx,
        cy,
        bookW: bookW * scale,
        bookH: bookH * scale,
        angleRad,
        lift,
      };
    },
    [],
  );

  // Render the 2D Canvas scene
  const renderStackCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;

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

    // Draw books from bottom of stack to top
    stackBooks.forEach((book, idx) => {
      const {cx, cy, bookW, bookH, angleRad, lift} = getBookGeometry(
        idx,
        stackBooks.length,
        width,
        height,
      );
      const halfW = bookW / 2;
      const halfH = bookH / 2;
      const pageBlockDepth = 6;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);

      // 1. Ambient & elevation drop shadow
      ctx.save();
      ctx.shadowColor =
        lift > 0.1 ? 'rgba(28, 25, 23, 0.34)' : 'rgba(28, 25, 23, 0.22)';
      ctx.shadowBlur = 14 + lift * 12;
      ctx.shadowOffsetX = 3 + lift * 2;
      ctx.shadowOffsetY = 6 + lift * 6;
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
        const palette = MONOGRAPH_PALETTES[idx % MONOGRAPH_PALETTES.length];
        const bgGrad = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
        bgGrad.addColorStop(0, palette.bgTop);
        bgGrad.addColorStop(1, palette.bgBottom);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(-halfW, -halfH, bookW, bookH);

        // Editorial frame border inside cover
        ctx.strokeStyle = 'rgba(120, 113, 108, 0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-halfW + 7, -halfH + 7, bookW - 14, bookH - 14);

        // Top accent bar
        ctx.fillStyle = palette.accent;
        ctx.fillRect(-halfW + 12, -halfH + 13, bookW - 24, 2);

        // Wrapped Serif Title
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

        // Author at bottom
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
      ctx.strokeStyle =
        idx === activeIndex
          ? 'rgba(154, 52, 18, 0.75)'
          : 'rgba(68, 64, 60, 0.25)';
      ctx.lineWidth = idx === activeIndex ? 1.6 : 0.9;
      ctx.stroke();

      ctx.restore();
    });

    ctx.restore();
  }, [stackBooks, getBookGeometry, activeIndex]);

  // Smoothly animate lift values toward target hovered index
  useEffect(() => {
    let needsMoreFrames = false;
    const step = () => {
      needsMoreFrames = false;
      for (let i = 0; i < 5; i++) {
        const target = hoveredIndex === i ? 1 : 0;
        const current = liftValuesRef.current[i] || 0;
        const diff = target - current;
        if (Math.abs(diff) > 0.01) {
          liftValuesRef.current[i] = current + diff * 0.25;
          needsMoreFrames = true;
        } else {
          liftValuesRef.current[i] = target;
        }
      }
      renderStackCanvas();
      if (needsMoreFrames) {
        rafRef.current = window.requestAnimationFrame(step);
      }
    };

    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [hoveredIndex, stackBooks, imageTick, renderStackCanvas]);

  // Repaint on resize
  useEffect(() => {
    const handleResize = () => renderStackCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderStackCanvas]);

  // Hit-test pointer coordinates against rotated books from top of pile to bottom
  const hitTestStack = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || stackBooks.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const width = rect.width || 320;
    const height = rect.height || 220;

    for (let idx = stackBooks.length - 1; idx >= 0; idx--) {
      const {cx, cy, bookW, bookH, angleRad} = getBookGeometry(
        idx,
        stackBooks.length,
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
        return idx;
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

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestStack(e.clientX, e.clientY);
    const targetBook =
      hit !== null
        ? stackBooks[hit]
        : activeBook || stackBooks[stackBooks.length - 1];
    if (targetBook) {
      void navigate(
        `/library/${encodeURIComponent(targetBook.libraryId)}/book/${encodeURIComponent(targetBook.id)}`,
        {state: {from: '/'}},
      );
    }
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
          <div className="w-11 h-11 rounded-full bg-surface-container flex items-center justify-center text-primary/70 mb-3 border border-outline-variant/50">
            <BookOpen className="w-5 h-5" />
          </div>
          <p className="font-serif text-base font-semibold text-on-surface mb-1">
            Your Finished Stack is Waiting
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-xs mb-4 leading-relaxed">
            As you finish books, the last five volumes pile up here in an
            interactive bedside stack.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTrackBook}
            className="text-xs font-sans font-semibold rounded-lg h-8 px-3.5"
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
              onClick={handleCanvasClick}
              aria-label={`Interactive stack of your last ${stackBooks.length} finished books`}
              className={`w-full h-full block transition-transform ${
                hoveredIndex !== null ? 'cursor-pointer' : 'cursor-pointer'
              }`}
            />

            {/* Accessible Layer Selector Dots (1..N) */}
            {stackBooks.length > 1 && (
              <div
                className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-surface/85 backdrop-blur-xs px-2 py-1 rounded-full border border-outline-variant/50 shadow-2xs"
                aria-label="Inspect book in stack"
              >
                {stackBooks.map((b, idx) => {
                  const isCurrent = idx === activeIndex;
                  return (
                    <button
                      key={`${b.libraryId}-${b.id}`}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      onMouseEnter={() => setHoveredIndex(idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      title={`${toTitleCase(b.title)} (${idx === stackBooks.length - 1 ? 'Top of stack' : `#${stackBooks.length - idx} in stack`})`}
                      aria-label={`Inspect ${b.title}`}
                      className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                        isCurrent
                          ? 'w-4 bg-primary'
                          : 'bg-outline-variant hover:bg-primary/50'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Hovered / Top-of-Stack Book Callout Footer */}
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
                    {activeIndex === stackBooks.length - 1
                      ? 'Top of Stack'
                      : `#${stackBooks.length - (activeIndex ?? 0)} in Stack`}
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
};
