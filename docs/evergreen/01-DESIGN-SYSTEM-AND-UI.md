# 01. Design System, Typography & UI Architecture

## 1. Visual Identity & Aesthetic Philosophy: "Warm Archival Studio"
`book(ish)` embodies the **Warm Archival Studio** aesthetic—inspired by museum exhibition catalogs, architectural monographs, and independent literary presses. It blends the intellectual warmth of archival paper and deep literary ink with the crisp precision of a modern curatorial studio.

* **60-30-10 Color Discipline:**
  * **60% Dominant Warm Paper Canvas:** Alabaster Paper (`#FAF7F2`) and Parchment Surface (`#FFFFFF`) in Light Mode; Deep Espresso Obsidian (`#12100E`) and Warm Charcoal (`#1C1917`) in Dark Mode.
  * **30% Structural Surfaces & Ink Typography:** Warm Limestone containers (`#F4EFE6`, `#ECE5D8`), delicate 1px hairline borders (`#E4DDD0`), and high-contrast Antique Charcoal Ink (`#1C1917`) paired with Warm Stone muted text (`#686259`).
  * **10% Curatorial Accent Budget:** Deep Archival Ink primary actions, Terracotta Bronze (`#9A3412` / `#EA580C`) curatorial highlights, and Forest Ink (`#047857` / `#34D399`) completion states.
* **Single-Elevation Depth & Hairline Architecture:** Avoid nesting "cards within cards" or placing thick left accent bars (`border-l-4`) on callouts. Surfaces are separated by generous negative space, crisp `1px solid` warm stone hairlines (`border-outline-variant/60`), and subtle multi-stop ambient diffusion shadows (`--shadow-elevation-1` through `--shadow-elevation-3`).
* **Zero-Pill Metadata Discipline:** Static metadata (publication years, volume counts, author bylines, inline taxonomy) is rendered as clean, unboxed typography with subtle separators (`·`) or structured `rounded-md` archival tags, while interactive filters and segmented controls use tactile `rounded-lg` button affordances.

---

## 2. Typography Hierarchy (The 2+1 Editorial Font Rule)
`book(ish)` uses a strict **2+1 font pairing** that keeps page headings, book titles, UI controls, and dense tables crisp and modern while reserving classical serif flair exclusively for the brand mark:

1. **Crisp Display & Heading Sans (`--font-editorial` / `--font-serif` — `'Plus Jakarta Sans', 'Manrope', sans-serif`, with `'Playfair Display'` Italic reserved strictly for `--font-brand`):**
   * `Plus Jakarta Sans` (with tight `-0.02em` to `-0.028em` tracking) powers page display headings (`.layout-header-title`, `.section-heading`), library collection titles, and book titles across cards and detail views.
   * `Playfair Display` (italic bold) is strictly reserved for the `book(ish)` top-bar brand wordmark (`--font-brand`).
   * Headlines use `text-wrap: balance` to prevent isolated orphan words on trailing lines.
2. **UI & Body Sans-Serif (`--font-sans` — `'Manrope', sans-serif`):**
   * Powers all interactive controls (buttons, dropdowns, tabs, inputs), navigation links, uppercase archival eyebrows (`.metadata-eyebrow`), and long-form body prose (constrained to `65ch–75ch` reading measure with `leading-relaxed`).
3. **Tabular Monospace (`--font-mono` + `tabular-nums`):**
   * Enforced on all numeric counters, publication years, date ranges, ISBNs, and telemetry metrics (`font-variant-numeric: tabular-nums`) to guarantee vertical alignment and zero layout jitter.

---

## 3. Centralized UI Primitives (`src/components/ui/`)
All interactive and structural elements MUST use the centralized primitives in `src/components/ui/` rather than ad-hoc HTML elements or inline styles:

* **Buttons (`src/components/ui/button.tsx`):**
  * Standardized on `rounded-lg` geometry (`0.5rem`), `whitespace-nowrap shrink-0`, subtle active press feedback (`active:scale-[0.99]`), and visible focus rings (`focus-visible:ring-2 focus-visible:ring-ring/40`).
* **Selects & Dropdowns (`src/components/ui/select.tsx`):**
  * Built on Radix UI Select with `rounded-lg` triggers, warm popover surfaces, `border-outline-variant` borders, and 150ms compositor transitions.
* **Badges (`src/components/ui/badge.tsx`):**
  * Archival `rounded-md` geometry with semantic variants (`status-read`, `status-reading`, `status-to-read`, `status-abandoned`, `genre`, `subgenre`, `temporal`, `format`).
* **Dialogs & Mobile Sheets (`src/components/ui/dialog.tsx`):**
  * Responsive modal system that renders as a centered architectural dialog (`sm:rounded-2xl`) on desktop and a smooth bottom sheet (`max-sm:rounded-t-2xl`) on mobile viewports.
* **Dual-Mode DataTable (`src/components/ui/data-table.tsx`):**
  * Automatically switches between standard semantic `<table>` rendering (`<= 50` rows) and virtualized `TableVirtuoso` rendering (`> 50` rows), featuring `font-serif` book title cells, `tabular-nums` date columns, and 44px touch-friendly selection targets.

---

## 4. Signature Layout Patterns
1. **Bento Editorial Cards (`BookCard` & `LibraryCard`):**
   * Combine framed artwork (2:3 book covers with subtle spine lighting or 16:9 library banners) with editorial serif titles, author/curator bylines, unboxed `Genre · Year` metadata, and concise synopsis snippets inside a unified `bento-card` container.
2. **Unified Library Command Toolbar (`LibraryView` & `LibraryCollection`):**
   * Consolidates workspace mode tabs (*Overview · All Books · Shelf Care*), live search, filter/sort triggers, and *Grid / Table* view toggles into a coordinated sticky header system respecting the 15% mobile sticky height cap.
3. **Magazine-Style Book Details Spread (`BookDetailsView` & `BookContent`):**
   * A 12-column asymmetric exhibition layout (4-column sticky edition showcase + `dl` Accession Metadata Ledger on the left; 8-column editorial serif header, drop-cap synopsis, narrative Where/When setting cards, author bio, and reviews on the right).
