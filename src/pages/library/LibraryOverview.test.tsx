import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {LibraryOverview} from './LibraryOverview';
import {Library, Book} from '../../types';

describe('LibraryOverview - Three-Tier Information Hierarchy', () => {
  const mockLibrary: Library = {
    id: 'lib-1',
    name: 'Philosophy & Fiction',
    ownerId: 'u1',
    ownerName: 'Jordan',
    createdAt: '2024-01-01',
    access: {'jordan@test.com': 'owner'},
  };

  const mockUser = {
    uid: 'u1',
    email: 'jordan@test.com',
  } as unknown as import('firebase/auth').User;

  const mockBooks: Book[] = [
    {
      id: 'b1',
      title: 'Klara and the Sun',
      author: 'Kazuo Ishiguro',
      libraryId: 'lib-1',
      primaryGenre: 'Science Fiction',
      subgenres: ['Literary Sci-Fi'],
      status: 'reading',
      userStatuses: {u1: 'reading'},
      addedAt: '2024-01-01',
      coverUrl: 'https://example.com/klara.jpg',
    },
    {
      id: 'b2',
      title: 'Meditations',
      author: 'Marcus Aurelius',
      libraryId: 'lib-1',
      primaryGenre: 'Philosophy',
      subgenres: ['Ancient & Classical'],
      status: 'completed',
      userStatuses: {u1: 'completed'},
      addedAt: '2024-01-02',
      coverUrl: 'https://example.com/meditations.jpg',
    },
  ];

  const defaultProps = {
    books: mockBooks,
    library: mockLibrary,
    user: mockUser,
    pickOfTheDay: {
      title: 'Neuromancer',
      author: 'William Gibson',
      reason: 'The seminal cyberpunk vision that defined digital space.',
    },
    isGeneratingPick: false,
    generateNewPick: vi.fn(),
    setCurrentTab: vi.fn(),
    setFilterGenre: vi.fn(),
    setIsFiltersOpen: vi.fn(),
    selectGenreAndGoToCollection: vi.fn(),
    pickError: null,
  };

  it('renders Tier 1, Tier 2, and Tier 3 in strict hierarchical DOM order', () => {
    const {container} = render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    const sections = Array.from(container.querySelectorAll('section'));
    const sectionLabels = sections.map(s => s.getAttribute('aria-label'));

    // Expected order:
    // 0: Library Overview Digest Ribbon
    // 1: Tier 1 - Reading Pulse and Categories
    // 2: Tier 2 - Recent Acquisitions (On the Shelves)
    // 3: Tier 3 - Explore Collection Visualizers (Timeline, World Map, Constellation)
    expect(sectionLabels).toEqual([
      'Library Overview Digest',
      'Reading Pulse and Categories',
      'Recent Acquisitions',
      'Explore Collection Visualizers',
    ]);
  });

  it('shows Reading Pulse in Tier 1 when a volume is actively being read', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Reading Pulse')).toBeInTheDocument();
    expect(screen.getByText('Currently Reading')).toBeInTheDocument();
    expect(
      screen.getAllByText('Klara And The Sun').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        /The seminal cyberpunk vision that defined digital space/i,
      ),
    ).toBeInTheDocument();
  });

  it('shows Curator Spotlight in Tier 1 when no volumes are in progress', () => {
    const noReadingBooks = mockBooks.map(b => ({
      ...b,
      status: 'completed' as const,
      userStatuses: {u1: 'completed' as const},
    }));
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} books={noReadingBooks} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Curator's Spotlight")).toBeInTheDocument();
  });

  it('renders On the Shelves (Tier 2) with recent book covers and browse link', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText('On the Shelves')).toBeInTheDocument();
    expect(screen.getByText('Browse All 2 Books')).toBeInTheDocument();
    expect(screen.getByText('Meditations')).toBeInTheDocument();
  });

  it('renders Explore The Collection (Tier 3) with Timeline, World Map, and Constellation links', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Explore The Collection')).toBeInTheDocument();
    expect(screen.getByText('Historical Timeline')).toBeInTheDocument();
    expect(screen.getByText('Literary World Map')).toBeInTheDocument();
    expect(screen.getByText('Thematic Constellations')).toBeInTheDocument();
  });
});
