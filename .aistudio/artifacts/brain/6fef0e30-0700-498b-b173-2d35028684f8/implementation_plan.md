# Ground-Up Book Swiping Architecture Overhaul

Re-architect book swiping from the ground up into a constant-$O(1)$, 60/120fps GPU-composited experience across both the **Book Details View** and the **Reading Room Finished Stack**, eliminating full-tree route remounts, mid-gesture React reconciliations, off-screen hook spam, and third-party Swiper.js overhead.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All three architectural preferences from our design alignment have been incorporated into this blueprint, along with a detailed architectural comparison of why a custom 3-Slot `motion/react` Deck outperforms Swiper.js.

- **Confirmed Decision 1 — Custom 3-Slot Motion Deck & Removal of Swiper.js**: Replace `swiper` with a purpose-built, constant-$O(1)$ 3-slot deck (`prev`, `active`, `next`) powered by `motion/react` (`useMotionValue`, `useTransform`, `animate`), removing the `swiper` dependency entirely.
- **Confirmed Decision 2 — Touch Drag, Keyboard Arrows & Explicit Chevrons Only**: Drive deck physics via touch drag gestures, `ArrowLeft` / `ArrowRight` keyboard shortcuts, and header/edge chevron buttons—leaving desktop trackpad scroll 100% native so vertical reading never contends with horizontal wheel events.
- **Confirmed Decision 3 — Unified Upgrade Across Both Swiping Surfaces**: Upgrade both the full-page **Book Details Deck** and the **Reading Room Finished Stack Canvas** so every book-swiping interaction in **book(ish)** shares consistent, responsive spring physics.

---

## 1. Overview, Root-Cause Diagnosis & Why Custom Beats Swiper.js

### Why Swiping Feels Janky Today
A staff-level audit of the current swiping pipeline revealed six compounding bottlenecks that degrade frame pacing and responsiveness:

1. **Full Component-Tree Destruction on Every Swipe**:
   - The top-level route wrapper currently keys `<ErrorBoundary>` and `<Suspense>` on the exact `location.pathname`.
   - When a swipe completes and updates the URL from `/library/:id/book/:bookA` to `/library/:id/book/:bookB`, React treats it as a brand-new route—**unmounting the entire Book Details view and carousel**, firing `window.scrollTo(0, 0)`, and mounting a fresh tree from scratch right as the gesture settles.
2. **Synchronous Main-Thread React Re-Renders Mid-Gesture**:
   - Updating `currentSlideIndex` state at the 50% drag threshold triggers a full React render of the parent view, re-evaluates all slide nodes, mounts/unmounts heavy Markdown and Review subtrees, and kicks off network prefetching **while the GPU is still animating the card**.
3. **$O(N)$ Carousel Virtual DOM Overhead**:
   - Mapping over the entire `bookList` array inside Swiper allocates $N$ slide wrappers on every render and keeps up to 5 full book detail subtrees mounted simultaneously (`distance <= 2`).
4. **Un-Gated Background Side Effects on Off-Screen Slides**:
   - Flanking slides mount the full insights hook without an `isActive` guard, scheduling background auto-enrichment timers and cache invalidations for books the user hasn't even landed on.
5. **Scroll-Container & Touch-Axis Contention**:
   - Vertical scrolling leaks onto `window` instead of being isolated inside each slide's scroll viewport, and touch gestures lack deterministic horizontal/vertical axis locking (`touch-action: pan-y`).
6. **Discrete "Snap-Only" Touch on the Reading Room Stack**:
   - The Reading Room bedside stack only reacts on `touchend` after a 30px threshold—providing zero live 1:1 finger tracking during the drag itself.

### Why a Custom 3-Slot `motion/react` Deck Outperforms Swiper.js

Swiper.js is a great general-purpose library for marketing carousels and image galleries, but it has fundamental architectural mismatches when used as a **full-page application router view in React 19** where each slide is a complex, scrollable document with live queries and effects:

| Architectural Dimension | Swiper.js (`swiper/react` + `Virtual`) | Custom 3-Slot `motion/react` Deck |
| :--- | :--- | :--- |
| **DOM & State Ownership ("Two Brains" vs. "One Brain")** | **Two competing engines**: Swiper imperatively mutates `.swiper-wrapper` inline styles (`transform`, `transition-duration`) while its `Virtual` module triggers internal React `setState` to shift the virtual window—causing React DOM reconciliation to run **during** CSS transitions. | **Single deterministic lifecycle**: Zero React state updates occur during drag or spring settle (`dragX` `MotionValue` updates GPU `translate3d` directly). State commits in **one atomic frame** after the spring finishes. |
| **Virtualization Complexity** | **$O(N)$ React Children**: `swiper/react` requires rendering `bookList.map(...)` so Swiper can inspect `React.Children` to count slides. For a 1,000-book library, React allocates and diffs 1,000 `<SwiperSlide>` elements on every render. | **True $O(1)$ Constant Work**: Never maps over `bookList`. Indexes `bookList[i - 1]`, `bookList[i]`, and `bookList[i + 1]` in $O(1)$ time—mounting at most **3 elements** whether the library has 5 or 50,000 books. |
| **Gesture Physics & Release Velocity** | **Fixed-duration CSS `transition-duration`** (`300ms` cubic-bezier). Ignores actual finger release velocity, creating a noticeable "speed kink" when lifting your finger after a fast flick, and stutters when interrupted mid-flight. | **True Velocity-Preserving Spring Physics**: Passes instantaneous release velocity (`px/s`) directly into a critically damped spring oscillator (`stiffness: 380, damping: 38`). Zero speed discontinuity on release and 100% interruptible mid-flight. |
| **Slide Promotion & DOM Reuse** | Shifting `virtualData.from`/`to` and syncing `slideTo(activeIndex, 0)` on URL updates causes layout recalculations and flashes when slides enter/exit the virtual window. | Keying the 3 slots by `bookId` (`key={slotBookId}`) means when a swipe settles at $\pm 100\%$ and `dragX` resets to `0`, React **reuses the already-mounted DOM node** in place without unmounting or re-layout. |
| **Data-Rich Subtree Gating** | Mounts 5 slides (`addSlidesBefore: 2, addSlidesAfter: 2`) with uniform lifecycle; requires fragile distance math inside render props to avoid hook spam. | Built-in **Two-Tier Slot Contract**: Flanking slots (`±1`) render an instant, zero-effect **Cache Preview Shell**; only the settled `active` slot (`0`) activates heavy Markdown, Reviews, and AI Insights hooks. |
| **Bundle Weight** | Adds `~45 KB` gzipped of imperative carousel JS + CSS on top of `motion/react` (which is already loaded across the app). | **Zero additional dependencies**—uses the `motion/react` primitives already loaded in memory and removes `swiper` from the bundle. |

---

## 2. User Experience, Gesture Physics & Visual Design

### Key User Flows & Tactile Physics

1. **1:1 Finger Tracking with Directional Axis Lock (`BookDetailsView`)**:
   - As the user touches and drags horizontally (`|dx| > 8px` and `|dx| > |dy| * 1.2`), the gesture locks onto the horizontal axis while native vertical scrolling (`touch-action: pan-y`) remains completely unhindered when scrolling down a book's synopsis or reviews.
   - During the drag, a single `MotionValue` (`dragX`) translates the 3-slot track (`prev` at `-100%`, `active` at `0%`, `next` at `+100%`) directly on the GPU compositor thread (`translate3d`) with **zero React state updates**.
   - At the first or last book in a collection, dragging past the boundary applies rubber-band resistance (`0.28` damping factor) so the edge feels physical and responsive.

2. **Velocity + Displacement Commit & Interruptible Spring Settle**:
   - On pointer release, commit to the next/previous book if horizontal displacement exceeds `22%` of the viewport width **or** flick velocity exceeds `420px/s` (with a minimum `28px` travel guard).
   - A critically damped spring (`stiffness: 380, damping: 38, mass: 0.85`) settles the track to `-100%`, `0%`, or `+100%` in ~180ms.
   - Rapidly pressing `ArrowLeft` / `ArrowRight` or tapping the previous/next chevron buttons cleanly retargets or advances the index without queuing sluggish overlapping transitions.

3. **Two-Tier Slide Rendering (Instant Preview Card vs. Active Editorial Spread)**:
   - **Active Slot (`offset === 0`)**: Renders the complete interactive editorial spread (Edition Showcase, Archival Accession Ledger, Reading Status selector, Synopsis Markdown, Author Bio, AI Insights, and Reviews) inside its own independent vertical scroll container.
   - **Flanking Slots (`offset === -1` and `offset === +1`)**: Render a lightweight, zero-effect **Preview Shell** seeded synchronously from the TanStack Query library list cache (Cover image, Title, Author, Genre tags, and Accession Ledger). Flanking slots never fire `listReviews`, never mount `useBookInsights` timers, and never parse heavy Markdown until they become the active slot.

4. **Interactive Drag-and-Peel on the Reading Room Stack (`ReadStackCanvasCard`)**:
   - Touching or dragging across the 2D Canvas bedside book pile tracks `dragDeltaX` live at 60fps: the top book translates horizontally, tilts by a proportional angle, and lifts slightly with a dynamic drop shadow while the next book underneath rises toward the top pose in real time.
   - Releasing past the swipe threshold (`> 32px` or flick velocity) smoothly springs the top book to the bottom of the pile and promotes the next book; releasing below the threshold springs the top book back into place.

### Visual Identity & Motion Budget
- **Aesthetic Continuity**: Preserves the **Modern Archivist** warm paper palette (`--surface`, `--surface-container-low`, `--primary`), `Manrope` UI typography, and rectilinear geometry (`rounded-lg` / `rounded-xl`).
- **Compositor-Only Motion**: Only `transform` (`translate3d`, `scale`) and `opacity` are animated during swipes, guaranteeing 0ms layout/paint overhead during gesture frames and respecting `prefers-reduced-motion`.

---

## 3. Key Product & Architectural Decisions

- **Decision 1: Route-Group Keying for Zero-Remount URL Synchronization**
  - *Chosen Approach*: Normalize the route boundary key in the top-level page wrapper so transitions between `/library/:libraryId/book/:bookA` and `/library/:libraryId/book/:bookB` share the same stable route identity (`/library/:libraryId/book`), and skip `window.scrollTo(0, 0)` when navigating between books in the same library.
  - *Why*: Keeps the `BookDetailsView` instance, its 3-slot DOM track, and its query observers alive across swipes while still updating the browser URL and history state for deep-linking and refresh safety.
  - *Alternatives Considered*: Using `window.history.replaceState` bypassing React Router (rejected because `useParams` and React Router `location.state` would drift out of sync with the URL).

- **Decision 2: Constant-$O(1)$ 3-Slot Virtualized Deck Over $O(N)$ Virtual Lists**
  - *Chosen Approach*: Render strictly three physical slot containers (`prev`, `active`, `next`) keyed by the book ID occupying each slot. When a swipe commits and the spring finishes, shift `activeIndex` by $\pm 1$ and reset `dragX` to `0` synchronously in the same frame.
  - *Why*: DOM node count stays fixed at 3 cards whether the shelf has 5 books or 5,000 books, and keying by `bookId` allows React to reuse the already-mounted flanking DOM node when it becomes the new `active` slot—preventing any flash or layout shift on settle.

- **Decision 3: Idle-Deferred Windowed Data & Cover Bitmap Pre-Warming**
  - *Chosen Approach*: Defer adjacent book prefetching (`[activeIndex - 2, activeIndex + 2]`) to `requestIdleCallback` (with a 150ms fallback timer) *after* the swipe spring settles, and pre-decode adjacent cover URLs via `new Image()` + `img.decode()`.
  - *Why*: Guarantees zero network or image-decoding contention on the main thread during the 180ms swipe animation while ensuring adjacent covers are already decoded in GPU texture memory before the next swipe begins.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Hierarchy

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ App Router Shell (Stable Route Group Key for /library/:libraryId/book/*)  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ BookDetailsView (Index State + Keyboard / Chevron Controller)              │
│  • Resolves bookList[] from location.state or TanStack Query list cache    │
│  • Maintains committedIndex; syncs URL only after spring settle            │
└───────┬─────────────────────────────┼──────────────────────────────┬───────┘
        │                             │                              │
        ▼                             ▼                              ▼
┌──────────────────────┐  ┌──────────────────────────┐  ┌────────────────────┐
│ IdleBookPrewarmer    │  │ BookSwipeDeck (3-Slot)   │  │ Top Navigation &   │
│ • requestIdleCallback│  │ • MotionValue: dragX     │  │ Edge Chevrons      │
│ • tRPC book.get      │  │ • Axis-locked touch drag │  │ • "K of N" counter │
│   prefetch (±2)      │  │ • Velocity + threshold   │  │ • Interrupt-safe   │
│ • Image().decode()   │  │   spring commit          │  │   step triggers    │
│   cover pre-warming  │  └─────────────┬────────────┘  └────────────────────┘
└──────────────────────┘                │
                   ┌────────────────────┼────────────────────┐
                   ▼                    ▼                    ▼
        ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
        │ Slot -1 (Prev)     │ │ Slot 0 (Active)    │ │ Slot +1 (Next)     │
        │ key={prevBookId}   │ │ key={activeBookId} │ │ key={nextBookId}   │
        │ • Preview Mode     │ │ • Full Interactive │ │ • Preview Mode     │
        │ • Cached Cover +   │ │   BookContent      │ │ • Cached Cover +   │
        │   Header + Ledger  │ │ • Isolated Scroll  │ │   Header + Ledger  │
        │ • Zero network /   │ │ • Active Insights  │ │ • Zero network /   │
        │   enrichment hooks │ │   & Reviews hooks  │ │   enrichment hooks │
        └────────────────────┘ └────────────────────┘ └────────────────────┘
```

### Gesture Lifecycle & State Mapping

```text
[Touch Start / Pointer Down]
       │
       ▼
[Direction Lock Check: |dx| > 8px && |dx| > |dy| * 1.2]
       ├──► Vertical Scroll ──► Browser handles native vertical pan-y scroll
       │
       └──► Horizontal Swipe ──► Update MotionValue `dragX` directly (60/120fps)
                                 (Rubber-band 0.28x at index 0 or N-1)
                                        │
                                        ▼
                             [Touch End / Pointer Up]
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
[|dx| > 22% width OR |vx| > 420px/s]                  [Below Commit Threshold]
             │                                                     │
             ▼                                                     ▼
[Spring `dragX` to ±viewportWidth]                    [Spring `dragX` back to 0]
             │
             ▼
[On Spring Complete (Single Atomic Frame)]
  1. Reset `dragX` to 0 & update `committedIndex = nextIndex`
  2. Promote flanking `<BookContent key={nextBookId}>` from Preview -> Active
  3. Sync URL via `navigate(..., {replace: true})` (no remount via stable key)
  4. Schedule `IdleBookPrewarmer` for new `[nextIndex - 2, nextIndex + 2]`
```

### Interactive Component Specifications

1. **Route Stability & Scroll Isolation**:
   - Derive a normalized route group key in the router wrapper so `/library/:libraryId/book/:bookId` transitions do not trigger `<ErrorBoundary>` or `<Suspense>` remounts, and ignore intra-deck book parameter changes in `ScrollToTop`.
2. **3-Slot GPU Motion Deck (`BookSwipeDeck`)**:
   - Renders a `relative overflow-hidden h-full w-full touch-pan-y select-none` viewport containing the 3 positioned slot containers (`-100%`, `0%`, `+100%`) translated by `dragX`.
   - Exposes imperative `slidePrev()` and `slideNext()` methods for the header buttons, desktop edge chevrons, and `ArrowLeft` / `ArrowRight` keyboard shortcuts so button/key navigation animates with the exact same spring physics as touch swipes.
3. **Two-Tier `BookContent` & Hook Gating**:
   - Pass `isActive` into `BookContent`, `useBook`, and `useBookInsights`.
   - When `isActive === false` (flanking preview slots), `useBook` reads synchronously from `utils.book.list.getData` / `utils.book.get.getData` without enabling background `listReviews` or `library.get` network queries, `useBookInsights` skips auto-enrichment timers, and `BookContent` renders the Edition Cover, `BookHeader`, Reading Status pill, and Accession Ledger while deferring heavy Markdown and `ReviewSection` rendering until `isActive === true`.
4. **Live Drag Physics in `ReadStackCanvasCard`**:
   - Track continuous pointer/touch movement (`dragOffsetX`) on the 2D Canvas stack.
   - Feed `dragOffsetX` into the 2D Canvas `requestAnimationFrame` pose interpolation loop so the top book visibly slides, rotates, and casts a lifted shadow under the user's finger before committing or springing back on release.
5. **Dependency Cleanup & Evergreen Documentation**:
   - Remove `swiper` from `package.json`, update unit and integration tests for `BookDetailsView` and `ReadStackCanvasCard`, and document the 3-Slot Motion Deck architecture in the Evergreen Frontend & State Architecture guidelines.
