import {create} from 'zustand';

export type CoverSurfaceId =
  | 'library-grid'
  | 'library-table'
  | 'library-recent'
  | 'currently-reading'
  | 'bedside-stack'
  | 'suggested-reads'
  | 'want-to-read'
  | 'reading-shelf-card'
  | 'curator-pick';

export interface CoverPreviewSnapshot {
  title: string;
  author: string;
  coverUrl?: string;
  publishedDate?: string;
  primaryGenre?: string;
  subgenres?: string[];
  series?: string;
  synopsis?: string;
  readingStatus?: string;
  ownershipStatus?: 'owned' | 'unowned';
  format?: 'physical' | 'digital';
  isbn?: string;
}

export interface ActiveCoverTransition {
  libraryId: string;
  bookId: string;
  initialBookId: string;
  originSurface: CoverSurfaceId;
  originRouteKey: string;
  coverPreview: CoverPreviewSnapshot;
  phase: 'to-detail' | 'in-detail' | 'to-shelf';
  startedAtMs: number;
}

export interface ArmCoverTransitionInput {
  libraryId: string;
  bookId: string;
  originSurface: CoverSurfaceId;
  originRouteKey: string;
  scrollY?: number;
  coverPreview: CoverPreviewSnapshot;
}

export interface CoverTransitionState {
  activeTransition: ActiveCoverTransition | null;
  scrollOffsetsByRoute: Record<string, number>;
  isDeckDragging: boolean;
  armCoverTransition: (input: ArmCoverTransitionInput) => void;
  markDetailSettled: () => void;
  syncActiveDetailBook: (
    libraryId: string,
    bookId: string,
    coverPreview?: Partial<CoverPreviewSnapshot>,
  ) => void;
  beginReturnToShelf: () => void;
  completeCoverTransition: () => void;
  setDeckDragging: (isDragging: boolean) => void;
  saveRouteScrollOffset: (routeKey: string, scrollY: number) => void;
  peekRouteScrollOffset: (routeKey: string) => number | undefined;
  consumeRouteScrollOffset: (routeKey: string) => number | undefined;
  resetCoverTransitions: () => void;
}

const MAX_SAVED_SCROLL_ROUTES = 32;

export const ARCHIVAL_COVER_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 36,
  mass: 0.85,
};

export function getSharedCoverLayoutId(
  libraryId: string,
  bookId: string,
): string {
  return `archival-book-cover:${libraryId}:${bookId}`;
}

export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function boundScrollMap(
  current: Record<string, number>,
  routeKey: string,
  scrollY: number,
): Record<string, number> {
  const next: Record<string, number> = {...current};
  delete next[routeKey];
  next[routeKey] = Math.max(0, Math.round(scrollY));

  const keys = Object.keys(next);
  while (keys.length > MAX_SAVED_SCROLL_ROUTES) {
    const oldest = keys.shift();
    if (oldest) {
      delete next[oldest];
    }
  }
  return next;
}

export const useCoverTransitionStore = create<CoverTransitionState>(
  (set, get) => ({
    activeTransition: null,
    scrollOffsetsByRoute: {},
    isDeckDragging: false,

    armCoverTransition(input) {
      const normalizedRouteKey = input.originRouteKey || '/';
      set(state => ({
        activeTransition: {
          libraryId: input.libraryId,
          bookId: input.bookId,
          initialBookId: input.bookId,
          originSurface: input.originSurface,
          originRouteKey: normalizedRouteKey,
          coverPreview: input.coverPreview,
          phase: 'to-detail',
          startedAtMs: Date.now(),
        },
        isDeckDragging: false,
        scrollOffsetsByRoute:
          typeof input.scrollY === 'number'
            ? boundScrollMap(
                state.scrollOffsetsByRoute,
                normalizedRouteKey,
                input.scrollY,
              )
            : state.scrollOffsetsByRoute,
      }));
    },

    markDetailSettled() {
      set(state => {
        if (
          !state.activeTransition ||
          state.activeTransition.phase !== 'to-detail'
        ) {
          return state;
        }
        return {
          activeTransition: {
            ...state.activeTransition,
            phase: 'in-detail',
          },
        };
      });
    },

    syncActiveDetailBook(libraryId, bookId, coverPreview) {
      set(state => {
        if (!state.activeTransition) {
          return state;
        }
        if (
          state.activeTransition.libraryId === libraryId &&
          state.activeTransition.bookId === bookId &&
          !coverPreview
        ) {
          return state;
        }
        return {
          activeTransition: {
            ...state.activeTransition,
            libraryId,
            bookId,
            coverPreview: coverPreview
              ? {
                  ...state.activeTransition.coverPreview,
                  ...coverPreview,
                  title:
                    coverPreview.title ??
                    state.activeTransition.coverPreview.title,
                  author:
                    coverPreview.author ??
                    state.activeTransition.coverPreview.author,
                }
              : state.activeTransition.coverPreview,
          },
        };
      });
    },

    beginReturnToShelf() {
      set(state => {
        if (!state.activeTransition) {
          return {isDeckDragging: false};
        }
        if (
          state.activeTransition.phase === 'to-shelf' &&
          !state.isDeckDragging
        ) {
          return state;
        }
        return {
          isDeckDragging: false,
          activeTransition: {
            ...state.activeTransition,
            phase: 'to-shelf',
            startedAtMs: Date.now(),
          },
        };
      });
    },

    completeCoverTransition() {
      set(state => {
        if (!state.activeTransition && !state.isDeckDragging) {
          return state;
        }
        return {
          activeTransition: null,
          isDeckDragging: false,
        };
      });
    },

    setDeckDragging(isDragging) {
      set(state => {
        if (state.isDeckDragging === isDragging) {
          return state;
        }
        return {isDeckDragging: isDragging};
      });
    },

    saveRouteScrollOffset(routeKey, scrollY) {
      if (!routeKey) {
        return;
      }
      set(state => ({
        scrollOffsetsByRoute: boundScrollMap(
          state.scrollOffsetsByRoute,
          routeKey,
          scrollY,
        ),
      }));
    },

    peekRouteScrollOffset(routeKey) {
      const state = get();
      if (routeKey in state.scrollOffsetsByRoute) {
        return state.scrollOffsetsByRoute[routeKey];
      }
      const pathnameOnly = routeKey.split('?')[0];
      if (pathnameOnly && pathnameOnly in state.scrollOffsetsByRoute) {
        return state.scrollOffsetsByRoute[pathnameOnly];
      }
      return undefined;
    },

    consumeRouteScrollOffset(routeKey) {
      const state = get();
      let matchedKey: string | undefined;
      if (routeKey in state.scrollOffsetsByRoute) {
        matchedKey = routeKey;
      } else {
        const pathnameOnly = routeKey.split('?')[0];
        if (pathnameOnly && pathnameOnly in state.scrollOffsetsByRoute) {
          matchedKey = pathnameOnly;
        }
      }
      if (!matchedKey) {
        return undefined;
      }
      const value = state.scrollOffsetsByRoute[matchedKey];
      set(curr => {
        const next = {...curr.scrollOffsetsByRoute};
        delete next[matchedKey];
        return {scrollOffsetsByRoute: next};
      });
      return value;
    },

    resetCoverTransitions() {
      set({
        activeTransition: null,
        scrollOffsetsByRoute: {},
        isDeckDragging: false,
      });
    },
  }),
);

/**
 * Granular selector returning a shared `layoutId` ONLY for the single active
 * `(surface, libraryId, bookId)` shelf slot. All other shelf items receive `undefined`
 * and experience zero re-renders during transitions.
 */
export function useShelfCoverLayoutId(
  surface: CoverSurfaceId,
  libraryId: string | undefined,
  bookId: string | undefined,
): string | undefined {
  return useCoverTransitionStore(state => {
    const active = state.activeTransition;
    if (
      !active ||
      !libraryId ||
      !bookId ||
      active.originSurface !== surface ||
      active.libraryId !== libraryId ||
      active.bookId !== bookId
    ) {
      return undefined;
    }
    return getSharedCoverLayoutId(active.libraryId, active.bookId);
  });
}
