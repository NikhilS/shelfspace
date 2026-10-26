import {ScatterPoint} from '../../hooks/useConstellationData';
import {
  Point2D,
  CrossClusterBridge,
  SemanticWebEdge,
} from '../../lib/clustering';

/**
 * Natural Mineral & Historical Bookbinding Pigment Palette (18 distinct pigments)
 * Matches the Warm Archival Studio aesthetic across book(ish).
 */
export const CLUSTER_COLORS = [
  '#9A3412', // Terracotta Sienna
  '#1F5D73', // Prussian Cartographic Ink
  '#3F6A58', // Botanical Sage
  '#B45309', // Raw Ochre / Amber Brass
  '#7C2D12', // Venetian Madder
  '#4A5D23', // Olive Moss
  '#2B4C7E', // Delft Lapis
  '#854D0E', // Antique Bronze
  '#6B4C3E', // Warm Sepia / Walnut Ink
  '#3D6B66', // Celadon Mineral Slate
  '#833857', // Tyrian Plum / Cochineal
  '#2D5A4C', // Verdigris Malachite
  '#A16207', // Gilded Saffron
  '#4C4975', // Indigo Woad
  '#92400E', // Burnt Umber
  '#385E72', // Baltic Slate
  '#5C6B3C', // Lichen Green
  '#7F3F2A', // Red Bole Clay
];

export interface NebulaKernel {
  x: number;
  y: number;
  radius: number;
  weight: number;
}

export interface ClusterGeometry {
  clusterId: number;
  name: string;
  thesis?: string;
  color: string;
  centroid: Point2D;
  pointIndices: number[];
  mstEdges: Array<[number, number]>;
  hullPoints: Point2D[];
  nebulaKernels?: NebulaKernel[];
  dominantGenres: string[];
}

export interface StippleGrain {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
}

export interface ConstellationChartProps {
  plotData: ScatterPoint[];
  clusterNames: Record<number, string>;
  clusterTheses?: Record<number, string>;
  crossClusterBridges?: CrossClusterBridge[];
  semanticWebEdges?: SemanticWebEdge[];
  libraryId?: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return `rgba(120, 108, 92, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Blends two hex pigments by weightB in [0, 1] so transitional border books
 * reflect both their primary and runner-up constellation hues.
 */
export function blendHexColors(
  hexA: string,
  hexB: string,
  weightB: number,
): string {
  const cleanA = hexA.replace('#', '');
  const cleanB = hexB.replace('#', '');
  if (cleanA.length !== 6 || cleanB.length !== 6) {
    return hexA;
  }
  const t = Math.max(0, Math.min(1, weightB));
  const rA = parseInt(cleanA.slice(0, 2), 16);
  const gA = parseInt(cleanA.slice(2, 4), 16);
  const bA = parseInt(cleanA.slice(4, 6), 16);

  const rB = parseInt(cleanB.slice(0, 2), 16);
  const gB = parseInt(cleanB.slice(2, 4), 16);
  const bB = parseInt(cleanB.slice(4, 6), 16);

  const r = Math.round(rA * (1 - t) + rB * t)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(gA * (1 - t) + gB * t)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(bA * (1 - t) + bB * t)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}
