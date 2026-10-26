# Organic & Continuous Constellation Map Plan

## 1. Context & Root Cause Summary

Currently, the Constellation Map turns a continuous high-dimensional embedding space into isolated islands due to four mechanisms:
1. **Rigid Macro-Cluster Island Simulation (`normalizeAndRelaxPositions` in `src/lib/clustering.ts`)**: Compacts each cluster's stars inward by `0.62×`, enforces a `maxClusterRadius` cap, and runs a 120-step macro-cluster repulsion + circle-circle collision solver with a mandatory `interClusterGap = 15`. This guarantees empty moats between every cluster.
2. **Low-Neighbor UMAP (`nNeighbors <= 12` in `useConstellationData.ts` & `umap.worker.ts`)**: Emphasizes small local cliques rather than global thematic continuity across hundreds of books.
3. **Hard Polygon Hulls & Isolated Skeletons (`ConstellationCanvasRenderer.ts` & `ConstellationChart.tsx`)**: Draws stroked dashed convex hull polygons around each cluster and restricts Minimum Spanning Tree (MST) filaments strictly to same-cluster stars.
4. **Crisp Single-Cluster Color Assignment**: Every book is colored strictly by a single `clusterId`, hiding transitional books that sit on the frontier between two themes.

---

## 2. Proposed Algorithmic & Visual Architecture

### A. Continuous Manifold Projection & Overlap-Only De-Crowding
- **Global-Aware UMAP Scaling (`src/hooks/useConstellationData.ts`, `src/workers/umap.worker.ts`)**:
  - Increase UMAP `nNeighbors` scaling to `Math.min(40, Math.max(6, Math.round(Math.sqrt(N) * 1.35)))` (e.g., `~40` neighbors for an 881-book library) with `minDist: 0.24` and `spread: 1.0` so UMAP preserves continuous global semantic gradients across the collection.
- **Continuous Manifold Relaxation (`normalizeAndRelaxPositions` in `src/lib/clustering.ts`)**:
  - Remove macro-cluster circle compaction (`* 0.62`), remove `interClusterGap` centroid repulsion, and remove circle-circle cluster collision resolution.
  - Normalize the continuous 2D UMAP manifold isotropically into `[-targetRange, targetRange]`.
  - Run a lightweight, deterministic **cluster-agnostic point de-crowding pass** (`minDistance` overlap resolution combined with a gentle spring anchoring each book to its true UMAP coordinate). Books from neighboring clusters will naturally touch, interleave at thematic frontiers, and flow continuously across the canvas.
- **Automatic Refresh of Legacy Island Coordinates (`src/hooks/useConstellationData.ts`)**:
  - Introduce a topology continuity check (`isLegacyIslandLayout`) that detects when persisted `clusterCoordinates` have artificial empty moats between clusters (zero cross-cluster spatial proximity) so existing libraries like Sterling Place automatically upgrade to the continuous manifold layout.

### B. Soft Cluster Membership & Blended Transitional Books
- **Soft Affinity Calculation (`computeSoftClusterMemberships` in `src/lib/clustering.ts`)**:
  - For each book, compute its affinity to every cluster using a blend of high-dimensional embedding cosine similarity to cluster centroids and 2D manifold proximity.
  - Output `secondaryClusterId` and `secondaryWeight` $\in [0, 0.5]$ for each book (`0` for deep core books, up to `0.5` for books sitting equally between two themes).
- **Dual-Cluster Pigment Blending (`src/pages/constellations/types.ts`, `ConstellationCanvasRenderer.ts`, `ConstellationInspector.tsx`)**:
  - Add `blendHexColors(colorA, colorB, weight)` to blend mineral pigments for transitional books (`secondaryWeight >= 0.18`).
  - Render transitional stars with a blended core color and a dual-stop radial halo (primary cluster pigment inner glow transitioning into secondary cluster pigment outer wash).
  - Surface a secondary constellation badge in `ConstellationInspector` when inspecting a transitional border book so users can jump between both themes it connects.

### C. Unified Semantic Web with Cross-Cluster Gradient Filaments
- **Global + Local Semantic Web (`computeUnifiedSemanticWeb` in `src/lib/clustering.ts`)**:
  - Replace isolated per-cluster trees with a unified graph generator that combines:
    1. A **global Minimum Spanning Tree (MST)** across all books weighted by hybrid semantic + 2D manifold distance (pruning only extreme long-distance void jumps), allowing the primary constellation skeleton to flow organically from cluster to cluster.
    2. **Local semantic kNN mesh edges** connecting proximate high-similarity neighbors (capped per node to prevent visual clutter).
- **Gradient Edge Rendering (`ConstellationCanvasRenderer.ts`)**:
  - Render intra-cluster web edges in their constellation's pigment.
  - Render cross-cluster web edges using `ctx.createLinearGradient` between the two connected stars' pigments so filaments visibly transition in color as they cross thematic boundaries.

### D. Overlapping Nebula Glow Fields Without Polygon Borders
- **Multi-Kernel Atmospheric Nebulae (`ConstellationCanvasRenderer.ts`, `ConstellationChart.tsx`)**:
  - Remove the stroked dashed convex hull borders (`traceSmoothClosedHull` stroke) that wall off clusters.
  - Render soft, overlapping radial nebula washes for each cluster (using cluster centroids plus distributed sub-kernels across the cluster's spatial extent) that fade smoothly to zero opacity at their edges and blend naturally where neighboring constellations overlap.

---

## 3. Files to Modify

- `src/lib/clustering.ts`:
  - Refactor `normalizeAndRelaxPositions` into a continuous manifold overlap-only de-crowding solver.
  - Add `computeSoftClusterMemberships` (`secondaryClusterId`, `secondaryWeight`).
  - Add `computeUnifiedSemanticWeb` (`SemanticWebEdge[]`) and `isLegacyIslandLayout`.
- `src/lib/clustering.test.ts`:
  - Update and expand unit tests covering continuous manifold relaxation, soft cluster memberships, and unified semantic web construction.
- `src/workers/umap.worker.ts`:
  - Update `nNeighbors` cap (`<= 40`) and return soft cluster memberships from the worker.
- `src/hooks/useConstellationData.ts`:
  - Increase `nNeighbors` scaling, attach `secondaryClusterId` / `secondaryWeight` to `ScatterPoint`, and auto-upgrade cached legacy island layouts.
- `src/pages/constellations/types.ts`:
  - Add `blendHexColors` helper and `SemanticWebEdge` / soft-membership types.
- `src/pages/constellations/ConstellationChart.tsx`:
  - Compute `semanticWebEdges` via `computeUnifiedSemanticWeb` and pass to `renderConstellationFrame`.
- `src/pages/constellations/ConstellationCanvasRenderer.ts`:
  - Replace bordered convex hull polygons with overlapping multi-kernel radial nebula glow fields.
  - Render the unified semantic web with smooth linear gradients across cross-cluster edges.
  - Render blended dual-cluster pigments and halos on transitional border stars.
- `src/pages/constellations/ConstellationInspector.tsx`:
  - Display secondary constellation affinity on transitional border books.
