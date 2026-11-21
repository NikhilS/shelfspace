import {toTitleCase} from '../../lib/utils';
import type {TrackedBookItem} from '../../types';

export interface StackPose {
  dxRatio: number;
  dyRatio: number;
  angleDeg: number;
}

export interface AnimatedBookPose {
  dxRatio: number;
  dyRatio: number;
  angleDeg: number;
  lift: number;
}

export interface BookStackGeometry {
  cx: number;
  cy: number;
  bookW: number;
  bookH: number;
  angleRad: number;
  lift: number;
}

// Deterministic messy bedside-table stack poses (slot 0 = bottom of pile -> slot 4 = top of pile)
export const MESSY_STACK_POSES: StackPose[] = [
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

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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

export function wrapCanvasText(
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

export interface ComputeTargetPoseParams {
  bookIndex: number;
  totalBooks: number;
  drawOrder: readonly number[];
  safeActiveIndex: number;
  hoveredIndex: number | null;
  dragOffsetPx: number;
}

export function computeTargetPoseForBook(
  params: ComputeTargetPoseParams,
): AnimatedBookPose {
  const {
    bookIndex,
    totalBooks,
    drawOrder,
    safeActiveIndex,
    hoveredIndex,
    dragOffsetPx,
  } = params;
  const slotIndex = drawOrder.indexOf(bookIndex);
  const effectiveSlot = slotIndex >= 0 ? slotIndex : 0;
  const poseOffset = MESSY_STACK_POSES.length - totalBooks + effectiveSlot;
  const basePose =
    MESSY_STACK_POSES[
      Math.max(0, Math.min(MESSY_STACK_POSES.length - 1, poseOffset))
    ];

  const isTopBook = bookIndex === safeActiveIndex;
  const isHovered = hoveredIndex === bookIndex;
  const isDragging = Math.abs(dragOffsetPx) > 1;

  if (isTopBook && isDragging) {
    const clampedDrag = Math.max(-140, Math.min(140, dragOffsetPx));
    return {
      dxRatio: basePose.dxRatio + (clampedDrag / 280) * 0.65,
      dyRatio: basePose.dyRatio - Math.abs(clampedDrag / 280) * 0.04,
      angleDeg: basePose.angleDeg + (clampedDrag / 280) * 16,
      lift: 1.1,
    };
  }

  if (isDragging && totalBooks > 1) {
    const nextCandidateIndex =
      dragOffsetPx < 0
        ? (safeActiveIndex + 1) % totalBooks
        : (safeActiveIndex - 1 + totalBooks) % totalBooks;
    if (bookIndex === nextCandidateIndex) {
      const topPose = MESSY_STACK_POSES[MESSY_STACK_POSES.length - 1];
      const progress = Math.min(1, Math.abs(dragOffsetPx) / 85);
      return {
        dxRatio:
          basePose.dxRatio + (topPose.dxRatio - basePose.dxRatio) * progress,
        dyRatio:
          basePose.dyRatio + (topPose.dyRatio - basePose.dyRatio) * progress,
        angleDeg:
          basePose.angleDeg + (topPose.angleDeg - basePose.angleDeg) * progress,
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
}

export function computeBookStackGeometry(
  currentPose: AnimatedBookPose,
  width: number,
  height: number,
): BookStackGeometry {
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
}

export interface PaintReadStackCanvasParams {
  canvas: HTMLCanvasElement;
  stackBooks: readonly TrackedBookItem[];
  drawOrder: readonly number[];
  safeActiveIndex: number;
  imageCache: ReadonlyMap<string, HTMLImageElement | 'error'>;
  getGeometry: (
    bookIndex: number,
    width: number,
    height: number,
  ) => BookStackGeometry;
}

export function paintReadStackCanvas(params: PaintReadStackCanvasParams): void {
  const {
    canvas,
    stackBooks,
    drawOrder,
    safeActiveIndex,
    imageCache,
    getGeometry,
  } = params;
  if (typeof canvas.getContext !== 'function') {
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

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
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

  for (const bookIndex of drawOrder) {
    const book = stackBooks[bookIndex];
    if (!book) {
      continue;
    }

    const {cx, cy, bookW, bookH, angleRad, lift} = getGeometry(
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

    ctx.save();
    drawRoundedRect(ctx, -halfW, -halfH, bookW, bookH, 5);
    ctx.clip();

    const cachedImg = book.coverUrl ? imageCache.get(book.coverUrl) : undefined;

    if (cachedImg && cachedImg !== 'error') {
      try {
        ctx.drawImage(cachedImg, -halfW, -halfH, bookW, bookH);
      } catch {
        // Fallback if drawImage fails
      }
    } else {
      const palette = MONOGRAPH_PALETTES[bookIndex % MONOGRAPH_PALETTES.length];
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
      for (let lineIdx = 0; lineIdx < titleLines.length; lineIdx++) {
        ctx.fillText(
          titleLines[lineIdx],
          -halfW + 12,
          -halfH + 22 + lineIdx * 13.5,
        );
      }

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

    const spineGrad = ctx.createLinearGradient(-halfW, 0, -halfW + 10, 0);
    spineGrad.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    spineGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.24)');
    spineGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
    spineGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spineGrad;
    ctx.fillRect(-halfW, -halfH, 10, bookH);

    ctx.restore();

    drawRoundedRect(ctx, -halfW, -halfH, bookW, bookH, 5);
    ctx.strokeStyle = isTopBook
      ? 'rgba(154, 52, 18, 0.78)'
      : 'rgba(68, 64, 60, 0.25)';
    ctx.lineWidth = isTopBook ? 1.6 : 0.9;
    ctx.stroke();

    ctx.restore();
  }

  ctx.restore();
}

export function hitTestReadStack(params: {
  canvas: HTMLCanvasElement;
  clientX: number;
  clientY: number;
  drawOrder: readonly number[];
  getGeometry: (
    bookIndex: number,
    width: number,
    height: number,
  ) => BookStackGeometry;
}): number | null {
  const {canvas, clientX, clientY, drawOrder, getGeometry} = params;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const width = rect.width || 320;
  const height = rect.height || 220;

  for (let s = drawOrder.length - 1; s >= 0; s--) {
    const bookIndex = drawOrder[s];
    const {cx, cy, bookW, bookH, angleRad} = getGeometry(
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
}
