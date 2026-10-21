import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ReadStackCanvasCard} from './ReadStackCanvasCard';
import type {TrackedBookItem} from '../../server/services/readingTracker';

const mockFinishedBooks: TrackedBookItem[] = [
  {
    id: 'b-1',
    libraryId: 'lib-1',
    libraryName: 'Sterling Place',
    isVirtual: false,
    ownershipStatus: 'owned',
    readingStatus: 'finished',
    title: 'Paris To The Moon',
    author: 'Adam Gopnik',
    userRating: 5,
    addedAt: '2026-01-05',
  },
  {
    id: 'b-2',
    libraryId: 'lib-1',
    libraryName: 'Sterling Place',
    isVirtual: false,
    ownershipStatus: 'owned',
    readingStatus: 'finished',
    title: 'Ninefox Gambit',
    author: 'Yoon Ha Lee',
    userRating: 4,
    addedAt: '2026-01-04',
  },
  {
    id: 'b-3',
    libraryId: 'virtual_u1',
    libraryName: 'Personal Reading Shelf',
    isVirtual: true,
    ownershipStatus: 'unowned',
    readingStatus: 'finished',
    title: 'Vicious',
    author: 'V.E. Schwab',
    addedAt: '2026-01-03',
  },
];

describe('ReadStackCanvasCard', () => {
  it('cycles through the stacked books when clicking Next / Previous stepper controls and on swipe', () => {
    render(
      <MemoryRouter>
        <ReadStackCanvasCard
          finishedBooks={mockFinishedBooks}
          onOpenAllRead={vi.fn()}
          onTrackBook={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Most Recent Read')).toBeInTheDocument();
    expect(screen.getByText('Paris To The Moon')).toBeInTheDocument();

    // Tap Next button in the stepper
    fireEvent.click(screen.getByLabelText('Next book in stack'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('#2 in Recent Stack')).toBeInTheDocument();
    expect(screen.getByText('Ninefox Gambit')).toBeInTheDocument();

    // Swipe left on the canvas to advance to #3
    const canvas = screen.getByLabelText(
      /Interactive stack of your last 3 finished books/i,
    );
    fireEvent.touchStart(canvas, {touches: [{clientX: 220, clientY: 100}]});
    fireEvent.touchEnd(canvas, {
      changedTouches: [{clientX: 120, clientY: 102}],
    });

    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('Vicious')).toBeInTheDocument();
  });
});
