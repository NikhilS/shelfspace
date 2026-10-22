# Evergreen Voice & Tone Guidelines & App Microcopy Plan

## 1. Confirmed Decisions
- **Evergreen Documentation**: Expand the Design System & UI documentation and Evergreen Index to establish **Warm, Friendly, Crisp** as a foundational product principle alongside the existing visual and typographic system, and document the monoline + terracotta empty-state illustration patterns.
- **Full-App Microcopy Refinement**: Update all three audited product areas—Shelf Care & Maintenance, Exploratory Views (Timeline, World Map, Constellations), and Reading Room, Library Overview, Add/Edit Book, and Modals—so every heading, subtitle, action label, and status banner reflects the unified voice.
- **Storage Optimization Presentation**: Present the Shelf Care storage optimization card in plain, reassuring English (*Optimize Library Storage*) while keeping a brief, clear technical footnote referencing the underlying `bookDetails` and `bookDetailsMetadata` separation.

---

## 2. Voice & Tone Architecture

```
                 ┌───────────────────────────────────────────┐
                 │      VOICE: WARM · FRIENDLY · CRISP       │
                 │  Inviting bookshop feel · Conversational  │
                 │  Direct, concise, zero database jargon    │
                 └─────────────────────┬─────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Evergreen Docs    │     │  Shelf Care & Core  │     │ Exploratory & Forms │
│                     │     │      Workflows      │     │                     │
│ • Golden Rule Entry │     │ • Missing Details   │     │ • Historical        │
│ • Voice Pillars &   │     │ • Possible          │     │   Timeline          │
│   Vocabulary Table  │     │   Duplicates        │     │ • World Map &       │
│ • Empty-State & SVG │     │ • Optimize Library  │     │   Constellations    │
│   Spot Art Spec     │     │   Storage (+Note)   │     │ • Reading Room &    │
│                     │     │ • Reset Book        │     │   Add/Edit Modals   │
│                     │     │   Details           │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

---

## 3. Evergreen Documentation Additions

### Design System & UI Guide + Master Index
- **Golden Rule Addition**: Register *Voice & Microcopy (Warm, Friendly, Crisp)* in the master architectural principles table and log the milestone in the Living Architecture Changelog.
- **Voice Pillars**:
  - **Warm**: Evokes a sunlit personal reading room or favorite neighborhood bookshop—celebrating books, stories, and shelves rather than databases, payloads, or records.
  - **Friendly**: Speaks naturally in second person (*your shelves*, *books you're reading*), offering helpful guidance when offline or when a shelf is empty.
  - **Crisp**: Front-loads meaning in short, scannable sentences and action labels; eliminates redundant adjectives and technical filler.
- **Preferred Vocabulary Table**:
  - *Books / copies / editions* instead of *records / volumes / documents / payloads*
  - *Details / covers & summaries* instead of *metadata / enrichment fields*
  - *Optimize storage* instead of *purge heavy data leaks / harden persistence*
  - *Reading Room / shelves* instead of *tracker / catalog / archive*
- **Empty States & Spot Illustrations Standard**: Document the rule that every empty state pairs a warm, crisp heading and one-sentence prompt with a bespoke monoline ink-and-terracotta spot illustration.

---

## 4. App-Wide Microcopy Updates

### A. Shelf Care & Maintenance
- **Shelf Care Header & Navigation**:
  - Subtitle: *"Keep your shelves in great shape—fill in missing book details, merge duplicate copies, and tidy up library storage."*
  - Offline banner: *"You're offline. Finding duplicates and filling in book details require an internet connection."*
  - Tab labels: **Missing Details**, **Duplicates**, and **Storage & Reset**.
- **Missing Details (Enrichment)**:
  - Subtitle: *"See which books are missing covers, summaries, or settings, and fill them in with one click."*
  - Progress counts use *"books"* instead of *"volumes"*.
- **Duplicates & Merge Modal**:
  - Section heading: **Possible Duplicates** with subtitle *"Compare matching books side-by-side to combine their details, remove extra copies, or keep both editions."*
  - Scanning state: *"Checking Your Shelves for Duplicates..."* / *"Comparing titles, authors, and ISBNs in the background while you browse."*
  - Merge dialog: **Merge Duplicate Books** — *"Choose which copy to keep and click any detail below to combine the best information into a single book."*
  - Status preservation note: *"Reading progress & reviews are kept automatically: We'll keep your furthest reading status (Read > Currently Reading > Abandoned > Want to Read) and move all reviews to the book you keep."*
  - Step 1 heading: *"1. Choose Which Copy to Keep"*.
- **Storage & Reset**:
  - **Optimize Library Storage**: *"Keep your library fast and lightweight by storing long summaries, author bios, and AI data separately from your main book list."*
  - Actionable state: *"X book(s) can be optimized for faster loading"* — explains in plain language that full summaries or AI vectors on the main shelf entry will be moved to the dedicated `bookDetails` collection while leaving lightweight `bookDetailsMetadata` flags. Action button: **Optimize Storage (X)** / modal confirm: **Optimize Now**.
  - Optimized state: **Library Storage Is Optimized** — *"All X books are cleanly organized for fast loading, with long summaries and AI vectors stored separately in `bookDetails`."* Action button: **Check Again**.
  - **Reset Book Details**: *"Clear a specific detail (like covers, genres, or summaries) across all books if you want to start fresh."*

### B. Exploratory Views & Perspectives Strip
- **Historical Timeline**:
  - Title: **Historical Timeline** (removing the redundant *"Temporal"*).
  - Subtitle: *"Follow your books through history—from ancient eras to the modern day—along a winding river of time."*
  - Summary pills: *"X Historical Books"*, *"Earliest:"*, and *"Latest:"*.
- **World Map**:
  - Subtitle: *"Explore the real-world cities, regions, and landscapes where your books take place."*
  - Cluster toggle label: **Pin Clusters**.
- **Constellations**:
  - Subtitle: *"A star map of your reading life—books with kindred themes and stories cluster together into constellations."* (adapting to *"of your library"* in single-library view).
  - Action button: **Refresh Map**; loading message: *"Charting your constellations..."*.
- **Explore Perspectives Strip**:
  - Subtitle: *"Explore your books across history, geography, and theme"*.
  - Concise card subtitles (*"Historical eras & publication years"*, *"Story settings & real-world places"*, *"Connected clusters by genre & theme"*) and crisp action links (*"Open Timeline"*, *"Open World Map"*, *"Open Constellations"*).

### C. Reading Room, Library Overview, Add/Edit Book & Modals
- **Reading Room**:
  - Header eyebrow: **Your Reading Life**.
  - Libraries section subtitle: *"Your home bookshelves and collections shared with friends and family."*
- **Library Overview**:
  - Section 1 subheading: *"What you're reading now and a daily pick from your shelves"* (when actively reading) or *"A daily recommendation and the genre mix on your shelves"* (when idle).
  - Section 2 subheading: *"Recently added to this library"*.
- **Share Library Modal**:
  - Description: *"Invite friends or family by email to view or edit this library. New readers can join as soon as an admin approves their invite."*
- **Add Books & Quick Add Dialog**:
  - Heading: **Add Books**.
  - Subtitle: *"Add books from your shelves by search, ISBN barcode scan, shelf photo, CSV import, or manual entry."* (and context-aware equivalent in Reading Mode).
  - Method card: **Search Books**; initial status radio option: **Shelf Only**.
- **Book Details, Edit Form & AI Notes**:
  - Missing cover placeholder: **No Cover Yet**; missing ISBN placeholder: **None listed**.
  - Format options: **Physical Book** and **Digital / E-Book**.
  - Delete confirmation: *"This action cannot be undone."*
  - AI panel loading prompt: *"Putting together notes..."*.
