import React from 'react';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {render, screen, act} from '@testing-library/react';
import {SharedCoverFrame} from './SharedCoverFrame';
import {useCoverTransitionStore} from '../../stores/coverTransitionStore';

describe('SharedCoverFrame', () => {
  beforeEach(() => {
    useCoverTransitionStore.getState().resetCoverTransitions();
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

  it('renders a standard div with no elevation override when inactive and upgrades when armed', () => {
    render(
      <SharedCoverFrame
        surface="library-grid"
        libraryId="lib-1"
        bookId="book-1"
        data-testid="cover-slot"
        className="aspect-[2/3]"
      >
        <span>Cover Child</span>
      </SharedCoverFrame>,
    );

    const idleNode = screen.getByTestId('cover-slot');
    expect(idleNode.textContent).toBe('Cover Child');
    expect(idleNode.style.zIndex).toBe('');

    act(() => {
      useCoverTransitionStore.getState().armCoverTransition({
        libraryId: 'lib-1',
        bookId: 'book-1',
        originSurface: 'library-grid',
        originRouteKey: '/library/lib-1/collection',
        coverPreview: {
          title: 'Book One',
          author: 'Author One',
        },
      });
    });

    const activeNode = screen.getByTestId('cover-slot');
    expect(activeNode.style.zIndex).toBe('30');
  });
});
