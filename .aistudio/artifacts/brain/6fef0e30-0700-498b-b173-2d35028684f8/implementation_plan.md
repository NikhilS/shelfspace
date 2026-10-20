# Personal Reading Room UX Redesign Plan

Transform the landing page from a flat grid of tracked books into a curated, editorial **Personal Reading Room** Bento experience. The new layout spotlights active reading, renders the last 5 finished books as a tactile, messy 2D canvas stack, surfaces an AI **Pick of the Day** from your reading history with 1-click Want-to-Read, and breaks down finished books by genre using a generic component shared with the Library Details page.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following UX and architectural decisions incorporate your preferences and establish how the redesigned Reading Room operates:

- **Interactive 2D Canvas for Last 5 Read Books**: The last 5 finished books are rendered on a high-DPI HTML5 `<canvas>` laid out as an organic, slightly messy bedside stack with deterministic tilt angles, realistic paper/spine shadows, cover art (with typographic monograph fallback), smooth hover lift animation, and click-to-open navigation.
- **Compact Want-to-Read Strip & View All Drawer/Modal**: Instead of dumping all tracked books onto the landing page, a compact horizontal **Up Next (Want to Read)** strip sits cleanly below the Bento overview, paired with a **Reading Lists Modal** to browse or manage the full shelves (`Want to Read`, `Currently Reading`, `Books I've Read`, `Abandoned`) whenever needed.
- **Reading-History Pick of the Day with 1-Click Save**: The AI Curator analyzes your personal reading history (`finished` and `reading` books across all libraries and your virtual shelf) to recommend a new book, complete with a **+ Want to Read** button directly on the card.
- **Unified Generic Genre Breakdown & Curator Components**: The genre distribution bar chart and Curator Pick card in the Library Overview are extracted into generic, reusable components shared between the Personal Reading Room and individual Library Details pages.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the crowded card dump at the top of the home page with a structured, asymmetric **Editorial Reading Room** Bento layout that celebrates what you are reading right now, what you recently finished, your reading taste by genre, and what you should read next.
- **Target Audience / Persona**: Readers who want an inspiring, magazine-grade personal reading sanctuary that feels like a lived-in study—combining tactile visual delight with effortless tracking across owned and un-owned books.
- **Key Value**: Eliminates visual clutter on the home screen while elevating high-signal reading habits (active books, recent finishes, genre taste, and next reads) into distinct, scannable focal points.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Arriving at the Reading Room (Bento Overview)**:
   - **Header Bar**: Displays the reader's name, high-level reading pulse counters (`Currently Reading · Want to Read · Read`), a **"View All Lists"** button, and the primary **"Track a Book"** button.
   - **Bento Row 1 (The Active Desk — 12-Column Asymmetric Split)**:
     - **Currently Reading Spotlight (7 cols)**: Calls out the active book(s) in progress with framed 2:3 cover art, author, provenance label (`Un-owned` or `In {Library}`), a 1-click **"Mark Finished"** action, and a **"Continue / Details"** button. If multiple books are in progress, displays up to 2 side-by-side or stacked cleanly.
     - **The Read Stack — Interactive 2D Canvas (5 cols)**: Displays the last 5 books marked as `Read (Finished)` as a messy, overlapping physical stack rendered on an HTML5 `<canvas>`. Hovering over any book in the pile smoothly lifts it, casts a deeper shadow, and reveals its title, author, and star rating in the card caption; clicking opens its Book Details page. Includes a **"View All {count} Read →"** trigger.
   - **Bento Row 2 (Taste & Discovery — 12-Column Split)**:
     - **Books Read by Genre (5 cols)**: Uses the shared generic genre breakdown component to chart the genre distribution of your finished books. Clicking any genre bar opens the Reading Lists Modal filtered to that genre.
     - **Pick of the Day from Your Reading History (7 cols)**: Uses the shared Curator Pick component powered by your personal reading history. Displays cover art, title, author, the AI curator's literary rationale, a refresh button, and a **"+ Want to Read"** button that immediately saves the recommendation to your virtual `Want to Read` shelf.
2. **Browsing Up Next & Full Reading Lists**:
   - **Compact Want-to-Read Strip**: Directly below the Bento grid, if the user has books on their `Want to Read` shelf, a compact single-row strip displays up to 6 cover thumbnails with quick "Start Reading" hover actions and a **"View All ({count})"** link.
   - **Reading Lists Modal**: Clicking **"View All Lists"**, **"View All Read"**, or a genre bar opens a clean modal with shelf tabs (`All`, `Currently Reading`, `Want to Read`, `Books I've Read`, `Abandoned`) and optional genre filter so the full catalog is always one click away without cluttering the landing page.
3. **Compact Libraries Section**:
   - Remains cleanly anchored below the Reading Room divider for managing owned and shared library collections.

### Visual Identity & Theme

- **Aesthetic Direction**: **Tactile Archival Studio & Literary Salon**—warm alabaster surfaces (`--surface`, `--surface-container-low`), deep espresso typography (`--on-surface`), and terracotta/forest accents (`--primary`, `--secondary`).
- **Typography & Hierarchy**:
  - Editorial serif (`Newsreader` / `font-serif`) for section headers, book titles, and curator pull-quotes.
  - Clean humanist sans (`Plus Jakarta Sans` / `font-sans`) for controls and metadata labels.
  - Tabular monospace (`JetBrains Mono` / `font-mono tabular-nums`) for volume counts, percentages, and ratings.
- **Interactive Feedback & Motion**:
  - **2D Canvas Physics**: 60fps `requestAnimationFrame` interpolation for hover elevation, slight un-tilting on hover (`angle * 0.4`), and drop-shadow expansion on the 5-book messy stack.
  - **1-Click Want to Read**: Optimistic state transition from `+ Want to Read` to `On Want-to-Read Shelf ✓` with toast confirmation and instant shelf counter update.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: HTML5 2D Canvas for the Messy 5-Book Stack**
  - *Chosen Approach*: Build a dedicated, DPI-aware 2D `<canvas>` renderer with rotated bounding-box hit testing, asynchronous cover image loading (`crossOrigin="anonymous"`), and procedural canvas fallback covers (warm paper texture, spine groove, serif title).
  - *Why*: Fulfils the exact vision of a messy, tactile stack of the last 5 finished books on a desk while keeping DOM node count to a single `<canvas>` element and enabling rich shadow/rotation composition.
  - *Alternatives Considered*: Pure CSS transforms or WebGL/Three.js. WebGL is overkill for a 5-book card widget, while 2D Canvas provides crisp custom rendering, procedural book thickness/page edges, and exact rotated hit-testing.
- **Decision 2: Generic Shared Components for Genre Breakdown & Curator Pick**
  - *Chosen Approach*: Extract reusable `GenreBreakdownCard` and `CuratorPickCard` components (and generalize `usePickOfTheDay` to accept any book list + cache scope key) so both the Personal Reading Room and the Library Overview share a single implementation.
  - *Why*: Eliminates duplicated UI/logic, guarantees visual consistency across the app, and allows the Personal Reading Room to add a `+ Want to Read` action slot to `CuratorPickCard`.
- **Decision 3: Progressive Disclosure for Full Reading Lists**
  - *Chosen Approach*: Show the 4 high-signal Bento cards + a compact 6-book Want-to-Read strip on the landing page, and house the full filterable shelf grid inside a dedicated Reading Lists Modal/Drawer.
  - *Why*: Prevents the landing page from becoming a vertical wall of book cards as a user tracks dozens or hundreds of books.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Personal Reading Room (Home)                        │
│                                                                            │
│  ┌─────────────────────────────────────────┬────────────────────────────┐  │
│  │       CurrentlyReadingSpotlight         │    ReadStackCanvasCard     │  │
│  │  • Active book(s) cover & provenance    │  • HTML5 2D HiDPI Canvas   │  │
│  │  • 1-click "Mark Finished"              │  • Last 5 finished books   │  │
│  │  • Click to open Book Details           │  • Hover lift & click open │  │
│  └─────────────────────────────────────────┴────────────────────────────┘  │
│                                                                            │
│  ┌────────────────────────────┬─────────────────────────────────────────┐  │
│  │     GenreBreakdownCard     │             CuratorPickCard             │  │
│  │  (Shared Generic Component)│        (Shared Generic Component)       │  │
│  │  • Scoped to finished books│  • Fed by personal reading history      │  │
│  │  • Click genre -> opens    │  • 1-click "+ Want to Read" saves to    │  │
│  │    filtered Lists Modal    │    virtual shelf via trackBook          │  │
│  └────────────────────────────┴─────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Compact Want-to-Read Strip                        │  │
│  │  • Up to 6 covers + quick "Start Reading" + "View All Lists" modal   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└───────────────┬────────────────────────────────────────┬───────────────────┘
                │                                        │
                ▼                                        ▼
┌───────────────────────────────────┐    ┌───────────────────────────────────┐
│      useReadingShelf Hook         │    │     usePickOfTheDay Hook          │
│  • Partitions items into:         │    │  • Accepts (books, enabled,       │
│    - readingItems                 │    │    scopeKey)                      │
│    - finishedItems (sorted last 5)│    │  • Calls gemini.getPickOfTheDay   │
│    - wantToReadItems              │    │  • Resolves cover via metadata    │
└───────────────────────────────────┘    └───────────────────────────────────┘
```

### Interactive Component & State Mapping

1. **`ReadStackCanvasCard` (2D Canvas Stack)**:
   - **Input**: `books: TrackedBookItem[]` (sliced to the 5 most recently finished volumes, rendered bottom-to-top so the newest finished book rests on top of the pile).
   - **Canvas Rendering**:
     - Computes deterministic pose per index: slight X/Y offset from center and rotation angle (e.g., `[-10°, +7°, -5°, +9°, -3°]`), plus 3D page-block thickness edge on the right/bottom of each book cover.
     - Loads cover URLs into an image cache; if an image fails CORS or is missing, renders a bespoke archival monograph cover directly onto the canvas context (`ctx.fillText` with wrapped title/author, border rules, and spine shadow).
   - **Interaction**:
     - `onMouseMove`: Maps pointer `(clientX, clientY)` to canvas space, tests each book's rotated rectangle from top (`i = n - 1`) to bottom (`i = 0`), sets `hoveredIndex`, and updates cursor to `pointer`.
     - Hover animation loop interpolates `liftProgress[i]` (`0 -> 1`), elevating the hovered book slightly, reducing its tilt angle toward `0°`, and displaying its title, author, and rating in an interactive footer bar below the canvas.
     - `onClick`: If `hoveredIndex !== null`, navigates to `/library/${book.libraryId}/book/${book.id}`.
2. **`GenreBreakdownCard` (Generic Shared Component)**:
   - Extracted from `LibraryOverview` to accept any array of `Book` items, customizable header/eyebrow labels (`"Read by Genre"` on Home vs `"Top Categories"` in Library Overview), right-hand metadata label, and `onSelectGenre(genre)` callback.
   - Both `LibraryOverview` and `Dashboard` render this component.
3. **`CuratorPickCard` & Generalized `usePickOfTheDay`**:
   - `usePickOfTheDay(books, isEnabled, scopeKey)` uses `['pickOfTheDay', scopeKey, books.length]` so personal reading history recommendations and per-library recommendations cache independently.
   - `CuratorPickCard` renders the recommendation UI shared by both `LibraryOverview` and `Dashboard`, and accepts an optional `onAddToWantToRead` callback for the 1-click `+ Want to Read` button on the landing page.
4. **`ReadingListsDialog` (Full Shelf Drawer/Modal)**:
   - Opens when clicking `"View All Lists"`, `"View All Read"`, `"View All Want to Read"`, or any genre bar in `GenreBreakdownCard`.
   - Provides full shelf tab switching (`All`, `Currently Reading`, `Want to Read`, `Books I've Read`, `Abandoned`), genre filtering, status updates, and navigation to book details/reviews.
