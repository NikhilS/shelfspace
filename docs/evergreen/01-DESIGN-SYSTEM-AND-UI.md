# Design System & UI Architecture: The Modern Archivist

> **Document Status:** Authoritative Design System Specification  
> **Target Path:** `/docs/evergreen/01-DESIGN-SYSTEM-AND-UI.md`

---

## 1. Visual Foundation & The Natural Materials Palette

The aesthetic of **book(ish)** is rooted in the tactile qualities of physical library heritage: acid-free heavy parchment, dark woodland inks, cloth-bound spines, burnished leather, and warm archival brass.

### Color Tokens & Semantic Mappings

| Color Role | Hex / Token | Tailwind Class | Semantic Purpose |
| :--- | :--- | :--- | :--- |
| **Cream Vellum** | `#fcf9f3` | `bg-background` | Primary application canvas. Warm off-white that eliminates sterile screen glare. |
| **Acid-Free Parchment** | `#f0eee8` | `bg-surface-container` | Secondary container fill for cards, search bars, and subtle groupings. |
| **Crisp Archival Card** | `#ffffff` | `bg-surface-container-lowest` | Elevated surface for high-contrast index cards, modals, and dropdown panels. |
| **Oxford Blue (Ink)** | `#021a35` | `text-primary` | Deep rich ink used for authoritative headings, primary buttons, and key icons. |
| **Burnt Walnut** | `#7d5633` | `text-secondary` / `border-secondary` | Warm leather tone for active highlights, focus rings, and accent tags. |
| **Library Green** | `#001f14` | `text-accent` | Traditional desk-lamp emerald used for verified statuses, active reads, and success badges. |
| **Archival Ledger Rule** | `rgba(2,26,53,0.12)` | `border-outline-variant/30` | Ultra-thin 1px ruling simulating classic archival ledgers and card catalogs. |

---

## 2. Typography & Optical Hierarchy

### Font Family Allocation

```
+-------------------------------------------------------------------------+
| PLAYFAIR DISPLAY (Italic, Bold / Semibold)                              |
| - Strictly reserved for the top bar brandmark: "book(ish)"             |
| - Expressive, playful, and charming literary masthead                   |
+-------------------------------------------------------------------------+
| MANROPE (Geometric Sans-Serif: Regular, Medium, Semibold, Extrabold)     |
| - Universal typeface for all UI, headings, labels, buttons, tables,     |
|   forms, modal dialogs, and metadata fields                             |
| - Clean, architectural, highly legible at both 11px and 48px            |
+-------------------------------------------------------------------------+
```

### Typographic Scales & Rules

1. **Brand Wordmark:**
   - Classes: `font-brand italic text-2xl sm:text-[28px] font-bold tracking-tight text-primary leading-none select-none`
   - Never apply `font-brand` to body paragraphs, section titles, or button labels.
2. **Page & Section Headings:**
   - Library Title / Primary Hero: `font-sans font-headline-lg font-extrabold text-primary tracking-tight`
   - Section Headers: `font-sans text-xl sm:text-2xl font-bold tracking-tight text-on-surface`
   - Subheadings / Card Headers: `font-sans text-base sm:text-lg font-semibold tracking-tight text-on-surface`
3. **Archival Metadata & Functional Labels:**
   - Uppercase Metadata Badges: `font-sans text-xs font-bold tracking-widest text-on-surface-variant uppercase`
   - Category / Genre Chips: `font-sans text-xs font-semibold tracking-wide text-on-surface-variant`
   - Baseline Body Text: `font-sans text-sm sm:text-base text-on-surface/90 font-normal leading-relaxed`

---

## 3. Spatial Mathematics & Layout Invariants

### Container Dimensions & Margins
- **Application Max Width:** `max-w-7xl mx-auto` or `max-w-[1280px] mx-auto`. Never let text lines stretch across ultrawide monitors without bounding (max 75 characters per line).
- **Responsive Padding:** Use standard utility `.layout-page-content` (`px-4 sm:px-6 lg:px-8 py-6 sm:py-8`).
- **Rhythmic Vertical Spacing:**
  - Between tightly related elements (title + author): `gap-1` or `mb-1.5`
  - Between component sections (filters to grid): `mb-6 sm:mb-8`
  - Between major page zones: `space-y-8 sm:space-y-12`

### Tonal Layering (Elevation without Heavy Shadows)
Modern "AI slop" relies on dark, heavy Gaussian blurs. book(ish) achieves optical depth through **surface luminance stacking**:
- **Layer 0 (Canvas):** `bg-background` (`#fcf9f3`)
- **Layer 1 (Card Grouping):** `bg-surface-container` (`#f0eee8`) with `border border-outline-variant/30`
- **Layer 2 (Interactive Flyout / Modal):** `bg-surface-container-lowest` (`#ffffff`) with subtle architectural shadow:  
  `shadow-[0_10px_30px_rgba(2,26,53,0.06)] border border-outline-variant/40`

### Corner Radii & Tactile Shapes
- **Action Buttons & Inputs:** Hard structural `rounded` (4px) or `rounded-lg` (8px). **Never use pill-shaped (24px+) buttons for action items**; pill shapes conflict with the rectangular architecture of physical books.
- **Modals & Dialogs:** Smooth generous curvature: `rounded-[24px]` or `rounded-[32px]`.
- **Book Covers:** Strictly adhere to the standard paperback aspect ratio ($2:3$). Always style book covers with `rounded-sm` (2px) and a subtle linear gradient simulating the side spine fold (`border-l-2 border-primary/20` or inner spine drop-shadow).

---

## 4. Shared Component Signatures

### A. Archival Ledger Table
For dense data views (book lists, transaction history, extracted shelf results):
- Rows must resemble ruled ledger lines with subtle bottom dividers: `border-b border-outline-variant/20 hover:bg-surface-container-low/60 transition-colors`
- Numeric columns (year, page count, ratings) must use tabular figures: `font-mono tabular-nums`.

### B. Flat Archival Data Bars
Data visualizers (category breakdown, timeline era density):
- Track: `bg-outline-variant/20 rounded-full h-1.5 overflow-hidden`
- Fill: Solid, non-gradient fills using `bg-primary/80` or `bg-secondary/70` with smooth hover states.

### C. Buttons & Controls
- **Primary Action:** `bg-primary hover:bg-primary-container text-white font-sans font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded shadow-xs active:scale-[0.99] transition-all`
- **Secondary / Ghost:** `border border-outline-variant/40 hover:bg-surface-container text-on-surface font-sans font-semibold text-xs uppercase tracking-wider px-4 py-2.5 rounded transition-all`

---

## 5. The Anti-Slop Directive Checklist

Before submitting any UI changes, verify against the following blacklist:

- [ ] **NO Purple-to-Blue Gradients:** Saturated tech-demo gradients are strictly banned.
- [ ] **NO Glassmorphism in Light Mode:** Do not apply heavy frosted-glass backdrops over warm paper surfaces.
- [ ] **NO Gradient Text:** Text must be solid Oxford Blue (`text-primary`), Burnt Walnut (`text-secondary`), or high-contrast ink.
- [ ] **NO Hero Eyebrows:** Do not add tiny tracked-out uppercase marketing chips above headers unless they represent true domain tags.
- [ ] **NO Nested Cards:** Avoid wrapping cards inside cards. Establish hierarchy with negative space, border rules, and font weights.
- [ ] **NO Text Wrapping Inside Badges:** Badges, chips, and buttons must keep labels on a single line (`whitespace-nowrap`).
