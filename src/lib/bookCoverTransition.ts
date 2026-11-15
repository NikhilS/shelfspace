import {flushSync} from 'react-dom';
import type {NavigateFunction} from 'react-router-dom';
import {preloadRouteChunk} from './routePreload';
import {
  prefersReducedMotion,
  useCoverTransitionStore,
  type CoverPreviewSnapshot,
  type CoverSurfaceId,
} from '../stores/coverTransitionStore';

export interface NavigateWithCoverTransitionOptions {
  navigate: NavigateFunction;
  libraryId: string;
  bookId: string;
  originSurface: CoverSurfaceId;
  fromRouteKey: string;
  bookList?: string[];
  coverPreview: CoverPreviewSnapshot;
}

function runFlushSyncSafely(fn: () => void): void {
  if (prefersReducedMotion()) {
    fn();
    return;
  }
  try {
    flushSync(fn);
  } catch {
    fn();
  }
}

/**
 * Arms the originating shelf cover slot with its shared `layoutId` synchronously
 * (recording `window.scrollY`), prewarms the detail route, and navigates to Book Details.
 */
export function navigateWithCoverTransition(
  options: NavigateWithCoverTransitionOptions,
): void {
  const {
    navigate,
    libraryId,
    bookId,
    originSurface,
    fromRouteKey,
    bookList,
    coverPreview,
  } = options;

  preloadRouteChunk('bookDetails');

  const scrollY = typeof window !== 'undefined' ? window.scrollY || 0 : 0;
  const store = useCoverTransitionStore.getState();

  if (prefersReducedMotion()) {
    store.saveRouteScrollOffset(fromRouteKey, scrollY);
    store.completeCoverTransition();
  } else {
    runFlushSyncSafely(() => {
      store.armCoverTransition({
        libraryId,
        bookId,
        originSurface,
        originRouteKey: fromRouteKey,
        scrollY,
        coverPreview,
      });
    });
  }

  void navigate(
    `/library/${encodeURIComponent(libraryId)}/book/${encodeURIComponent(bookId)}`,
    {
      state: {
        from: fromRouteKey,
        ...(bookList && bookList.length > 0 ? {bookList} : {}),
      },
    },
  );
}

/**
 * Arms the reverse cover flight right before returning from Book Details to a shelf route.
 */
export function prepareReturnWithCoverTransition(): void {
  const store = useCoverTransitionStore.getState();
  if (!store.activeTransition) {
    return;
  }
  if (prefersReducedMotion()) {
    store.completeCoverTransition();
    return;
  }
  runFlushSyncSafely(() => {
    store.beginReturnToShelf();
  });
}
