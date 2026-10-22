# Subtle Inline Navbar Offline Indicator Plan

## Goal
Replace the large floating dark toast (`ConnectivityBanner`) that overlaps the top header on mobile viewports with a subtle, inline status indicator (**terracotta-red dot + `"Offline"` label**) placed inside the top navigation bar on the right side next to the user profile avatar across all pages.

## Architectural & Design Changes

### 1. Inline Navbar Status Component (`src/components/layout/ConnectivityBanner.tsx`)
- Replace the `fixed top-4 left-1/2 -translate-x-1/2 z-[100]` floating dark card and `AnimatePresence` overlay with a clean, compact inline status indicator designed to live inside the `h-16` top navigation bar.
- Render nothing (`null`) when `isOnline` is `true` so online sessions have zero visual noise.
- When offline (`!isOnline`), render an inline status element (`role="status"`, `aria-live="polite"`, `data-testid="connectivity-banner"`, `title="Offline — reading from local archive"`) featuring:
  - A terracotta-red indicator dot (`h-2 w-2 rounded-full bg-error shrink-0`).
  - Crisp `"Offline"` label (`text-xs font-sans font-medium text-on-surface-variant leading-none select-none`).
  - Subtle spacing (`inline-flex items-center gap-1.5`) that fits comfortably on both mobile (~390px) and desktop viewports without wrapping or crowding the `book(ish)` wordmark.

### 2. Top Navigation Bar Placement (`src/components/layout/AppLayout.tsx`)
- Move `<ConnectivityBanner />` out of `<main>` and into **Zone 2** (`<div className="flex items-center gap-2.5 sm:gap-4 shrink-0">`) immediately to the left of the user profile button.
- Because `AppLayout` wraps all authenticated routes (`Dashboard`, `LibraryView`, `BookDetailsView`, `TimelineView`, `WorldMap`, `ConstellationMap`, `SpruceUpView`, `AddBookView`), the indicator will appear quietly and consistently across all pages while offline, with zero layout shift.

### 3. Unit Tests (`src/components/layout/ConnectivityBanner.test.tsx` & `src/components/layout/AppLayout.test.tsx`)
- Update `ConnectivityBanner.test.tsx` to assert the new `"Offline"` label and accessible status attributes when offline events fire.
- Add test coverage in `AppLayout.test.tsx` verifying that the inline offline indicator renders inside the top header next to the profile button when `navigator.onLine` is `false`.
