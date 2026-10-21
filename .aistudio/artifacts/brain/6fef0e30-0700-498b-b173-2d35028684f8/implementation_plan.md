# Redesigned Login & Marketing Page

Rework the unauthenticated landing and sign-in experience into a crisp, visual, 3-section page that mirrors the actual `book(ish)` interface, gives equal billing to **your physical bookshelves** and **your personal reading life**, drops the comparison table, uses a warm and informal tone, and fixes the invisible button text bug.

---

## User Review & Critical Decisions

- **Equal Billing for Shelves & Reading Life**: The headline and visual story center on bringing your real-world bookshelves and everything you read (owned, borrowed, or on your wish list) together in one warm, visual home.
- **Tight 3-Section Structure**:
  1. **Top Navigation & Hero with Live App Bento Preview**: Warm, conversational headline + primary sign-in CTA paired with an interactive mini-Bento preview modeled directly on the in-app dashboard (**Currently Reading**, **3D Stack of Books Read**, **Pick of the Day**, **Genre Breakdown**, and **Perspectives Strip**).
  2. **Visual Feature Bento Grid**: A compact 4-card visual grid highlighting how the app actually works today:
     - **Add Books Your Way**: Quick 1-click search, ISBN barcode scanner, shelf photo spine capture, or Goodreads CSV import.
     - **Physical Libraries & Shared Shelves**: Organize home, study, or household libraries and auto-spruce missing covers and details.
     - **Personal Reading Room**: Track what you are currently reading, want to read, or finished—even for books you don't physically own.
     - **Three Visual Perspectives**: Explore your books as a **3D Theme Constellation**, a **World Map** of story settings, or a **Timeline** across eras.
  3. **Bottom Sign-In Callout & Minimal Footer**: A clean closing card to sign in with Google and start adding books.
- **Button Text Contrast Fix**: Fixes the underlying utility class conflict where custom typography size utilities stripped button foreground text colors, leaving dark text on a dark button background.

---

## User Experience & Flows

### 1. Header & Navigation
- Uses the exact same brand mark treatment as the signed-in app (`book(ish)` set in bold italic display serif on warm alabaster paper).
- Clean, high-contrast **Sign In** and **Get Started** buttons in the top right without cluttered anchor links.

### 2. Hero Section & Interactive Mini-Bento Showcase
- **Headline & Copy**: Light, informal, and direct—*"Your physical bookshelves and your reading life, finally in the same room."* followed by a crisp one-sentence summary.
- **Interactive App Preview**: Renders a faithful, interactive miniature of the app's actual Bento overview:
  - **Currently Reading Card**: Shows active reads with cover art and quick status toggles.
  - **Interactive 3D Read Stack Preview**: Shows a tactile stacked spine visualization of finished books.
  - **Pick of the Day Card**: Highlights a daily recommendation pulled from your shelves with a one-line note on why it fits the mood.
  - **Scope & Perspective Switcher**: Interactive toggle allowing visitors to preview **Personal Reading Room**, **Home Library Shelf**, and the three visual perspectives (**Constellations**, **World Map**, **Timeline**) right inside the hero frame.

### 3. Compact 4-Card Feature Bento Grid
- Replaces the old multi-section marketing scroll and drops the comparison table entirely.
- Each card uses real app UI components and visual miniatures rather than long paragraphs:
  - **Card 1 — Effortless Adding (Quick Search + Advanced Tools)**: Visual preview of the 1-click search dialog alongside badges for Barcode Scan, Snap a Shelf Photo, and Goodreads Import.
  - **Card 2 — Physical Shelves & Auto-Spruce**: Visual preview of library cards (e.g., *Living Room*, *Office Shelf*) and automatic cover/metadata enrichment.
  - **Card 3 — Reading Tracker & Genre Breakdown**: Visual preview of reading lists (*Want to Read*, *Reading*, *Read*) and top genres.
  - **Card 4 — Constellations, World Map & Timeline**: Visual preview of 3D thematic clusters, geographic story pins, and publication eras.

### 4. Closing Sign-In Section
- A single, warm closing card inviting the user to sign in with Google and start tracking their first book or scanning a shelf.

---

## Key Product Decisions

- **Unified Design System**: Uses the exact surface hierarchy (warm alabaster background, crisp white surface containers, warm limestone accents), corner radii (`rounded-xl` and `rounded-2xl` cards, `rounded-lg` buttons, zero pill badges), and typography scale used across the signed-in app.
- **Informal, Book-Lover Tone**: Replaces stiff institutional phrases (*"Archival Intelligence"*, *"Physical Vault Archive"*, *"Autonomous AI Literary Curator"*) with approachable, human copy (*"Snap a shelf or search a title"*, *"Pick of the Day"*, *"See where your books take place"*).
- **Comparison Table Removed**: Removes the legacy comparison matrix component and its navigation link.

---

## Technical Architecture

- **Tailwind Merge Custom Typography Registration**: Registers the app's custom typography scale tokens as font-size utilities in the class-merging utility so they never collide with or strip text color utilities (`text-on-primary` / `text-primary-foreground`) on buttons or badges.
- **Button Foreground Guarantee**: Ensures primary and editorial button variants explicitly preserve high-contrast light text on dark button surfaces across both light and dark themes.
- **Streamlined Marketing Components**: Consolidates the landing page into a clean, self-contained layout with an interactive hero Bento showcase and visual feature cards, removing unused legacy marketing sections.

---

## Verification & Acceptance Criteria

- Primary buttons (**Get Started**, **Sign In with Google**) render crisp, high-contrast ivory text on the dark espresso button surface in all states.
- The landing page header matches the signed-in application's `book(ish)` brand typography and surface styling.
- The comparison table is completely removed.
- The hero showcase and feature Bento grid accurately reflect both Physical Libraries and the Personal Reading Room, unified 1-click search + advanced import tools, 3D Read Stack, Pick of the Day, and the Constellation / World Map / Timeline perspectives.
- All unit tests, TypeScript compilation, and linter checks pass cleanly.
