# book(ish) Design System Spec: The Modern Archivist

This specification establishes a cohesive, tactile-minimalist design language for book(ish), styled after the quiet focus of a private scholarly library. It balances physical-heritage details with clean, modern utility to elevate the digital library-keeping experience.

---

## I. Visual Foundation & Color Spec

### A. The Natural Materials Palette
All colors are chosen to mimic natural elements—vellum, parchment, oxford cloth, burnt walnut, and dark woodland inks.

```
+-----------------------------------------------------------------+
| CREAM VELLUM        | #fcf9f3 |  Primary body canvas (Page-bg)  |
| PARCHMENT           | #f0eee8 |  Layered container / card fill  |
| OXFORD BLUE (Ink)   | #021a35 |  Primary branding & active headers|
| BURNT WALNUT        | #7d5633 |  Interactive highlights & accents|
| LIBRARY GREEN       | #001f14 |  Success highlights & active states|
+-----------------------------------------------------------------+
```

- **Canvas Background (`bg-background` / `#fcf9f3`):** Warm off-white off-setting stark browser whites to reduce cognitive fatigue.
- **Card Background (`bg-surface-container` / `#f0eee8`):** Mimics standard acid-free heavy parchment.
- **Surface Elevation (`bg-surface-container-lowest` / `#ffffff`):** Soft high-contrast paper elements.
- **Line Accents (`border-outline-variant/30`):** Extremely thin, light rules simulating archival ledgers ($1\text{px}$ lines).

---

## II. Typography & Literary Contrast

book(ish) leverages high-contrast pairing between literary serif and crisp, modern geometric sans-serif to create rhythm.

```
+-------------------------------------------------------------------+
|  NEWSREADER (Serif)                                                |
|  - Used for Display, Titles, and Section Headings                 |
|  - "The literary voice of the collection"                          |
+-------------------------------------------------------------------+
|  MANROPE (Sans-Serif)                                             |
|  - Used for Functional UI, Forms, Metadata Labels, and Metrics     |
|  - "The clean, metadata index cards of the archivist"             |
+-------------------------------------------------------------------+
```

### A. Headings Configuration
- **Library names, book titles:** `font-serif font-headline-lg font-bold text-primary`
- **Section Headers:** `font-serif text-2xl font-bold text-primary`

### B. Functional Labels
- **Metadata fields, tags, counts:** `font-sans text-xs font-bold tracking-[0.1em] text-on-surface-variant uppercase`
- **Body & descriptions:** `font-sans text-body-md text-on-surface/90 font-normal leading-relaxed`

---

## III. Tactile-Minimalist Layout Guidelines

### A. Fixed Grid & Proportional Spacing
- Layouts must feel open, balanced with ample white space—like generous book margins.
- **Container Margins:** Desktop wrapper uses `layout-page-content` with `max-w-[1200px] mx-auto px-6 sm:px-12`.
- **Vertical spacing:** Avoid arbitrary spaces. Standard scales include `mb-4`, `mb-8`, and `mb-12`.

### B. Elevation without heavy shadows
- Standard modern "slop" uses generic heavy dark drop shadows. book(ish) rejects this.
- **Visual Depth** is established using **Tonal Layering** (placing `bg-surface-container-low` on leading `bg-background`).
- **Architectural Shadow:** A highly transparent shadow is used sparingly for floating layouts (like dropdowns and panels):
  `shadow-[0_10px_30px_rgba(26,47,75,0.06)]` with soft overlay strokes `border border-outline-variant/40`.

### C. Rounded Corners & Shapes
- Avoid circular, pill-shaped buttons for actionable layouts, as they clash with rectilinear book dimensions.
- **Action Buttons / Active Tags:** Hard, structural `rounded` ($0.25\text{rem}$ / $4\text{px}$) or slightly soft `rounded-lg` ($0.5\text{rem}$ / $8\text{px}$).
- **Book Covers:** Retain standard paperback ratio ($2:3$) with `rounded-sm` ($2\text{px}$) and a subtle side-spine highlight to simulate depth.

---

## IV. Shared Component Signatures

### A. Archival Data Bars (Bar Lists)
Instead of arbitrary round progress lines, data visualization (such as "Top Categories") employs a full-width flat bar with solid secondary highlights:
- Background track: `bg-outline-variant/20 rounded-full h-1.5`
- Solid fill: `bg-secondary/40 group-hover:bg-secondary group-focus-visible:bg-secondary`

### B. The Ledger List (Book/Item lists)
Rows of collection indices resemble a handmade ledger:
- Transparent backgrounds with border-bottom bounds: `border-b border-outline-variant/30 hover:bg-primary/5 transition-colors duration-200`
- Clear typographic hierarchy aligning author and genre.

### C. Standard Actions (Buttons)
- **Primary:** `bg-primary hover:bg-primary-container text-white rounded font-sans font-bold text-xs uppercase tracking-wider`
- **Secondary (Outline):** `border border-secondary/20 text-secondary hover:bg-secondary/5 font-sans font-bold text-xs uppercase tracking-wider`
