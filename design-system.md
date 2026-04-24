# Athenaeum Design System

## Brand & Style
The design system is anchored in the concept of the "Modern Archivist." It evokes the quiet, focused atmosphere of a private estate library, balancing the tactile heritage of physical books with the efficiency of digital organization. 

The aesthetic is **Minimalist-Tactile**. It utilizes generous whitespace (reminiscent of wide book margins) and a disciplined color palette, while introducing subtle physical metaphors like paper-like surfaces and fine-lined dividers. The target audience values intellectual clarity and a premium, distraction-free environment for managing their personal collections.

## Colors
The palette is derived from natural, scholarly materials.
- **Primary (Oxford Blue):** `#021a35` - Used for primary actions and navigational elements to provide a sense of authority and depth.
- **Secondary (Burnt Walnut):** `#7d5633` - Reserved for accents, indicating premium status or specific archival categories.
- **Tertiary (Library Green):** `#001f14` - Used for success states and thematic highlights within the collection.
- **Neutral (Cream Vellum):** `#fcf9f3` - The primary background color (surface/background), chosen to reduce eye strain and mimic high-quality book paper.
- **Surface (Parchment):** `#f0eee8` (mapped via surface-container) - A slightly darker neutral used for card backgrounds and secondary containers to create subtle depth.

## Typography
The typography system relies on the contrast between the literary **Newsreader** (Serif) and the refined, functional **Manrope** (Sans-Serif). 

- **Headlines:** Use Newsreader to signify the "voice" of the library.
- **Functional UI & Metadata:** Use Manrope to ensure maximum readability.
- **Labels:** Uppercase labels with generous letter spacing (e.g. `tracking-widest` or `0.1em`) for categorizations.

## Layout & Spacing
- **Grid:** Fixed Grid philosophy on desktop (12-column for main library, 8-column for reading/detail views).
- **Gutters:** Wide gutters (24px) to prevent feeling cluttered.
- **Base Unit:** 8px. Vertical rhythm strictly in multiples of 8px.

## Elevation & Depth
- **Tonal Layering:** Use colors like `bg-surface-container` vs `bg-background` instead of high-contrast shadows.
- **Architectural Shadow:** A low-opacity shadow (#1A2F4B at 8%) with a large blur radius (`shadow-[0_10px_30px_-10px_rgba(26,47,75,0.08)]` which maps to `.architectural-shadow`).
- **Debossed effect:** Subtle 1px inset border for buttons to simulate letterpress.

## Shapes
- **Forms:** Rectangular forms with soft corners (`rounded` which is `0.25rem`). Avoid pill-shaped buttons.
- **Book Covers:** Use `rounded-lg` (0.5rem) to evoke the soft edge of a hardcover book spine.

## Components
- **Buttons:** 
  - Primary: Oxford Blue (`bg-primary`) with white Manrope text (`text-on-primary font-sans`).
  - Secondary: 1px border of blue or wood-brown (`border border-primary text-primary` or `border border-secondary text-secondary`), no fill.
  - Shape: `rounded` (0.25rem).
- **Cards (Book titles):** No border, Parchment background against Vellum base (`bg-surface-container`). Subtle Newsreader title (`font-serif`).
- **Chips/Tags (Genres, categories):** Small, rectangular tags (`rounded-sm`), Library Green (`bg-tertiary/10 text-tertiary`) or Burnt Walnut (`bg-secondary/10 text-secondary`). 
- **Input Fields:** Clean bottom-border only (`border-b border-outline-variant rounded-none bg-transparent`), or fully enclosed box with light stroke (`border border-outline-variant bg-surface rounded`).
- **Navigation:** Side rail or top bar using the Primary color (`bg-primary text-on-primary`) or dark Wood (`bg-secondary text-on-secondary`), ensuring clear separation from content area.
- **Shelves:** Custom list component with subtle horizontal line divider `border-b border-outline-variant/30`, mimicking a ledger.
