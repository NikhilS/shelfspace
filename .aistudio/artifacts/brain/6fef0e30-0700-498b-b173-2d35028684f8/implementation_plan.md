# First-Principles Constellation Map Redesign

Re-architect the Constellation Map from a static scatter plot into a fluid, 60fps cartographic atlas with three-tier semantic zoom (revealing tactile book covers at close zoom), inertial focal-point gesture physics, offscreen-cached atmospheric rendering paired with a crisp DOM overlay, and a mobile-first full-bleed layout with a swipeable bottom sheet inspector.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions reflect your confirmed preferences from our design alignment:

- **Confirmed Decision 1 — 2D Semantic Zoom with Close-Zoom Cover Art**: The map will transition smoothly across three semantic zoom levels: **Macro Atlas** (`0.55x–1.35x`, glowing nebula territories, primary constellation titles, and anchor stars), **Meso Territory** (`1.35x–2.35x`, curatorial theses, semantic web filaments, and hub book titles), and **Micro Neighborhood** (`>= 2.35x`, where stars smoothly blossom into framed miniature book cover medallions with titles and author bylines).
- **Confirmed Decision 2 — Offscreen-Cached Canvas + DOM Overlay Engine**: Static world-space layers (parchment stipple grain, multi-kernel nebula washes, and base semantic web filaments) are pre-rendered once into an offscreen bitmap buffer and composited via a single GPU-accelerated `drawImage` transform per frame, while interactive constellation banners and close-zoom book cover cards render in a hardware-accelerated (`translate3d`) DOM overlay layer with `O(log N)` quadtree spatial culling.
- **Confirmed Decision 3 — Momentum Panning & Focal-Point Pinch/Wheel Physics**: Touch and pointer gestures incorporate velocity-tracked inertial throw with exponential friction decay on release, simultaneous two-finger pan + focal-midpoint pinch-to-zoom, smooth continuous trackpad/wheel zoom anchored to the cursor, and double-tap/double-click focal zoom.
- **Confirmed Decision 4 — Full-Bleed Mobile Map with Swipeable Bottom Sheet**: On mobile viewports (`< 1024px`), the map occupies an immersive viewport frame with floating thumb-zone controls and a touch-draggable 3-detent bottom sheet inspector (*Peek*, *Half*, and *Expanded* states) that slides up immediately when a book or constellation is selected.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the library's high-dimensional embedding space into an interactive literary star atlas where readers can fluidly glide across thematic territories, pinch-zoom into any neighborhood to browse actual book covers in semantic space, and inspect unexpected thematic bridges between constellations.
- **Target Audience / Persona**: Readers and collectors exploring libraries of 50 to 2,000+ books on both mobile phones (one-handed thumb navigation) and desktop monitors.
- **Key Value**: Eliminates frame drops, rigid dead-stop dragging, uniform dot monotony, and off-screen mobile inspector panels—replacing them with tactile map physics, progressive visual discovery, and zero-allocation 60fps rendering.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Macro Atlas Exploration (`0.55x – 1.35x` Zoom)**:
   - Upon opening the Constellation Map, the camera frames the entire library manifold. Soft, overlapping mineral-pigment nebulae and delicate astrolabe graticules establish the territories.
   - Prominent "Alpha Stars" (semantic hub books with the highest neighborhood centrality in each cluster) display subtle halo rings and miniature badges, while interactive cartographic constellation banners float cleanly over each territory centroid.
   - Tapping any constellation banner (or selecting a constellation from the horizontal filter rail) smoothly flies the camera along an eased interpolation curve to frame that territory.
2. **Meso Constellation Inspection (`1.35x – 2.35x` Zoom)**:
   - As the user zooms into a region, cross-cluster bridge filaments and intra-cluster semantic threads fade in with higher clarity, and collision-free labels appear for the most connected hub books.
   - The Constellation Inspector (right sidebar on desktop; swipeable bottom sheet on mobile) displays the constellation's curatorial thesis, cross-constellation bridge pairs, and full book roster.
3. **Micro Cover-Art Neighborhood (`>= 2.35x` Zoom)**:
   - Zooming past `2.35x` smoothly cross-fades visible viewport stars into tactile miniature book cover cards (with automatic `MonographCoverFallback` typography for editions without cover URLs) anchored to their exact world coordinates.
   - Readers can pan through neighborhoods of book covers visually and tap any cover card to lock the star, highlight its nearest semantic neighbors with luminous gold/terracotta vectors, and open the full book details page.
4. **Mobile Bottom Sheet Workflow (`< 1024px`)**:
   - On mobile screens, the map fills the primary viewport height (`calc(100dvh - 8.5rem)`) with a compact floating search & constellation pill bar at the top and camera controls tucked cleanly above the bottom sheet.
   - A swipeable bottom sheet sits at a compact **Peek** height (`76px`) showing the active constellation summary or atlas prompt. Tapping any star or constellation automatically animates the sheet to **Half** height (`46%` viewport) to reveal the book cover, synopsis, and semantic neighbor links without obscuring the selected star on the map, and dragging upward expands it to **Full** height (`86%` viewport).

### Visual Identity & Theme ("Warm Archival Studio")

- **Aesthetic Direction**: Museum cartographic plate meets modern spatial interface—inspired by 18th-century celestial atlases (Bode's *Uranographia*) and archival exhibition monographs.
- **Color Palette & Mood**:
  - **60% Warm Paper / Night Sky Canvas**: Alabaster Parchment (`#F7F3EB`) with warm radial vignette in Light Mode; Deep Obsidian Vellum (`#151310`) in Dark Mode.
  - **30% Structural Surfaces & Typography**: Warm Limestone (`--surface-container`) panels with `1px solid` hairline borders (`border-outline-variant/60`), Antique Charcoal Ink (`#1C1917`), and Warm Stone (`#686259`) captions.
  - **10% Curatorial Mineral Pigments**: 12 curated archival pigments (Terracotta, Lapis Slate, Sage, Ochre, Plum, Verdigris, Sienna) blended toward deep ink for WCAG AA label legibility.
- **Typography & Hierarchy**:
  - **Display & Book Titles**: `Plus Jakarta Sans` (`--font-serif`) semi-bold with tight tracking and `text-wrap: balance`.
  - **UI & Cartographic Labels**: `Manrope` (`--font-sans`) for interactive constellation banners, search inputs, and synopsis prose.
  - **Metrics & Similarity Scores**: Tabular monospace (`--font-mono tabular-nums`) for zoom percentages, book counts, publication years, and semantic similarity percentages (`94%`).
- **Interactive Feedback & Motion**:
  - **Inertial Camera Glide**: Releasing a pan gesture continues gliding with velocity-proportional momentum and exponential friction (`0.92` per 16ms frame) until settling.
  - **Guided Camera Flight**: Selecting a constellation or semantic neighbor animates both pan and zoom along a smooth cubic-out trajectory (`420ms` duration, respecting `prefers-reduced-motion`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Offscreen World-Space Bitmap Cache + Hardware-Accelerated DOM Overlay**
  - *Chosen Approach*: Pre-render the expensive multi-kernel nebula radial gradients and static semantic web edges onto an offscreen canvas (`2048 × 2048` hi-DPI world texture) whenever cluster data changes. Each animation frame blits this cached texture in $O(1)$ time, draws dynamic foreground highlights (active neighbor rays, star nodes), and updates a virtualized DOM overlay for visible close-zoom book covers and interactive constellation banners.
  - *Why*: Eliminates ~60+ `createRadialGradient` and ~1,500+ `createLinearGradient` allocations per frame during panning and zooming, guaranteeing locked 60fps performance even on mobile GPUs with 1,000+ books while enabling crisp HTML `<img>` cover caching and native accessibility for interactive labels.
  - *Alternatives Considered*: Re-drawing all gradients on the main 2D canvas every frame (causes frame drops during pinch-zoom on mobile); pure WebGL shader pipeline (complicates crisp typography, book cover image fallbacks, and theme-aware CSS token integration).

- **Decision 2: 2D Spatial Quadtree Index + Inertial Focal-Point Gesture Controller**
  - *Chosen Approach*: Index all book coordinates in a 2D spatial quadtree and manage camera state (`x`, `y`, `zoom`, `vx`, `vy`) via a unified gesture physics controller supporting focal-point wheel zoom, simultaneous two-finger midpoint pan + pinch zoom, and velocity-tracked throw inertia.
  - *Why*: Reduces hover/tap hit-testing and viewport frustum culling (for close-zoom cover cards) from $O(N)$ to $O(\log N)$, and fixes the jarring sensation where pinching zooms into the center of the screen instead of the exact point between the user's fingers.
  - *Alternatives Considered*: Linear scan hit-testing and center-locked zoom (feels rigid and loses the user's focal point on touch devices).

- **Decision 3: Responsive Split-Workspace on Desktop vs. Draggable 3-Detent Bottom Sheet on Mobile**
  - *Chosen Approach*: Preserve the 12-column exhibition split view on desktop (`lg:col-span-8` atlas + `lg:col-span-4` sticky inspector) while switching viewports `< 1024px` to an immersive full-height map with a `motion/react` swipeable bottom sheet (*Peek* / *Half* / *Expanded*).
  - *Why*: On mobile, stacking the inspector below the map forces users to scroll away from the visualization to read what they tapped. A swipeable bottom sheet keeps the map and inspector simultaneously accessible within natural thumb reach, and automatically offsets the camera center upward when the sheet is in its *Half* state so the selected star remains centered in the visible upper portion of the map.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ConstellationMap Page Shell                          │
│     (Compact Header · Reading Room Scope Toggle · Refresh Map Action)       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   ConstellationChart Coordinator & State                    │
│  ┌───────────────────────────────────┐ ┌─────────────────────────────────┐  │
│  │   2D Spatial Quadtree & LOD       │ │  Inertial Camera & Gesture      │  │
│  │   • Frustum culling for covers    │ │  Physics Controller             │  │
│  │   • O(log N) star hit-testing     │ │  • Momentum pan (vx, vy decay)  │  │
│  │   • Alpha/Hub star centrality     │ │  • Focal-midpoint pinch + pan   │  │
│  └─────────────────┬─────────────────┘ │  • Continuous cursor wheel zoom │  │
│                    │                   └────────────────┬────────────────┘  │
└────────────────────┼────────────────────────────────────┼───────────────────┘
                     │                                    │
         ┌───────────┴────────────┐           ┌───────────┴────────────┐
         ▼                        ▼           ▼                        ▼
┌─────────────────┐    ┌─────────────────────────────┐    ┌───────────────────┐
│ Offscreen Layer │    │ Interactive Foreground      │    │ Responsive        │
│ Cache (Canvas)  │    │ Layers                      │    │ Inspector Surface │
│ • Multi-kernel  │───▶│ 1. 60fps Dynamic 2D Canvas  │    │ • Desktop: 4-col  │
│   nebula glow   │    │    (Astrolabe rings, active │    │   Archival Aside  │
│ • Base semantic │    │     rays, star magnitudes)  │    │ • Mobile: 3-Snap  │
│   web filaments │    │ 2. Virtualized DOM Overlay  │    │   Swipeable       │
│ • Rendered once │    │    (Clickable cluster tags  │    │   Bottom Sheet    │
│   per layout    │    │     & close-zoom covers)    │    │   (Peek/Half/Full)│
└─────────────────┘    └─────────────────────────────┘    └───────────────────┘
```

### Data Model & Spatial State

- **Star Magnitude & Centrality Score (`starMagnitude`)**:
  - Computed once per dataset from each book's top-$K$ semantic neighbor similarities and intra-cluster degree.
  - Classifies stars into **Alpha Hubs** (top ~15% per constellation, rendered with larger radii, subtle outer rings, and early title reveal at Meso zoom) and **Standard Stars**, giving every constellation immediate visual structure at Macro zoom.
- **3-Tier Semantic Zoom Envelopes**:
  - **Tier 1 — Macro Atlas (`zoom < 1.35`)**: Displays offscreen nebula glow, astrolabe rings, interactive constellation title banners, Cross-Cluster Bridge arcs, and Alpha/Standard star nodes.
  - **Tier 2 — Meso Constellation (`1.35 <= zoom < 2.35`)**: Smoothly fades in intra-cluster semantic filaments, Alpha Hub book titles, and subtle curatorial subtitle counts.
  - **Tier 3 — Micro Cover Neighborhood (`zoom >= 2.35`)**: Queries the 2D spatial quadtree for stars inside the current camera frustum (capped to the top 36 closest/highest-magnitude stars in view to prevent DOM crowding) and renders GPU-positioned miniature book cover cards (`ArchivalCoverImage` / `MonographCoverFallback`) that scale smoothly with zoom.
- **Inertial Camera State**:
  - Tracks `{ x, y, zoom, vx, vy, isAnimatingFlight, flightStart, flightDuration, fromState, toState }`.
  - During 1-finger or mouse drag, pointer deltas are recorded in a rolling 80ms velocity window. On pointer release, if velocity exceeds threshold and no pinch occurred, the `requestAnimationFrame` loop applies `(vx, vy)` with `0.92` per-frame damping until speed drops below `0.02` world units/frame.
  - During 2-finger touch, the controller computes both the pinch distance ratio $r = d_{\text{now}} / d_{\text{prev}}$ and the midpoint translation $\Delta M = M_{\text{now}} - M_{\text{prev}}$, updating `(x, y, zoom)` simultaneously so the world coordinate under $M$ stays locked beneath the user's fingers.

### Interactive Component & State Mapping

- **Interactive Constellation Banners (DOM Overlay)**:
  - Positioned at each cluster centroid via `transform: translate3d(sx, sy, 0)`. Clicking/tapping a banner triggers `focusOnCluster(clusterId)`, initiating a smooth camera flight to frame that constellation's bounding box and opening the Constellation Territory view in the inspector.
- **Close-Zoom Book Cover Medallions (DOM Overlay at `zoom >= 2.35`)**:
  - Rendered for frustum-culled stars in view. Clicking/tapping a cover card triggers `focusOnStar(star)`, locking the star, illuminating its nearest neighbor vectors on the canvas, and opening the Locked Star view in the inspector.
- **Floating Search & Constellation Pill Bar**:
  - Typing a query filters matching stars in real time, dims non-matching stars on the canvas, and offers a quick-jump dropdown or automatic camera framing when matches are found.
  - Horizontal constellation chips allow 1-tap camera flight between constellations from any zoom level.
- **Mobile Swipeable Bottom Sheet (`< 1024px`)**:
  - Powered by `motion/react` vertical drag gestures with three snap detents: `peek` (`76px`), `half` (`46dvh`), and `full` (`86dvh`).
  - Automatically transitions from `peek` to `half` when a user taps a star or constellation on the map, and shifts the camera's vertical focal center upward by `18%` of viewport height so the selected star is framed cleanly in the visible map area above the sheet.
  - Tapping the map canvas background collapses the sheet back to `peek` so the user can pan freely.
