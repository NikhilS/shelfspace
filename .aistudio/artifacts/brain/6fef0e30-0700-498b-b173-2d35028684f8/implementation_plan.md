# Progressive Onboarding & Getting Started Studio

A warm, adaptive onboarding experience that replaces repetitive empty dashboard cards with a unified **Getting Started Studio** for brand-new readers, progressively unlocks analytics and spatial visualizers as books are tracked, and guides users with zero libraries through photo shelf scanning, book search, and shared collections.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions incorporate your confirmed preferences from our design interview:

- **Confirmed Decision 1 — Unified Zero-State Welcome Studio**: When a user has zero tracked books in their Reading Room, the multi-card stack of empty placeholders is replaced by a single, cohesive **Getting Started Studio** with tailored quick-start paths and a preview of what unlocks next.
- **Confirmed Decision 2 — Progressive Unlocking for Early Readers (1–2 Books)**: As a user logs their first one or two books, the dashboard transitions into a streamlined Reading Room that surfaces active shelves and recommendations immediately while folding unpopulated secondary cards and highlighting remaining milestones (such as the 3-book threshold for 3D Thematic Constellations).
- **Confirmed Decision 3 — Three Quick-Start Pathways**: The onboarding flow highlights three concrete entry points:
  1. **Search & Track a Current or Favorite Read** (opens the quick search modal pre-targeted to *Currently Reading* or *Read*).
  2. **Swipe Through Owned or Shared Library Shelves** (launches the *"Have You Read It?"* rapid triage deck when accessible library books exist, or lets users mark unread shelf picks directly).
  3. **Create a Home Library via Photo Scan or Search** (triggers library creation or guides users on how shared libraries appear).

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the cold, multi-card empty state of the Personal Reading Room and Libraries dashboard into an inviting, adaptive onboarding journey that meets each reader where they are—whether they have zero books and zero libraries, access to a shared family library with unread books waiting to be triaged, or one or two tracked books on their shelf.
- **Target Audience / Persona**:
  - **Brand-New Readers (0 Tracked Books, 0 Libraries)**: Signing in for the first time and needing clear, welcoming guidance on how *Your Reading Life* (personal reading tracker) connects with *Libraries* (physical or shared home collections).
  - **Invited Collaborators (0 Tracked Books, 1+ Shared/Owned Libraries)**: Users who already have books available on a shared or owned library shelf and can jumpstart their reading profile in seconds by swiping through *"Have You Read It?"*.
  - **Early Readers (1–2 Tracked Books)**: Users who have added their first book and want to see immediate value (Suggested Next Reads, Nightstand, Timeline/Map) without staring at empty placeholder boxes.
- **Key Value**: Eliminates "empty-card fatigue," teaches the core mental model of `book(ish)` naturally through action, and gets users to their first AI-curated recommendation and spatial map in under a minute.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Flow A — Zero Tracked Books (The Unified Getting Started Studio)**:
   - Instead of five separate empty Bento cards and an empty exploration strip, the Reading Room Overview presents the **Getting Started Studio**:
     - **Editorial Header**: Warm welcome heading (*"Welcome to Your Reading Room"*), accompanied by the bespoke monoline `NightstandBookIllustration` and a concise explanation of how tracking a few books shapes recommendations and visual maps.
     - **Three Actionable Quick-Start Cards**:
       1. **Start With What You're Reading (or Loved)**: Primary action card with one-click buttons to **Track Current Read** or **Log a Finished Favorite** via the Quick Search dialog.
       2. **Triage Your Library Shelves** *(Adaptive)*:
          - *When accessible libraries have books*: Highlights the number of unread books waiting across their libraries and provides a direct **Swipe Through Shelves** button launching the *"Have You Read It?"* swipe deck (plus an inline preview of a book from their shelves they can mark *Read* or *Currently Reading* with one click).
          - *When no libraries exist yet*: Invites the user to **Create a Home Library** (mentioning bookshelf photo scanning, barcode scanning, and CSV import) or notes that shared libraries linked to their email will appear automatically.
       3. **Build Your Want-to-Read Queue**: Invites the user to save a book they've been meaning to pick up next so their reading queue is ready.
     - **What Unlocks Next (Milestone Preview Rail)**: A quiet archival footer strip showing the three capabilities that unlock as books are added:
       - *1st Book* → **Suggested Next Reads & Literary World Map / Timeline**
       - *1st Finished Book* → **Interactive Read Stack & Genre Breakdown**
       - *3rd Book* → **3D Thematic Constellations Galaxy**

2. **Flow B — Early Reader / "Mostly-Empty" State (1–2 Tracked Books)**:
   - As soon as the user tracks their first book, the full-page studio gives way to the live **Reading Room Bento** with progressive disclosure:
     - **Compact Onboarding Milestone Banner**: A slim, dismissible progress bar at the top of the Bento showing completed and remaining starter steps (e.g., *1 of 3 steps complete · Log a finished book · Add 1 more book to unlock 3D Constellations*) with direct action triggers.
     - **Focused Active Cards**:
       - Row 1 shows **Currently Reading** and the **Read Stack** (with a warm single-click prompt to log a finished favorite if `finishedBooks` is still zero).
       - Row 2 immediately surfaces **Suggested Next Reads** powered by their first tracked book(s) and any unread library shelves.
       - Row 3 (**Books Read by Genre** + **Want to Read**) adapts cleanly: if both are empty, they are hidden to avoid stacked empty boxes; once either has data, the populated card(s) appear.
     - **Smart Exploration Readiness**: In the **Explore Your Reading** strip, **Historical Timeline** and **Literary World Map** are immediately active with 1+ book, while **Thematic Constellations** displays a helpful progress badge (*"Needs 3+ Books · 1/3"*) and clear microcopy explaining that 3 books are needed to plot 3D thematic clusters.

3. **Flow C — Richer Empty Libraries Section (No Access to Any Library)**:
   - When the user has zero owned or shared libraries at the bottom of the dashboard, the Libraries empty state presents a structured two-column archival callout:
     - **Left: Catalog Your Shelves**: Explains how to create a personal or household library and add books by snapping a bookshelf photo, scanning ISBNs, or searching—with a primary **Create Your First Library** button.
     - **Right: Shared With Friends & Family**: Explains that libraries shared with their account email automatically appear here and feed into their Reading Room recommendations and swipe deck.

### Visual Identity & Theme

- **Aesthetic Direction**: Follows the **Warm Archival Studio** design system—tactile limestone and alabaster paper surfaces (`bg-surface`, `bg-surface-container-low`), delicate `1px` warm stone hairlines (`border-outline-variant/60`), and bespoke monoline ink-and-terracotta spot illustrations.
- **Typography & Hierarchy**:
  - Display headings and step titles in `--font-serif` (`Plus Jakarta Sans` semi-bold with `text-wrap: balance`).
  - Body prose and action buttons in `--font-sans` (`Manrope`).
  - Step counters, book counts, and milestone ratios (`1 / 3`) in `--font-mono tabular-nums`.
- **Anti-Slop & Restraint**:
  - Rectilinear `rounded-lg` buttons and `rounded-md` archival badges (no pill buttons).
  - No nested card-in-card clutter or thick left accent bars (`border-l-4`); sections use clean hairline dividers and tonal surface layering.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Adaptive Zero-State vs. Static Onboarding Wizard**
  - *Chosen Approach*: An inline, adaptive **Getting Started Studio** embedded directly inside the Reading Room Overview when `scopedItems.length === 0`, paired with a compact dismissible milestone strip when `1 <= scopedItems.length < 3`.
  - *Why*: Avoids blocking modals on arrival (respecting the zero-arrival-popup rule) while eliminating the wall of 5+ empty Bento cards. Users can immediately interact with real search, swipe, and library creation flows in place.
  - *Alternatives Considered*: A multi-step modal wizard on login was rejected because it traps users before they can see their workspace and feels heavy for invited users who already have shared libraries.

- **Decision 2: Contextual Library Triage in Onboarding**
  - *Chosen Approach*: Dynamically inspect `unreadLibraryBooks` and `libraries` inside the onboarding studio so users with shared or owned libraries can launch the *"Have You Read It?"* swipe deck or mark an unread shelf book right from the welcome card.
  - *Why*: Many new users join `book(ish)` because a family member or friend shared a library with them, or they created a library first. Letting them triage existing shelves is the fastest way to populate their reading history.

- **Decision 3: Progressive Unlocking Thresholds**
  - *Chosen Approach*:
    - `0` tracked books → Unified **Getting Started Studio** (suppresses empty Bento rows and empty Explore strip).
    - `1+` tracked books → Unlocks **Currently Reading**, **Suggested Next Reads**, and **Explore Your Reading** (with a `N / 3 Books` readiness indicator on **Thematic Constellations** until 3 books are tracked).
    - `1+` finished or want-to-read books → Unlocks the **Books Read by Genre** and **Up Next · Want to Read** row.
  - *Why*: Every card on screen either contains live, personal book data or a single focused next step—never redundant empty boxes.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Personal Reading Room (Dashboard)                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       ReadingBento Orchestrator                       │  │
│  │                                                                       │  │
│  │  [State A: 0 Tracked Books]                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                 ReadingOnboardingStudio                         │  │  │
│  │  │  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────┐  │  │  │
│  │  │  │ 1. Track a Book   │ │ 2. Swipe / Create │ │ 3. Save Up    │  │  │  │
│  │  │  │ (Current or Read) │ │    Home Library   │ │    Next Queue │  │  │  │
│  │  │  └─────────┬─────────┘ └─────────┬─────────┘ └───────┬───────┘  │  │  │
│  │  │            ▼                     ▼                   ▼          │  │  │
│  │  │  ┌───────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ Milestone Preview Rail (1+ Recs/Map · 1+ Genres · 3+ 3D)  │  │  │  │
│  │  │  └───────────────────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  [State B: 1–2 Tracked Books (Early Reader / Mostly-Empty)]           │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Compact Getting Started Milestone Banner (Dismissible, 1–2/3)   │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │  ┌───────────────────────────────────┐ ┌───────────────────────────┐  │  │
│  │  │ CurrentlyReadingCard              │ │ ReadStackCanvasCard       │  │  │
│  │  └───────────────────────────────────┘ └───────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ SuggestedNextReadsCard (Hybrid AI + Catalog Graph + Shelf)      │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Conditional GenreBreakdownCard / WantToRead (Shown when > 0)    │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ ExplorePerspectivesStrip (Timeline + Map Ready; 3D shows N/3)   │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              Libraries Section (0 Libraries Welcome Guide)            │  │
│  │   • Create a Home Library (Photo Shelf Scan / ISBN / Search)          │  │
│  │   • Shared Collections Info (Automatic sync via account email)        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Derived Onboarding State (Zero Extra Network Calls)**:
  - Computed directly from already-loaded queries in `Dashboard` and `ReadingBento`:
    - `scopedItems` (`readingBooks`, `finishedBooks`, `wantToReadBooks`) from `useReadingShelf`.
    - `unreadLibraryBooks` (with `libraryId` and `libraryName`) from `useReadingShelf`.
    - `libraries` list and `onCreateLibrary` callback passed from `Dashboard` to `ReadingBento`.
- **Dismissal Persistence**:
  - The compact Getting Started Milestone Banner (shown when `1 <= scopedItems.length < 3`) stores its dismissed flag in `localStorage` scoped to the user (`bookish_onboarding_banner_dismissed_${uid}`) so users can hide it anytime, and it automatically retires once `scopedItems.length >= 3` and `finishedBooks.length >= 1`.

### Interactive Component & State Mapping

- **Action 1 — Track Current or Finished Book**: Invokes `onTrackBook('reading')` or `onTrackBook('finished')`, opening `QuickAddBookDialog` pre-set to the chosen reading status shelf.
- **Action 2 — Swipe Library Shelves / Quick-Mark Unread Shelf Book**:
  - When `unreadLibraryBooks.length > 0`, navigates directly to `/library/${firstLibraryId}/swipe` (*"Have You Read It?"*) or lets the user mark the featured unread book as *Read* / *Currently Reading* via `onStatusChange` with optimistic cache patching (`readingStatusCache.ts`).
  - When `libraries.length === 0`, invokes `onCreateLibrary()` to open `CreateLibraryDialog` (or navigates to `/library/:id/add` once created).
- **Action 3 — Explore Perspectives Readiness**:
  - `ExplorePerspectivesStrip` computes `totalBooksCount = books.length`. When `totalBooksCount < 3`, the **Thematic Constellations** card displays a `Needs 3+ Books (${totalBooksCount}/3)` badge and tailored subtitle so users know why 3D clustering needs at least 3 books.
