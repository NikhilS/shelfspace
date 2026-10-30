# Swipeable Currently Reading Card & Instant Reading Status Cache Sync

## 1. Context & Goals
1. **Swipeable `CurrentlyReadingCard` via Shared `BookSwipeDeck`:**
   - Reuse the constant-$O(1)$ 3-slot GPU-composited `BookSwipeDeck` (`src/pages/book-details/BookSwipeDeck.tsx`) inside `CurrentlyReadingCard` (`src/pages/dashboard/CurrentlyReadingCard.tsx`) so users can smoothly swipe left/right between multiple `"reading"` books at 60fps.
   - Enhance `BookSwipeDeck` to support both **touch** and **mouse/trackpad pointer dragging** (while ignoring interactive child buttons/links via `isInteractiveNoSwipeTarget`) and dynamic container height for card layouts.
   - Replace the bottom `"Also Reading"` title pills with a **compact `1 / N` chevron stepper** in the card header (paired with the `"View All"` action when applicable) that drives `BookSwipeDeck`'s imperative `slidePrev()` / `slideNext()` API.
   - Reuse the upgraded `CurrentlyReadingCard` in **`LibraryOverview`** (`src/pages/library/LibraryOverview.tsx`), replacing the previous static list of up to 2 cards so all active reads in a library are swipeable in one cohesive card.

2. **Eliminate the 5-Minute Reading Status Cache Lag:**
   - Because `queryClient` (`src/lib/queryClient.ts`) and `useLibraryData` (`src/hooks/useLibraryData.ts`) use a 5-minute `staleTime` persisted in IndexedDB, any status mutation that fails to optimistically update or invalidate *both* `readingTracker.getShelf` and `book.list` / `book.get` leaves either the Reading Room Dashboard or the Library Overview stale for up to 5 minutes.
   - Create a unified reading-state cache synchronization utility (`src/lib/readingStateCache.ts`) that:
     - **Optimistically patches (`setData`)** `readingTracker.getShelf({shelf: 'all'})` (inserting/updating the `TrackedBookItem`, recalculating `counts`, or removing when `'unset'`), `book.list({libraryId})`, and `book.get({libraryId, bookId})` immediately on mutation start (`onMutate`), ensuring **0ms UI updates** even if the user navigates back before the server call settles.
     - **Uniformly invalidates (`invalidate`)** `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`, `book.list`, and `book.get` (including resolving the underlying physical `libraryId` when a book is viewed from a `virtual_<uid>` shelf) across every status mutation entry point.

---

## 2. Proposed Technical Changes

### A. Shared `BookSwipeDeck` Enhancements (`src/pages/book-details/BookSwipeDeck.tsx`)
- **Pointer/Mouse Drag Support Alongside Touch:**
  - Add optional mouse/pointer drag handlers (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`) in addition to the existing touch gesture handlers so desktop and trackpad users can also drag slides horizontally.
  - Track a `didDragRef` threshold (`> 6px`) and suppress accidental `onClickCapture` navigation when releasing a drag gesture.
- **Flexible Layout Mode for Embedded Cards:**
  - Support an `autoHeight?: boolean` prop on `BookSwipeDeck`: when `autoHeight` is true (used in `CurrentlyReadingCard`), the active center slot (`offset === 0`) is positioned `relative` to naturally size the card container, while flanking slots (`offset === -1 | 1`) are positioned `absolute inset-0` with `translate3d(${slot.offset * 100}%, 0, 0)`.

### B. Swipeable `CurrentlyReadingCard` (`src/pages/dashboard/CurrentlyReadingCard.tsx` & `src/pages/library/LibraryOverview.tsx`)
- **3-Slot Carousel Integration:**
  - Embed `BookSwipeDeck` (with `autoHeight`) when `readingBooks.length > 1`, keyed by `${book.libraryId}::${book.id}`, passing `bookList` state on navigation so swiping continues seamlessly inside `BookDetailsView`.
- **Compact `1 / N` Chevron Stepper:**
  - Remove the bottom `"Also Reading"` pill strip.
  - In the card header right area, render a rectilinear (`rounded-lg`) `1 / N` counter and previous/next chevron buttons (`slidePrev` / `slideNext`) alongside `"View All"` (when `onOpenReadingLists` is provided).
- **Shared Usage in `LibraryOverview`:**
  - Replace the `.slice(0, 2).map(...)` block in `src/pages/library/LibraryOverview.tsx` with `CurrentlyReadingCard`, passing all books in the library with `readingStatus === 'reading'` and wiring inline `"Mark Finished"` status updates to the unified reading status mutation + cache sync.

### C. Unified Optimistic Cache & Invalidation (`src/lib/readingStateCache.ts`)
- **`applyOptimisticReadingStatusUpdate(utils, params)`:**
  - Synchronously patches `utils.book.get`, `utils.book.list` (for the active `libraryId` and any origin `libraryId` on the book snapshot), and `utils.readingTracker.getShelf({shelf: 'all'})` (updating or inserting the `TrackedBookItem` at the front of `items` and recomputing `counts`).
  - Removes the book from `utils.readingTracker.getUnreadLibraryBooks` when marked as `'reading'`, `'finished'`, or `'abandoned'`.
- **`invalidateReadingStateQueries(utils, params)`:**
  - Invalidates `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`, `book.get`, and `book.list` for all affected library IDs.
- **Wire Across All Mutation Call Sites:**
  - `src/pages/book-details/useBook.ts` (`updateReadingStatusMutation` & `updateBookMutation`)
  - `src/pages/dashboard/useReadingShelf.ts` (`updateItemStatus` & `trackBookItem`)
  - `src/hooks/useSelection.ts` (`handleBulkStatusChange` / `batchUpsertMutation`)
  - `src/components/book/QuickAddBookDialog.tsx` & `src/pages/AddBookView.tsx` (`handleTrackExisting`)
  - `src/pages/ReadSwipeView.tsx` (swipe status updates)

---

## 3. Verification Plan
1. **Unit & Component Tests:**
   - Add/update tests in `src/pages/dashboard/CurrentlyReadingCard.test.tsx`, `src/components/book/ReadingBento.test.tsx`, `src/pages/library/LibraryOverview.test.tsx`, and `src/lib/readingStateCache.test.ts` verifying:
     - Swiping and clicking `1 / N` chevrons in `CurrentlyReadingCard` cycles through active books.
     - `LibraryOverview` renders all active reads in the swipeable `CurrentlyReadingCard`.
     - Optimistic cache patching immediately adds/updates a book marked `"reading"` in `readingTracker.getShelf` and `book.list` and invalidates all related queries.
2. **Lint & Build Verification:**
   - Run `lint_applet` (`gts lint`) and `compile_applet` to ensure zero TypeScript or style errors.
