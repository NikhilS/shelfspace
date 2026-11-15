import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  navigateWithCoverTransition,
  prepareReturnWithCoverTransition,
} from './bookCoverTransition';
import {useCoverTransitionStore} from '../stores/coverTransitionStore';

vi.mock('./routePreload', () => ({
  preloadRouteChunk: vi.fn(),
}));

describe('bookCoverTransition', () => {
  beforeEach(() => {
    useCoverTransitionStore.getState().resetCoverTransitions();
    Object.defineProperty(window, 'scrollY', {
      value: 480,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('arms cover transition, saves scrollY, and navigates with expected state', () => {
    const mockNavigate = vi.fn();

    navigateWithCoverTransition({
      navigate: mockNavigate,
      libraryId: 'lib-1',
      bookId: 'book-9',
      originSurface: 'library-grid',
      fromRouteKey: '/library/lib-1/collection',
      bookList: ['book-8', 'book-9', 'book-10'],
      coverPreview: {
        title: 'Invisible Cities',
        author: 'Italo Calvino',
      },
    });

    const state = useCoverTransitionStore.getState();
    expect(state.activeTransition?.libraryId).toBe('lib-1');
    expect(state.activeTransition?.bookId).toBe('book-9');
    expect(state.activeTransition?.originSurface).toBe('library-grid');
    expect(state.activeTransition?.phase).toBe('to-detail');
    expect(state.peekRouteScrollOffset('/library/lib-1/collection')).toBe(480);

    expect(mockNavigate).toHaveBeenCalledWith('/library/lib-1/book/book-9', {
      state: {
        from: '/library/lib-1/collection',
        bookList: ['book-8', 'book-9', 'book-10'],
      },
    });
  });

  it('omits empty bookList from navigation state and arms reverse flight on return', () => {
    const mockNavigate = vi.fn();

    navigateWithCoverTransition({
      navigate: mockNavigate,
      libraryId: 'lib-2',
      bookId: 'unread-1',
      originSurface: 'curator-pick',
      fromRouteKey: '/',
      coverPreview: {
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
      },
    });

    expect(mockNavigate).toHaveBeenCalledWith('/library/lib-2/book/unread-1', {
      state: {from: '/'},
    });

    prepareReturnWithCoverTransition();
    expect(useCoverTransitionStore.getState().activeTransition?.phase).toBe(
      'to-shelf',
    );
  });

  it('skips FLIP layoutId arming while still saving scroll offset under prefers-reduced-motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const mockNavigate = vi.fn();
    navigateWithCoverTransition({
      navigate: mockNavigate,
      libraryId: 'lib-1',
      bookId: 'book-1',
      originSurface: 'library-grid',
      fromRouteKey: '/library/lib-1',
      coverPreview: {
        title: 'Test',
        author: 'Author',
      },
    });

    const state = useCoverTransitionStore.getState();
    expect(state.activeTransition).toBeNull();
    expect(state.peekRouteScrollOffset('/library/lib-1')).toBe(480);
  });
});
