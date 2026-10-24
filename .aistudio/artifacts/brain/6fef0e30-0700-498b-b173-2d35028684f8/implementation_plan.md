# Unread Shelf Spotlight Card in the Reading Room

Add a curated discovery card to the Reading Room that surfaces a random unread book from across all owned and shared libraries the user can access, sharing 100% of the `CuratorPickCard` component implementation and styling while omitting the card whenever no matching unread book exists.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following product and layout decisions were confirmed and govern this implementation:

- **Confirmed Decision 1 — Eligible Unread Pool**: Include books from all owned and shared libraries the user has access to whose personal reading status is either `unset` (not yet tracked) or `want_to_read`, while excluding any book marked `reading`, `finished` (`completed`), or `abandoned` (and excluding unowned books on the virtual reading shelf).
- **Confirmed Decision 2 — Responsive Side-by-Side Desktop & Stacked Mobile Layout**: When a matching unread library book exists, render it in a responsive 12-column grid (`grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6`) where **Pick of the Day** and **From Your Libraries** sit side-by-side (`lg:col-span-6` + `lg:col-span-6`) on desktop and automatically reflow to stack vertically (`grid-cols-1`) on mobile and compact tablet screens so neither card is cramped. When no book matches the unread criteria, omit the card entirely and preserve the existing two-card row (`Books Read by Genre` + `Pick of the Day`).
- **Confirmed Decision 3 — Card Actions & Shared Implementation**: Reuse the existing `CuratorPickCard` component without duplicating card markup or styling. Display the **Want to Read** / **On Want-to-Read Shelf** action button on the card, make the book cover and title clickable to open the book's detail view, and wire the top-left refresh button to cycle through other eligible unread books from the user's libraries.

---

### 1. Overview & Core Concept

- **What It Does**: Surfaces a serendipitous, unread book that the reader already owns or has shared access to across their libraries, reminding them of waiting treasures on their own shelves alongside the AI-powered daily recommendation.
- **Target Audience / Persona**: Readers with personal or shared home libraries who want to rediscover unread books already sitting on their shelves before acquiring new titles.
- **Key Value**: Bridges physical/shared library cataloging with personal reading tracking—turning static shelves into active reading inspiration with zero visual or code duplication.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Serendipitous Shelf Discovery**: When opening the Reading Room, if the user has at least one unread book (`unset` or `want_to_read`) across their owned or shared libraries, a second `CuratorPickCard` appears with the eyebrow `From Your Libraries · <Library Name>`.
  2. **Shuffle Another Unread Book**: Clicking the top-left refresh icon (`RefreshCw`) immediately selects a different random unread book from the eligible pool without requiring an AI Plan or extra Gemini call.
  3. **Save to Want to Read**: If the surfaced book is currently `unset`, clicking **Want to Read** updates its reading status to `want_to_read` and transitions the button to **On Want-to-Read Shelf**. If the book is already `want_to_read`, it displays **On Want-to-Read Shelf** immediately.
  4. **Inspect Book Details**: Clicking the book's cover or title navigates directly to `/library/:libraryId/book/:bookId`.
  5. **Automatic Omission**: If the user has no accessible libraries or every book across their libraries is already `reading`, `finished`, or `abandoned`, the card is omitted completely.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Warm Archival Studio—100% shared via `CuratorPickCard` (`bento-card`, warm gradient surface, corner `ExLibrisStampIllustration` watermark, and 2:3 framed cover art with `MonographCoverFallback`).
  - *Color Palette & Mood*: Warm alabaster/parchment surfaces (`--surface-container-low` to `--surface`), subtle `border-outline-variant/50` hairlines, and `--primary` archival ink accents.
  - *Typography & Hierarchy*: Uppercase sans-serif `.metadata-eyebrow` with a primary status dot, `--font-serif` (`Plus Jakarta Sans`) book title, `--font-sans` (`Manrope`) author byline, and an italic editorial blurb below a hairline divider.
  - *Responsive Layout & Mobile Reflow*:
    - **Desktop (`lg` and above)**: **Pick of the Day** and **From Your Libraries** sit side-by-side (`lg:col-span-6` + `lg:col-span-6`) with equal height (`h-full`), while **Books Read by Genre** (`md:col-span-5`) and **Up Next · Want to Read** (`md:col-span-7`) pair cleanly in the adjacent row.
    - **Mobile & Tablet (`< lg`)**: The discovery row automatically reflows into a single vertical stack (`grid-cols-1`) with `gap-5`, and inside each `CuratorPickCard` the book cover and text body gracefully stack (`flex-col sm:flex-row`) with centered mobile alignment and generous touch targets.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Single Shared `CuratorPickCard` Component**
  - *Chosen Approach*: Extend `CuratorPickCard` with optional props (`requiresAiPlan`, `requiresOnline`, `refreshTitle`, and `onSelectPick` for cover/title navigation) rather than creating a second card component.
  - *Why*: Guarantees identical visual proportions, responsive `flex-col sm:flex-row` behavior, typography, cover fallback handling, and button styling while eliminating duplicated JSX/CSS maintenance.
  - *Alternatives Considered*: Building a separate `RandomLibraryBookCard` component—rejected because it violates the DRY requirement and risks visual drift.
- **Decision 2: Cross-Library Unread Candidate Pool with Cross-Shelf Deduplication**
  - *Chosen Approach*: Fetch lightweight unread book candidates across the user's owned and shared libraries on the server (`getUnreadLibraryBooks`) and cross-filter against all books marked `reading`, `finished`, or `abandoned` by ID, ISBN, and normalized `title::author` key.
  - *Why*: Most books in a user's physical/shared libraries have no `userStatuses[userId]` entry yet (`unset`), so `getPersonalReadingShelf` (which only queries books with active `userStatuses`) does not return them. A dedicated lightweight query with field projection surfaces both `unset` and `want_to_read` library books while excluding any title the user has already started, finished, or abandoned on another shelf.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     ReadingTrackerService (Server)                       │
│  getUnreadLibraryBooks(userId, userEmail)                                │
│  ├─ Resolves owned + shared libraries (excludes virtual_ shelf)          │
│  ├─ Queries lightweight book projections per accessible library          │
│  └─ Excludes books where user status is reading / finished / abandoned   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ tRPC (readingTracker.getUnreadLibraryBooks)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       useReadingShelf & ReadingBento                     │
│  ├─ Merges server unread pool + eligible non-virtual library books       │
│  ├─ Cross-filters against active reading / finished / abandoned titles   │
│  └─ Maintains stable random pick + shuffle handler                       │
└─────────────────┬────────────────────────────────────┬───────────────────┘
                  │                                    │
                  ▼ (Always rendered)                  ▼ (Rendered iff unreadPick !== null)
┌────────────────────────────────────┐ ┌───────────────────────────────────┐
│          CuratorPickCard           │ │          CuratorPickCard          │
│  Pick of the Day (AI History Pick) │ │  From Your Libraries (Unread)     │
│  ├─ Desktop: lg:col-span-6         │ │  ├─ Desktop: lg:col-span-6        │
│  ├─ Mobile/Tablet: full-width stack│ │  ├─ Mobile/Tablet: stacks below   │
│  ├─ Refresh via Gemini Curator     │ │  ├─ Refresh shuffles local pool   │
│  └─ CTA: Want to Read              │ │  ├─ Cover/Title -> Book Details   │
│                                    │ │  └─ CTA: Want to Read             │
└────────────────────────────────────┘ └───────────────────────────────────┘
```

- **Data Model & State**:
  - `UnreadLibraryBookItem`: Lightweight projection (`id`, `libraryId`, `libraryName`, `title`, `author`, `isbn`, `coverUrl`, `publishedDate`, `primaryGenre`, `subgenres`, `series`, `synopsis`, `readingStatus: 'unset' | 'want_to_read'`).
  - `CuratorPickItem`: Extended with optional `bookId`, `libraryId`, and `libraryName` so `CuratorPickCard` can navigate to the book's detail page and update its library status.
- **Interactive Component & State Mapping**:
  - **Shuffle (`RefreshCw`)**: Selects a random candidate from `unreadCandidates` (guaranteeing a different book when `unreadCandidates.length > 1`) without network round-trips.
  - **Want to Read CTA**: Invokes `handleStatusChange(libraryId, bookId, 'want_to_read')`, optimistic/invalidated via `useReadingShelf`, transitioning the button to `On Want-to-Read Shelf`.
  - **Cover / Title Click**: Navigates to `/library/:libraryId/book/:bookId` with `{state: {from: '/'}}` so the back button returns cleanly to the Reading Room.
