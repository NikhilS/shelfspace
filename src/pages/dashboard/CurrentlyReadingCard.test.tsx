import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {CurrentlyReadingCard} from './CurrentlyReadingCard';
import type {TrackedBookItem} from '../../server/services/readingTracker';

const SAMPLE_BOOKS: TrackedBookItem[] = [
  {
    id: 'b1',
    libraryId: 'lib-1',
    libraryName: 'Main Study',
    isVirtual: false,
    ownershipStatus: 'owned',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    readingStatus: 'reading',
    primaryGenre: 'Fantasy',
    synopsis: 'Piranesi lives in the House.',
  },
  {
    id: 'b2',
    libraryId: 'lib-1',
    libraryName: 'Main Study',
    isVirtual: false,
    ownershipStatus: 'owned',
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    readingStatus: 'reading',
    primaryGenre: 'Fiction',
    synopsis: 'Marco Polo describes impossible cities to Kublai Khan.',
  },
  {
    id: 'b3',
    libraryId: 'lib-2',
    libraryName: 'Nightstand',
    isVirtual: true,
    ownershipStatus: 'unowned',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    readingStatus: 'reading',
    primaryGenre: 'Science Fiction',
  },
];

describe('CurrentlyReadingCard', () => {
  it('renders empty state when no books are currently being read', () => {
    const onTrackBook = vi.fn();
    render(
      <MemoryRouter>
        <CurrentlyReadingCard
          readingBooks={[]}
          onTrackBook={onTrackBook}
          onStatusChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Nothing Open on the Nightstand'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Start Reading a Book'));
    expect(onTrackBook).toHaveBeenCalledTimes(1);
  });

  it('renders a single book without stepper or swipe deck when only 1 book is active', () => {
    render(
      <MemoryRouter>
        <CurrentlyReadingCard
          readingBooks={[SAMPLE_BOOKS[0]]}
          onStatusChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 Active')).toBeInTheDocument();
    expect(screen.getByText('Piranesi')).toBeInTheDocument();
    expect(
      screen.queryByTestId('currently-reading-stepper'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('book-swipe-deck')).not.toBeInTheDocument();
  });

  it('mounts BookSwipeDeck and compact stepper (1 / N) without bottom title pills when multiple books are active', () => {
    // Use reduced motion in test so slide transitions commit synchronously
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <MemoryRouter>
        <CurrentlyReadingCard
          readingBooks={SAMPLE_BOOKS}
          onStatusChange={vi.fn()}
          onOpenReadingLists={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('3 Active')).toBeInTheDocument();
    expect(screen.getByTestId('book-swipe-deck')).toBeInTheDocument();
    expect(screen.queryByText(/Also Reading:/i)).not.toBeInTheDocument();
    expect(
      screen.getByTestId('currently-reading-step-indicator'),
    ).toHaveTextContent('1 / 3');

    const prevBtn = screen.getByTestId('currently-reading-prev');
    const nextBtn = screen.getByTestId('currently-reading-next');
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    // Step forward to 2 / 3
    fireEvent.click(nextBtn);
    expect(
      screen.getByTestId('currently-reading-step-indicator'),
    ).toHaveTextContent('2 / 3');

    // Step forward to 3 / 3
    fireEvent.click(nextBtn);
    expect(
      screen.getByTestId('currently-reading-step-indicator'),
    ).toHaveTextContent('3 / 3');
    expect(nextBtn).toBeDisabled();

    // Step backward to 2 / 3
    fireEvent.click(prevBtn);
    expect(
      screen.getByTestId('currently-reading-step-indicator'),
    ).toHaveTextContent('2 / 3');

    vi.restoreAllMocks();
  });
});
