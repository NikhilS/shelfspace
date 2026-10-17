import {ScatterPoint} from '../../hooks/useConstellationData';
import {Point2D} from '../../lib/clustering';

/**
 * Natural Mineral & Historical Bookbinding Pigment Palette
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
];

export interface ClusterGeometry {
  clusterId: number;
  name: string;
  color: string;
  centroid: Point2D;
  pointIndices: number[];
  mstEdges: Array<[number, number]>;
  hullPoints: Point2D[];
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
  libraryId?: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(120, 108, 92, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
