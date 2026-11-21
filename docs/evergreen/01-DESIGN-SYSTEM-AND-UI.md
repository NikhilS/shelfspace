# 01. Design System, Typography & UI Architecture

## 1. Visual Identity & Aesthetic Philosophy: "Warm Archival Studio"
`book(ish)` embodies the **Warm Archival Studio** aesthetic—inspired by museum exhibition catalogs, architectural monographs, and independent literary presses. It blends the intellectual warmth of archival paper and deep literary ink with the crisp precision of a modern curatorial studio.

* **60-30-10 Color Discipline:**
  * **60% Dominant Warm Paper Canvas:** Alabaster Paper (`#FAF7F2`) and Parchment Surface (`#FFFFFF`) in Light Mode; Deep Espresso Obsidian (`#12100E`) and Ascending Warm Charcoal Surfaces (`#181512` &rarr; `#1A1714` &rarr; `#1F1B18` &rarr; `#25211D` &rarr; `#2E2924`) in Dark Mode.
  * **30% Structural Surfaces & Ink Typography:** Warm Limestone containers (`#F4EFE6`, `#ECE5D8`), delicate 1px hairline borders (`#E4DDD0` light / `#332D27` dark), and high-contrast Antique Charcoal Ink (`#1C1917` light / `#F5F2EB` dark) paired with Warm Stone muted text (`#686259` light / `#A8A29E` dark).
  * **10% Curatorial Accent Budget:** Deep Archival Ink primary actions, Terracotta Bronze (`#9A3412` / `#EA580C`) curatorial highlights, and Forest Ink (`#047857` / `#34D399`) completion states.
* **Single-Elevation Depth, Specular Dark-Mode Rim Lighting & Hairline Architecture:** Avoid nesting "cards within cards" or placing thick left accent bars (`border-l-2`, `border-l-4`) on callouts. Surfaces are separated by generous negative space, crisp `1px solid` warm stone hairlines (`border-outline-variant/60`), and theme-reactive ambient shadows (`--shadow-elevation-1` through `--shadow-elevation-3`) that pair deep obsidian drop shadows with a `1px` top warm-ivory specular rim (`inset 0 1px 0 0 rgba(245, 242, 235, 0.05..0.075)`) in dark mode.
* **Zero-Pill & Unobstructed Cover Discipline:** Book cover frames (`2:3`) keep artwork unobstructed—static genre taxonomy belongs in the unboxed inline `Author · Year · Genre` metadata row below the title, never as a floating badge over the cover corner. Interactive segmented switchers use tactile `rounded-lg` tracks with shared Framer Motion `layoutId` spring pills (`stiffness: 500, damping: 38`).

---

## 2. Typography Hierarchy (Geometric Display Sans + UI Sans + Tabular Mono — Never Use Serif)
`book(ish)` uses a strictly sans-serif + tabular-mono typographic hierarchy across all screens, titles, and content (**never introduce, apply, or suggest serif fonts** anywhere in headings, book titles, quotes, drop caps, or UI copy):

1. **Geometric Display & Title Sans (`--font-serif` / `--font-headline-*` — `'Plus Jakarta Sans', 'Manrope', sans-serif`, with `'Playfair Display'` Italic reserved strictly for `--font-brand`):**
   * `Plus Jakarta Sans` (weights `500–800`) powers page display headings (`.layout-header-title`, `.section-heading`), library collection titles, book titles across cards and spreads, and `.editorial-dropcap` initials. *(Note: the legacy `--font-serif` / `font-serif` Tailwind token intentionally aliases to `Plus Jakarta Sans` for crisp sans-serif display headings—never map it to a serif typeface.)*
   * `Playfair Display` (italic bold) is strictly reserved solely for the `book(ish)` brand wordmark (`--font-brand`).
   * **Non-Negotiable Constraint:** Never use or propose serif typefaces (e.g., `Fraunces`, `Georgia`, `Newsreader`, `Lora`, `Source Serif`) in UI or future design iterations.
   * Display headlines use `text-wrap: balance` to prevent isolated orphan words on trailing lines.
2. **UI & Body Sans-Serif (`--font-sans` — `'Manrope', sans-serif`):**
   * Powers all interactive controls (buttons, dropdowns, tabs, inputs), navigation links, uppercase archival eyebrows (`.metadata-eyebrow`), curatorial quotes/rationales, and long-form body prose (constrained to `65ch–75ch` reading measure with `leading-relaxed`).
3. **Tabular Monospace (`--font-mono` — `'JetBrains Mono', monospace` + `tabular-nums`):**
   * Enforced on all numeric counters, publication years, date ranges, ISBNs, coordinates, and telemetry metrics (`font-variant-numeric: tabular-nums`) to guarantee vertical alignment and zero layout jitter.

---

## 3. Centralized UI Primitives (`src/components/ui/`)
All interactive and structural elements MUST use the centralized primitives in `src/components/ui/` rather than ad-hoc HTML elements or inline styles:

* **Buttons (`src/components/ui/button.tsx`):**
  * Standardized on `rounded-lg` geometry (`0.5rem`), `whitespace-nowrap shrink-0`, subtle active press feedback (`active:scale-[0.99]`), and visible focus rings (`focus-visible:ring-2 focus-visible:ring-primary/40`).
* **Selects & Dropdowns (`src/components/ui/select.tsx`):**
  * Built on Radix UI Select with `rounded-lg` triggers, warm popover surfaces, `border-outline-variant` borders, and 150ms compositor transitions.
* **Badges (`src/components/ui/badge.tsx`):**
  * Archival `rounded-md` geometry with semantic variants (`status-read`, `status-reading`, `status-to-read`, `status-abandoned`, `genre`, `subgenre`, `temporal`, `format`).
* **Dialogs & Mobile Sheets (`src/components/ui/dialog.tsx`):**
  * Responsive modal system that renders as a centered architectural dialog (`sm:rounded-2xl`) on desktop and a smooth bottom sheet (`max-sm:rounded-t-2xl`) on mobile viewports.
* **Dual-Mode DataTable (`src/components/ui/data-table.tsx`):**
  * Automatically switches between standard semantic `<table>` rendering (`<= 50` rows) and virtualized `TableVirtuoso` rendering (`> 50` rows), featuring crisp geometric sans book title cells, `tabular-nums` date columns, and 44px touch-friendly selection targets.

---

## 4. Signature Layout Patterns
1. **Bento Editorial Cards (`BookCard`, `LibraryCard` & `MonographCoverFallback`):**
   * Combine framed artwork (2:3 book covers with subtle spine lighting or 16:9 library banners) with crisp geometric sans titles, author/curator bylines, unboxed `Author · Year · Genre` metadata, and concise synopsis snippets inside a unified `bento-card` container.
   * Any book without cover artwork—and marketing preview showcases—must render via the shared `<MonographCoverFallback />` component (`src/components/book/MonographCoverFallback.tsx`) in `card`, `compact`, or `micro` variants rather than generic gray `"No cover"` placeholders or external stock photos.
2. **Unified Library Command Toolbar (`LibraryView` & `LibraryCollection`):**
   * Consolidates workspace mode tabs (*Overview · All Books · Shelf Care*), live search, filter/sort triggers, and *Grid / Table* view toggles into a coordinated sticky header system respecting the 15% mobile sticky height cap.
3. **Magazine-Style Book Details Spread (`BookDetailsView` & `BookContent`):**
   * A 12-column asymmetric exhibition layout (4-column sticky edition showcase + `dl` Accession Metadata Ledger on the left; 8-column geometric sans display header, drop-cap synopsis, narrative Where/When setting cards, author bio, and reviews on the right).
4. **Shared-Element Archival Cover Transitions (`SharedCoverFrame` & `BookContent`):**
   * Opening a book from any shelf surface (Library Grid, Library Table thumbnails, Library Overview Recent Additions, `CurrentlyReadingCard`, `ReadStackCanvasCard`, `SuggestedNextReadsCard`, Want-to-Read strip, Unread Library Pick, or `ReadingShelfCard`) physically lifts the `2:3` cover or `<MonographCoverFallback />` bookplate via a damped Framer Motion FLIP spring (`ARCHIVAL_COVER_SPRING`: `stiffness: 380, damping: 36, mass: 0.85`) while the Accession Ledger and Magazine Literary Spread settle in via a compositor-only `opacity` + `translateY` reveal (`<= 200ms`).
   * Returning via `BackToLibrary` or browser Back restores the originating route's exact `scrollY` pre-paint and reverses the cover flight to the currently active book—automatically respecting `prefers-reduced-motion`.

---

## 5. Voice, Tone & Microcopy: "Warm, Friendly, Crisp"
Every heading, subtitle, empty state, modal prompt, and status banner in `book(ish)` must embody three core qualities:

1. **Warm:**
   * Evokes the quiet comfort of a sunlit reading room or a favorite independent bookshop.
   * Celebrates *books*, *stories*, *shelves*, and *reading life* rather than databases, payloads, or software plumbing.
2. **Friendly:**
   * Conversational, encouraging, and human—speaking naturally in second person (*your shelves*, *books you're reading*).
   * Never scolds the user when a filter returns no matches, a shelf is empty, or the browser is offline; instead offers a clear, helpful next step.
3. **Crisp:**
   * Concise, scannable, and direct. Front-loads meaning in short sentences (1–2 clauses max for subtitles and descriptions) and 2–4 word action labels.
   * Avoids redundant qualifiers (e.g., use *Historical Timeline* rather than *Historical Temporal Timeline*) and avoids exposing internal engineering terminology unless paired as a brief, secondary technical footnote.

### Preferred Vocabulary & Anti-Jargon Reference

| Avoid (Robotic / Database / Over-Formal) | Prefer (Warm, Friendly, Crisp) |
| :--- | :--- |
| *records*, *documents*, *volumes*, *payloads* | **books**, **copies**, **editions** |
| *metadata*, *backfilling*, *taxonomy* | **book details**, **covers, summaries & settings**, **genres** |
| *purge heavy data leaks*, *harden persistence layer* | **optimize library storage** *(with brief `bookDetails` footnote)* |
| *surviving record*, *candidate editions* | **copy to keep**, **matching books** |
| *personal reading tracker*, *catalog only* | **Your Reading Life / Reading Room**, **Shelf Only** |
| *transaction cannot be undone*, *working offline* | **action cannot be undone**, **You're offline** |

---

## 6. Empty States & Bespoke Spot Illustrations (`src/components/ui/empty-state-illustrations.tsx`)
Empty states, ingestion dropzones, loaders, and error screens should feel like an inviting archival studio—never a dead end, a generic SaaS icon-in-a-circle, or a cold error screen:

* **Three-Part Structure:**
  1. **Dual-Tone Ink + Terracotta Spot Illustration:** Every major empty, ingestion, loading, or error state renders a lightweight, theme-aware SVG illustration from `src/components/ui/empty-state-illustrations.tsx` (`1.5px` warm ink strokes in `currentColor` paired with `fill-surface` paper bodies and warm `--color-tertiary` terracotta focal highlights at 15–30% fill opacity + `stroke-tertiary`), complemented by `<ArchivalWorldMapSvg />` equirectangular vector cartography in `WorldMapCanvas`.
  2. **Warm Display Heading:** Set in `Plus Jakarta Sans` bold (`--font-serif`), stating the state invitingly (e.g., *"Ready for Its First Book"*, *"Your Nightstand Is Clear"*, *"All Tidy—No Duplicates Found"*).
  3. **Crisp One-Sentence Prompt & Single Primary Action:** A concise sentence explaining how to populate or adjust the view, followed by at most one clear action button (when applicable).
* **Canonical Spot Illustration Catalog:**
  * `NightstandBookIllustration` — Currently Reading / Nightstand empty state
  * `BedsideStackIllustration` — Finished Stack / Read history empty state
  * `BookshelfBookendsIllustration` — Empty Library Overview, Collection, & Dashboard Libraries
  * `MagnifyingBookmarkIllustration` — Filtered shelf no-results, Book Search prompt/no-matches, & Missing Book view
  * `ConstellationSkyIllustration` — Constellation Map (`< 3` books)
  * `ChronicleSundialIllustration` — Historical Timeline empty state
  * `CartographyCompassIllustration` — Literary World Map empty state
  * `TidyShelfCheckIllustration` — Shelf Care Duplicates clean state
  * `ArchivalLedgerImportIllustration` — CSV Bulk Import dropzone
  * `ShelfViewfinderIllustration` — Shelf Camera Scanner (idle, AI-plan notice, & active optical extraction states)
  * `ExLibrisStampIllustration` — Curator's Pick empty/unavailable states & corner bookplate watermark
  * `FallenBookendIllustration` — ErrorBoundary & Dashboard catalog error states
  * `ArchivalBookLoaderIllustration` — Animated open-book motif used by `<BookLoader />` (`src/components/ui/loader.tsx`)
* **Progressive Onboarding & Getting Started Studio (`src/components/book/ReadingOnboardingStudio.tsx`):**
  * **Zero-Book State (`0` Tracked Books):** Instead of rendering multiple empty Bento cards side-by-side in the Personal Reading Room, `ReadingBento` renders `<ReadingOnboardingStudio />`—a unified Getting Started studio highlighting 3 actionable quick-start paths (search & track a book, swipe through unread library shelves or create a home library via photo/ISBN/search, and build a Want-to-Read queue) plus a 3-milestone unlock preview rail.
  * **Early-Reader State (`1–2` Tracked Books):** As books are added, `ReadingBento` progressively unlocks cards (`SuggestedNextReadsCard`, `GenreBreakdownCard` once a book is finished, and `ExplorePerspectivesStrip` with a `Needs 3+ books (X/3)` readiness indicator on Thematic Constellations) accompanied by a compact, dismissible `<ReadingOnboardingBanner />`.
