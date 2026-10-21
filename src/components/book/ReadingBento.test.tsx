import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ReadingBento} from './ReadingBento';
import type {TrackedBookItem} from '../../server/services/readingTracker';

vi.mock('../../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'u1', email: 'reader@example.com'},
  }),
}));

vi.mock('../../pages/dashboard/useReadingShelf', () => ({
  useReadingShelf: () => ({
    allItems: [],
    counts: {all: 0, want_to_read: 0, reading: 0, finished: 0, abandoned: 0},
    isLoading: false,
    updateItemStatus: vi.fn(),
    trackBookItem: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePickOfTheDay', () => ({
  usePickOfTheDay: () => ({
    pickOfTheDay: {
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      reason: 'Matches your love of speculative worlds.',
    },
    isGeneratingPick: false,
    generateNewPick: vi.fn(),
    error: null,
  }),
}));

const sampleBooks: TrackedBookItem[] = [
  {
    id: 'b-lib1-reading',
    libraryId: 'lib-1',
    libraryName: 'Sterling Place',
    isVirtual: false,
    ownershipStatus: 'owned',
    readingStatus: 'reading',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    primaryGenre: 'Science Fiction',
    addedAt: '2026-01-01',
  },
  {
    id: 'b-virtual-finished',
    libraryId: 'virtual_u1',
    libraryName: 'Personal Reading Shelf',
    isVirtual: true,
    ownershipStatus: 'unowned',
    readingStatus: 'finished',
    userRating: 5,
    title: 'Piranesi',
    author: 'Susanna Clarke',
    primaryGenre: 'Fantasy',
    addedAt: '2026-01-02',
  },
  {
    id: 'b-lib1-finished',
    libraryId: 'lib-1',
    libraryName: 'Sterling Place',
    isVirtual: false,
    ownershipStatus: 'owned',
    readingStatus: 'finished',
    userRating: 4,
    title: 'Dune',
    author: 'Frank Herbert',
    primaryGenre: 'Science Fiction',
    addedAt: '2026-01-03',
  },
];

describe('ReadingBento', () => {
  it('renders consolidated Read + Currently Reading books in personal-reading mode', () => {
    render(
      <MemoryRouter>
        <ReadingBento mode="personal-reading" books={sampleBooks} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('reading-bento-personal-reading'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Project Hail Mary').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Last 2 Read')).toBeInTheDocument();
    expect(screen.getByText('2 volumes read')).toBeInTheDocument();
    expect(screen.getByText('Explore Your Reading')).toBeInTheDocument();

    const timelineLink = screen.getByText('Historical Timeline').closest('a');
    expect(timelineLink).toHaveAttribute('href', '/reading/timeline');
  });

  it('scopes displayed books and exploratory links to a specific library when libraryId is provided', () => {
    render(
      <MemoryRouter>
        <ReadingBento libraryId="lib-1" books={sampleBooks} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('reading-bento-library-lib-1'),
    ).toBeInTheDocument();
    // Only lib-1 books ('Project Hail Mary' and 'Dune') are included; 'Piranesi' (virtual_u1) is excluded
    expect(
      screen.getAllByText('Project Hail Mary').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Last 1 Read')).toBeInTheDocument();
    expect(screen.getByText('1 volume read')).toBeInTheDocument();
    expect(screen.queryByText('Piranesi')).not.toBeInTheDocument();
    expect(screen.getByText('Explore Library Reading')).toBeInTheDocument();

    const timelineLink = screen.getByText('Historical Timeline').closest('a');
    expect(timelineLink).toHaveAttribute('href', '/library/lib-1/timeline');
  });
});
