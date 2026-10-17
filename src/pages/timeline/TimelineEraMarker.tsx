import React from 'react';
import * as d3Shape from 'd3-shape';
import {BookOpen} from 'lucide-react';
import {motion} from 'motion/react';
import {TimelineCluster, formatYear} from './TimelineControls';

export interface SpanArc {
  id: string;
  bookTitle: string;
  author?: string;
  startYear: number;
  endYear: number;
  durationYears: number;
  fromClusterIndex: number;
  toClusterIndex: number;
}

export interface RiverWaypoint {
  x: number;
  y: number;
  leftRadius: number;
  rightRadius: number;
  thalwegBias: number;
}

export interface SampledRiverPoint {
  s: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  leftRadius: number;
  rightRadius: number;
  thalwegBias: number;
}

export interface RiverIsland {
  id: string;
  clusterKey: number;
  outerPath: string;
  innerVegPath: string;
}

export interface TributaryCreek {
  id: string;
  clusterKey: number;
  ribbonPath: string;
  waterLinePath: string;
}

export interface RiverBendNode {
  x: number;
  y: number;
  width: number;
  cluster: TimelineCluster;
  index: number;
  isRightApex: boolean;
}

export interface ComputedRiverGeometry {
  W: number;
  totalHeight: number;
  bendNodes: RiverBendNode[];
  alluvialValleyPath: string;
  riparianMarshPath: string;
  shallowShoalPath: string;
  midChannelPath: string;
  deepThalwegPath: string;
  waterLinePortPath: string;
  waterLineStarboardPath: string;
  islands: RiverIsland[];
  tributaries: TributaryCreek[];
  spanArcs: Array<SpanArc & {pathD: string; midX: number; midY: number}>;
}

export const ROW_SPACING = 310;
export const TOP_PADDING = 130;
export const BOTTOM_PADDING = 135;

function organicNoise(seed: number, t: number): number {
  return (
    Math.sin(t * 19.7 + seed * 1.3) * 0.45 +
    Math.cos(t * 41.3 - seed * 2.7) * 0.32 +
    Math.sin(t * 73.1 + seed * 4.1) * 0.23
  );
}

export function sampleOrganicRiver(
  waypoints: RiverWaypoint[],
  samplesPerSegment = 20,
): SampledRiverPoint[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) {
    return [
      {
        s: 0,
        x: waypoints[0].x,
        y: waypoints[0].y,
        nx: -1,
        ny: 0,
        tx: 0,
        ty: 1,
        leftRadius: waypoints[0].leftRadius,
        rightRadius: waypoints[0].rightRadius,
        thalwegBias: waypoints[0].thalwegBias,
      },
    ];
  }

  const rawPoints: Array<{
    x: number;
    y: number;
    leftRadius: number;
    rightRadius: number;
    thalwegBias: number;
  }> = [];
  const n = waypoints.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(n - 1, i + 2)];

    const steps = i === n - 2 ? samplesPerSegment + 1 : samplesPerSegment;
    for (let step = 0; step < steps; step++) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      const leftRadius = p1.leftRadius + (p2.leftRadius - p1.leftRadius) * t;
      const rightRadius =
        p1.rightRadius + (p2.rightRadius - p1.rightRadius) * t;
      const thalwegBias =
        p1.thalwegBias + (p2.thalwegBias - p1.thalwegBias) * t;

      rawPoints.push({x, y, leftRadius, rightRadius, thalwegBias});
    }
  }

  const totalSamples = Math.max(1, rawPoints.length - 1);

  return rawPoints.map((pt, idx) => {
    const s = idx / totalSamples;
    const prev = rawPoints[Math.max(0, idx - 1)];
    const next = rawPoints[Math.min(rawPoints.length - 1, idx + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;

    const leftRipple = 1 + organicNoise(11.3, s) * 0.24;
    const rightRipple = 1 + organicNoise(29.7, s) * 0.24;

    return {
      s,
      x: pt.x,
      y: pt.y,
      nx,
      ny,
      tx,
      ty,
      leftRadius: Math.max(8, pt.leftRadius * leftRipple),
      rightRadius: Math.max(8, pt.rightRadius * rightRipple),
      thalwegBias: pt.thalwegBias,
    };
  });
}

export function buildAsymmetricRiverPolygon(
  samples: SampledRiverPoint[],
  scale = 1,
  biasShiftFactor = 0,
): string {
  if (samples.length < 2) return '';

  const leftBank: [number, number][] = samples.map(pt => {
    const shift =
      pt.thalwegBias * (pt.leftRadius + pt.rightRadius) * 0.5 * biasShiftFactor;
    const r = pt.leftRadius * scale - shift;
    return [pt.x + pt.nx * r, pt.y + pt.ny * r];
  });

  const rightBank: [number, number][] = [...samples].reverse().map(pt => {
    const shift =
      pt.thalwegBias * (pt.leftRadius + pt.rightRadius) * 0.5 * biasShiftFactor;
    const r = pt.rightRadius * scale + shift;
    return [pt.x - pt.nx * r, pt.y - pt.ny * r];
  });

  const d3Basis = d3Shape
    .line<[number, number]>()
    .x(d => d[0])
    .y(d => d[1])
    .curve(d3Shape.curveBasis);

  const leftPath = d3Basis(leftBank) || '';
  const rightPath = d3Basis(rightBank) || '';
  if (!leftPath || !rightPath) return '';

  return `${leftPath} L ${rightPath.slice(1)} Z`;
}

export function buildWaterLiningPath(
  samples: SampledRiverPoint[],
  bankFraction: number,
): string {
  if (samples.length < 2) return '';
  const pts: [number, number][] = samples.map(pt => {
    const radius = bankFraction >= 0 ? pt.leftRadius : pt.rightRadius;
    const offset = bankFraction * radius;
    return [pt.x + pt.nx * offset, pt.y + pt.ny * offset];
  });

  const d3Basis = d3Shape
    .line<[number, number]>()
    .x(d => d[0])
    .y(d => d[1])
    .curve(d3Shape.curveBasis);

  return d3Basis(pts) || '';
}

export function computeRiverGeometry(
  clusters: TimelineCluster[],
  stageWidth: number,
): ComputedRiverGeometry {
  const W = Math.max(320, stageWidth);
  const isCompact = W < 600;
  const widthScale = isCompact ? 0.68 : 1.0;

  const totalHeight = Math.max(
    520,
    clusters.length * ROW_SPACING + TOP_PADDING + BOTTOM_PADDING,
  );

  if (clusters.length === 0) {
    return {
      W,
      totalHeight,
      bendNodes: [],
      alluvialValleyPath: '',
      riparianMarshPath: '',
      shallowShoalPath: '',
      midChannelPath: '',
      deepThalwegPath: '',
      waterLinePortPath: '',
      waterLineStarboardPath: '',
      islands: [],
      tributaries: [],
      spanArcs: [],
    };
  }

  const bendNodes: RiverBendNode[] = clusters.map((cluster, index) => {
    const isRightApex = index % 2 === 0;
    const jitter =
      (Math.sin(cluster.key * 0.037 + index * 1.9) * 0.045 +
        Math.cos(index * 2.7) * 0.025) *
      W;

    const baseRatio = isRightApex
      ? isCompact
        ? 0.84
        : 0.82
      : isCompact
        ? 0.16
        : 0.18;

    const x = Math.round(
      Math.max(W * 0.11, Math.min(W * 0.89, W * baseRatio + jitter)),
    );
    const y = TOP_PADDING + index * ROW_SPACING;
    const scaledWidth = Math.round(cluster.channelWidth * widthScale);

    return {
      x,
      y,
      width: scaledWidth,
      cluster,
      index,
      isRightApex,
    };
  });

  const firstNode = bendNodes[0];
  const lastNode = bendNodes[bendNodes.length - 1];

  const waypoints: RiverWaypoint[] = [
    {
      x: Math.round(W * 0.28),
      y: 12,
      leftRadius: Math.max(9, firstNode.width * 0.24),
      rightRadius: Math.max(9, firstNode.width * 0.22),
      thalwegBias: 0,
    },
    {
      x: Math.round(firstNode.isRightApex ? W * 0.58 : W * 0.42),
      y: Math.round(firstNode.y * 0.48),
      leftRadius: Math.max(13, firstNode.width * 0.34),
      rightRadius: Math.max(14, firstNode.width * 0.38),
      thalwegBias: firstNode.isRightApex ? -0.2 : 0.2,
    },
  ];

  bendNodes.forEach((node, idx) => {
    const halfW = node.width * 0.5;
    const leftPool = node.isRightApex ? halfW * 0.92 : halfW * 1.38;
    const rightPool = node.isRightApex ? halfW * 1.38 : halfW * 0.92;
    const bias = node.isRightApex ? -0.32 : 0.32;

    waypoints.push({
      x: node.x + (node.isRightApex ? -W * 0.08 : W * 0.08),
      y: node.y - 82,
      leftRadius: leftPool * 0.78,
      rightRadius: rightPool * 0.78,
      thalwegBias: bias * 0.7,
    });

    waypoints.push({
      x: node.x,
      y: node.y,
      leftRadius: leftPool * 1.18,
      rightRadius: rightPool * 1.18,
      thalwegBias: bias,
    });

    waypoints.push({
      x: node.x + (node.isRightApex ? -W * 0.09 : W * 0.09),
      y: node.y + 82,
      leftRadius: leftPool * 0.82,
      rightRadius: rightPool * 0.82,
      thalwegBias: bias * 0.65,
    });

    if (idx < bendNodes.length - 1) {
      const nextNode = bendNodes[idx + 1];
      const midY = (node.y + nextNode.y) * 0.5;
      const midShift = Math.sin((idx + 1) * 2.9) * (W * 0.06);
      const avgHalf = (node.width + nextNode.width) * 0.25;
      waypoints.push({
        x: Math.round(W * 0.5 + midShift),
        y: Math.round(midY),
        leftRadius: Math.max(12, avgHalf * 0.6),
        rightRadius: Math.max(12, avgHalf * 0.64),
        thalwegBias: 0,
      });
    }
  });

  const deltaHalf = lastNode.width * 0.68;
  waypoints.push({
    x: Math.round(lastNode.isRightApex ? W * 0.42 : W * 0.58),
    y: totalHeight - 58,
    leftRadius: deltaHalf * 1.15,
    rightRadius: deltaHalf * 1.08,
    thalwegBias: 0.1,
  });
  waypoints.push({
    x: Math.round(W * 0.52),
    y: totalHeight - 10,
    leftRadius: deltaHalf * 1.48,
    rightRadius: deltaHalf * 1.52,
    thalwegBias: 0,
  });

  const samples = sampleOrganicRiver(waypoints, 20);

  const alluvialValleyPath = buildAsymmetricRiverPolygon(samples, 2.45, 0);
  const riparianMarshPath = buildAsymmetricRiverPolygon(samples, 1.55, 0);
  const shallowShoalPath = buildAsymmetricRiverPolygon(samples, 1.0, 0);
  const midChannelPath = buildAsymmetricRiverPolygon(samples, 0.72, 0.18);
  const deepThalwegPath = buildAsymmetricRiverPolygon(samples, 0.38, 0.36);

  const waterLinePortPath = buildWaterLiningPath(samples, 0.82);
  const waterLineStarboardPath = buildWaterLiningPath(samples, -0.82);

  const islands: RiverIsland[] = [];
  const tributaries: TributaryCreek[] = [];

  const d3ClosedBasis = d3Shape
    .line<[number, number]>()
    .x(d => d[0])
    .y(d => d[1])
    .curve(d3Shape.curveBasisClosed);

  bendNodes.forEach((node, idx) => {
    let bestSample = samples[0];
    let minDist = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.y - node.y);
      if (d < minDist) {
        minDist = d;
        bestSample = s;
      }
    }

    const islandLen = Math.max(26, node.width * 0.65);
    const islandHalfWidth = Math.max(7, node.width * 0.18);
    const lateralShift = (node.isRightApex ? 1 : -1) * (node.width * 0.14);
    const cx = bestSample.x + bestSample.nx * lateralShift;
    const cy = bestSample.y + bestSample.ny * lateralShift;

    const outerPts: [number, number][] = [
      [cx - bestSample.tx * islandLen, cy - bestSample.ty * islandLen],
      [
        cx -
          bestSample.tx * (islandLen * 0.25) +
          bestSample.nx * islandHalfWidth,
        cy -
          bestSample.ty * (islandLen * 0.25) +
          bestSample.ny * islandHalfWidth,
      ],
      [
        cx +
          bestSample.tx * (islandLen * 0.35) +
          bestSample.nx * (islandHalfWidth * 0.82),
        cy +
          bestSample.ty * (islandLen * 0.35) +
          bestSample.ny * (islandHalfWidth * 0.82),
      ],
      [cx + bestSample.tx * islandLen, cy + bestSample.ty * islandLen],
      [
        cx +
          bestSample.tx * (islandLen * 0.3) -
          bestSample.nx * (islandHalfWidth * 0.75),
        cy +
          bestSample.ty * (islandLen * 0.3) -
          bestSample.ny * (islandHalfWidth * 0.75),
      ],
      [
        cx -
          bestSample.tx * (islandLen * 0.3) -
          bestSample.nx * (islandHalfWidth * 0.9),
        cy -
          bestSample.ty * (islandLen * 0.3) -
          bestSample.ny * (islandHalfWidth * 0.9),
      ],
    ];

    const innerPts: [number, number][] = outerPts.map(([px, py]) => [
      cx + (px - cx) * 0.62,
      cy + (py - cy) * 0.62,
    ]);

    islands.push({
      id: `island-${node.cluster.key}`,
      clusterKey: node.cluster.key,
      outerPath: d3ClosedBasis(outerPts) || '',
      innerVegPath: d3ClosedBasis(innerPts) || '',
    });

    const creekDir = node.isRightApex ? -1 : 1;
    const creekReach = Math.min(W * 0.16, Math.max(38, node.width * 1.15));
    const creekWaypoints: RiverWaypoint[] = [
      {
        x: node.x + creekDir * (node.width * 0.35),
        y: node.y - 96,
        leftRadius: Math.max(4, node.width * 0.09),
        rightRadius: Math.max(4, node.width * 0.09),
        thalwegBias: 0,
      },
      {
        x: Math.max(
          24,
          Math.min(W - 24, node.x + creekDir * (creekReach + (idx % 2) * 14)),
        ),
        y: node.y - 18,
        leftRadius: Math.max(6, node.width * 0.16),
        rightRadius: Math.max(7, node.width * 0.18),
        thalwegBias: 0,
      },
      {
        x: Math.max(
          24,
          Math.min(W - 24, node.x + creekDir * (creekReach * 0.78)),
        ),
        y: node.y + 42,
        leftRadius: Math.max(5, node.width * 0.14),
        rightRadius: Math.max(6, node.width * 0.15),
        thalwegBias: 0,
      },
      {
        x: node.x + creekDir * (node.width * 0.32),
        y: node.y + 104,
        leftRadius: Math.max(4, node.width * 0.09),
        rightRadius: Math.max(4, node.width * 0.09),
        thalwegBias: 0,
      },
    ];

    const creekSamples = sampleOrganicRiver(creekWaypoints, 12);
    tributaries.push({
      id: `creek-${node.cluster.key}`,
      clusterKey: node.cluster.key,
      ribbonPath: buildAsymmetricRiverPolygon(creekSamples, 1.0, 0),
      waterLinePath: buildWaterLiningPath(creekSamples, 0),
    });
  });

  const computedArcs: Array<
    SpanArc & {pathD: string; midX: number; midY: number}
  > = [];

  bendNodes.forEach((node, idx) => {
    node.cluster.spanningBooks.slice(0, 2).forEach((book, bookIdx) => {
      const sYear = book.temporalMetadata?.startYear ?? node.cluster.key;
      const eYear = book.temporalMetadata?.endYear ?? sYear;
      const durationYears = Math.max(15, eYear - sYear);

      let targetIdx = idx;
      for (let j = idx + 1; j < bendNodes.length; j++) {
        if (bendNodes[j].cluster.key <= eYear) {
          targetIdx = j;
        }
      }

      const startX = node.x;
      const startY = node.y;
      const endX =
        targetIdx > idx
          ? bendNodes[targetIdx].x
          : node.x + (node.isRightApex ? -W * 0.09 : W * 0.09);
      const endY =
        targetIdx > idx
          ? bendNodes[targetIdx].y
          : Math.min(totalHeight - 36, node.y + 110 + bookIdx * 22);

      const sweepDir = node.isRightApex ? -1 : 1;
      const arcOffset =
        sweepDir *
        Math.min(W * 0.22, 70 + bookIdx * 26 + Math.min(50, durationYears / 8));
      const midX = Math.max(
        32,
        Math.min(W - 32, (startX + endX) / 2 + arcOffset),
      );
      const midY = (startY + endY) / 2;

      const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;

      computedArcs.push({
        id: `${book.id}-span`,
        bookTitle: book.title,
        author: book.author,
        startYear: sYear,
        endYear: eYear,
        durationYears,
        fromClusterIndex: idx,
        toClusterIndex: targetIdx,
        pathD,
        midX: (startX + 2 * midX + endX) / 4,
        midY: (startY + 2 * midY + endY) / 4,
      });
    });
  });

  return {
    W,
    totalHeight,
    bendNodes,
    alluvialValleyPath,
    riparianMarshPath,
    shallowShoalPath,
    midChannelPath,
    deepThalwegPath,
    waterLinePortPath,
    waterLineStarboardPath,
    islands,
    tributaries,
    spanArcs: computedArcs,
  };
}

export interface TimelineEraMarkerProps {
  node: RiverBendNode;
  stageWidth: number;
  selectedClusterKey: number | null;
  hoveredClusterKey: number | null;
  onSelectCluster: (clusterKey: number | null) => void;
  onHoverCluster: (clusterKey: number | null) => void;
}

export const TimelineEraMarker: React.FC<TimelineEraMarkerProps> = ({
  node,
  stageWidth,
  selectedClusterKey,
  hoveredClusterKey,
  onSelectCluster,
  onHoverCluster,
}) => {
  const {cluster, isRightApex} = node;
  const isSelected = selectedClusterKey === cluster.key;
  const isHovered = hoveredClusterKey === cluster.key;
  const active = isSelected || isHovered;
  const previewBooks = cluster.books.slice(0, 4);
  const hasDistinctSpan = cluster.maxYear > cluster.minYear;
  const leftPct = (node.x / stageWidth) * 100;

  return (
    <div
      id={`river-dock-${cluster.key}`}
      style={{top: `${node.y}px`}}
      className="absolute inset-x-0 -translate-y-1/2 z-10 pointer-events-none"
    >
      {/* Interactive Harbor Buoy Marker on the River Bend Apex */}
      <button
        type="button"
        onClick={() => onSelectCluster(isSelected ? null : cluster.key)}
        onMouseEnter={() => onHoverCluster(cluster.key)}
        onMouseLeave={() => onHoverCluster(null)}
        style={{left: `${leftPct}%`}}
        aria-label={`Select ${cluster.label} river bend (${cluster.books.length} books)`}
        className={`pointer-events-auto flex absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 sm:w-9 sm:h-9 rounded-full items-center justify-center transition-all cursor-pointer z-20 ${
          isSelected
            ? 'bg-[#215a6d] text-white ring-4 ring-[#2d6d82]/30 scale-110 shadow-md'
            : isHovered
              ? 'bg-surface-container-highest text-[#215a6d] dark:text-[#7cc0d6] border-2 border-[#2d6d82] scale-105 shadow-xs'
              : 'bg-surface-container-lowest text-[#215a6d] dark:text-[#7cc0d6] border-2 border-[#387b91]/75 hover:border-[#215a6d] shadow-2xs'
        }`}
      >
        <span className="text-[11px] font-mono tabular-nums font-bold">
          {cluster.books.length}
        </span>
      </button>

      {/* Peninsula Dock Card Nested Inside the Concave Point-Bar Pocket of the Bend */}
      <div
        className={`w-full flex items-center ${
          isRightApex
            ? 'justify-start pl-1 pr-14 sm:pl-4 sm:pr-[34%]'
            : 'justify-end pl-14 pr-1 sm:pl-[34%] sm:pr-4'
        }`}
      >
        <motion.div
          initial={{opacity: 0, y: 12}}
          animate={{opacity: 1, y: 0}}
          transition={{
            duration: 0.25,
            delay: Math.min(0.3, node.index * 0.04),
          }}
          onMouseEnter={() => onHoverCluster(cluster.key)}
          onMouseLeave={() => onHoverCluster(null)}
          onClick={() => onSelectCluster(isSelected ? null : cluster.key)}
          role="button"
          tabIndex={0}
          aria-label={`Inspect ${cluster.label} (${cluster.books.length} books)`}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectCluster(isSelected ? null : cluster.key);
            }
          }}
          className={`pointer-events-auto w-full max-w-[295px] sm:max-w-[390px] rounded-2xl p-3.5 sm:p-4 transition-all duration-200 cursor-pointer border text-left backdrop-blur-[2px] ${
            isSelected
              ? 'bg-surface-container-high/95 border-[#2d6d82] dark:border-[#6ab0c7] ring-1 ring-[#2d6d82]/25 shadow-md'
              : active
                ? 'bg-surface-container/95 border-[#2d6d82]/50 shadow-xs'
                : 'bg-surface-container-low/92 border-outline-variant/60 hover:bg-surface-container hover:border-[#2d6d82]/40'
          }`}
        >
          <div className="flex items-start gap-3 sm:gap-3.5">
            {/* Stacked Book Cover Fan on the Peninsula Dock */}
            <div
              className="flex items-center -space-x-3 shrink-0 pt-0.5"
              aria-hidden="true"
            >
              {previewBooks.map((b, bIdx) => (
                <div
                  key={b.id}
                  style={{
                    zIndex: previewBooks.length - bIdx,
                    transform: `rotate(${
                      bIdx % 2 === 0 ? -bIdx * 2.5 : bIdx * 2.5
                    }deg)`,
                  }}
                  className="w-9 h-14 sm:w-11 sm:h-16 rounded-md overflow-hidden border border-outline-variant/60 bg-surface-container-highest shadow-2xs shrink-0 flex items-center justify-center"
                >
                  {b.coverUrl ? (
                    <img
                      src={b.coverUrl}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full p-1 flex flex-col justify-between bg-surface-container-high text-on-surface-variant">
                      <BookOpen className="w-3 h-3 text-[#2d6d82] dark:text-[#6ab0c7]" />
                      <span className="text-[7px] font-sans font-semibold leading-tight line-clamp-2">
                        {b.title}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {cluster.books.length > 4 && (
                <div
                  style={{zIndex: 0}}
                  className="w-8 h-13 sm:w-9 sm:h-14 rounded-md border border-outline-variant/50 bg-surface-container-highest flex items-center justify-center text-[10px] font-mono tabular-nums font-semibold text-on-surface-variant pl-1.5"
                >
                  +{cluster.books.length - 4}
                </div>
              )}
            </div>

            {/* Archival Epoch Metadata */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-on-surface-variant">
                <span className="font-semibold text-[#215a6d] dark:text-[#6ab0c7]">
                  {formatYear(cluster.key)}
                </span>
                <span aria-hidden="true" className="text-outline-variant">
                  ·
                </span>
                <span>
                  {cluster.books.length}{' '}
                  {cluster.books.length === 1 ? 'Volume' : 'Volumes'}
                </span>
              </div>

              <h3 className="text-sm sm:text-base font-serif font-bold text-on-surface tracking-tight truncate mt-0.5">
                {cluster.label}
              </h3>

              <p className="text-xs text-on-surface-variant line-clamp-1 mt-1 font-sans">
                {cluster.books
                  .slice(0, 2)
                  .map(b => b.title)
                  .join(' · ')}
                {cluster.books.length > 2
                  ? ` (+${cluster.books.length - 2} more)`
                  : ''}
              </p>

              {hasDistinctSpan && (
                <div className="mt-2 pt-1.5 border-t border-outline-variant/35 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-on-surface-variant whitespace-nowrap overflow-hidden">
                  <span className="truncate">
                    <strong className="text-[#215a6d] dark:text-[#6ab0c7] font-semibold">
                      Span Arc:
                    </strong>{' '}
                    {formatYear(cluster.minYear)} –{' '}
                    {formatYear(cluster.maxYear)}
                  </span>
                  {cluster.spanningBooks.length > 0 && (
                    <span className="text-[#215a6d] dark:text-[#6ab0c7] font-semibold shrink-0">
                      {cluster.maxYear - cluster.minYear} yr reach
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
