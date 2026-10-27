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
  anchorIndices?: number[];
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
  vx: number;
  vy: number;
}

export interface SemanticLodWeights {
  tier: 1 | 2 | 3;
  tierLabel: 'Atlas Overview' | 'Neighborhood' | 'Book Covers';
  bannerOpacity: number;
  titleOpacity: number;
  coverOpacity: number;
  nebulaAlphaMultiplier: number;
  starScaleMultiplier: number;
}

export interface ConstellationChartProps {
  plotData: ScatterPoint[];
  clusterNames: Record<number, string>;
  clusterTheses?: Record<number, string>;
  crossClusterBridges?: CrossClusterBridge[];
  semanticWebEdges?: SemanticWebEdge[];
  libraryId?: string;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(
    0,
    Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)),
  );
  return t * t * (3 - 2 * t);
}

/**
 * Computes progressive 3-tier semantic zoom weights across [0.55x - 6.0x]:
 * - Tier 1 (0.55x - 1.45x): Celestial Atlas Overview (constellation territory banners + nebula glows)
 * - Tier 2 (1.45x - 2.65x): Constellation Neighborhood (anchor book titles + bridge filaments)
 * - Tier 3 (2.65x - 6.0x): Reading Room Cover Detail (tactile miniature book covers)
 */
export function computeSemanticLod(zoom: number): SemanticLodWeights {
  const tier: 1 | 2 | 3 = zoom < 1.45 ? 1 : zoom < 2.65 ? 2 : 3;
  const tierLabel =
    tier === 1 ? 'Atlas Overview' : tier === 2 ? 'Neighborhood' : 'Book Covers';

  // Constellation banners visible in Tier 1 & early Tier 2, fading out by 2.15x
  const bannerOpacity = 1 - smoothstep(1.35, 2.15, zoom);

  // Neighborhood book title callouts peak in Tier 2, crossfading to covers in Tier 3
  const titleFadeIn = smoothstep(1.2, 1.55, zoom);
  const titleFadeOut = 1 - smoothstep(2.45, 2.95, zoom);
  const titleOpacity = titleFadeIn * titleFadeOut;

  // Miniature book cover plates emerge smoothly as zoom enters Tier 3 (>= 2.45x)
  const coverOpacity = smoothstep(2.45, 2.95, zoom);

  const nebulaAlphaMultiplier = 1 - 0.35 * smoothstep(2.0, 3.8, zoom);
  const starScaleMultiplier = 1 - 0.45 * coverOpacity;

  return {
    tier,
    tierLabel,
    bannerOpacity,
    titleOpacity,
    coverOpacity,
    nebulaAlphaMultiplier,
    starScaleMultiplier,
  };
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

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return [0.47, 0.42, 0.36];
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
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
