import {describe, it, expect, beforeEach} from 'vitest';
import {renderHook, act} from '@testing-library/react';
import {
  getSharedCoverLayoutId,
  useCoverTransitionStore,
  useShelfCoverLayoutId,
} from './coverTransitionStore';

describe('coverTransitionStore', () => {
  beforeEach(() => {
    useCoverTransitionStore.getState().resetCoverTransitions();
  });

  it('arms a forward transition, isolates layoutId to the originating surface, and tracks scrollY', () => {
    const store = useCoverTransitionStore.getState();

    act(() => {
      store.armCoverTransition({
        libraryId: 'lib-1',
        bookId: 'book-42',
        originSurface: 'library-grid',
        originRouteKey: '/library/lib-1/collection?sort=title',
        scrollY: 640,
        coverPreview: {
          title: 'Piranesi',
          author: 'Susanna Clarke',
          coverUrl: '/covers/piranesi.jpg',
        },
      });
    });

    const active = useCoverTransitionStore.getState().activeTransition;
    expect(active).not.toBeNull();
    expect(active?.phase).toBe('to-detail');
    expect(active?.bookId).toBe('book-42');
    expect(active?.initialBookId).toBe('book-42');
    expect(
      useCoverTransitionStore
        .getState()
        .peekRouteScrollOffset('/library/lib-1/collection?sort=title'),
    ).toBe(640);

    const matchingHook = renderHook(() =>
      useShelfCoverLayoutId('library-grid', 'lib-1', 'book-42'),
    );
    const otherSurfaceHook = renderHook(() =>
      useShelfCoverLayoutId('currently-reading', 'lib-1', 'book-42'),
    );
    const otherBookHook = renderHook(() =>
      useShelfCoverLayoutId('library-grid', 'lib-1', 'book-99'),
    );

    expect(matchingHook.result.current).toBe(
      getSharedCoverLayoutId('lib-1', 'book-42'),
    );
    expect(otherSurfaceHook.result.current).toBeUndefined();
    expect(otherBookHook.result.current).toBeUndefined();
  });

  it('updates the active book on swipe commit while preserving initialBookId for reverse return', () => {
    const store = useCoverTransitionStore.getState();

    act(() => {
      store.armCoverTransition({
        libraryId: 'lib-1',
        bookId: 'book-1',
        originSurface: 'library-table',
        originRouteKey: '/library/lib-1/collection',
        scrollY: 320,
        coverPreview: {
          title: 'Book One',
          author: 'Author One',
        },
      });
      store.markDetailSettled();
    });

    expect(useCoverTransitionStore.getState().activeTransition?.phase).toBe(
      'in-detail',
    );

    act(() => {
      store.syncActiveDetailBook('lib-1', 'book-5', {
        title: 'Book Five',
        author: 'Author Five',
      });
    });

    const afterSwipe = useCoverTransitionStore.getState().activeTransition;
    expect(afterSwipe?.bookId).toBe('book-5');
    expect(afterSwipe?.initialBookId).toBe('book-1');
    expect(afterSwipe?.coverPreview.title).toBe('Book Five');

    act(() => {
      store.beginReturnToShelf();
    });

    expect(useCoverTransitionStore.getState().activeTransition?.phase).toBe(
      'to-shelf',
    );

    const swipedTargetHook = renderHook(() =>
      useShelfCoverLayoutId('library-table', 'lib-1', 'book-5'),
    );
    expect(swipedTargetHook.result.current).toBe(
      getSharedCoverLayoutId('lib-1', 'book-5'),
    );

    act(() => {
      store.completeCoverTransition();
    });
    expect(useCoverTransitionStore.getState().activeTransition).toBeNull();
  });

  it('bounds saved scroll routes to 32 entries and consumes matched route offsets', () => {
    const store = useCoverTransitionStore.getState();

    act(() => {
      for (let i = 0; i < 40; i++) {
        store.saveRouteScrollOffset(`/library/lib-${i}`, i * 10);
      }
    });

    const keys = Object.keys(
      useCoverTransitionStore.getState().scrollOffsetsByRoute,
    );
    expect(keys.length).toBe(32);
    expect(store.peekRouteScrollOffset('/library/lib-0')).toBeUndefined();
    expect(store.consumeRouteScrollOffset('/library/lib-39')).toBe(390);
    expect(store.peekRouteScrollOffset('/library/lib-39')).toBeUndefined();
  });
});
