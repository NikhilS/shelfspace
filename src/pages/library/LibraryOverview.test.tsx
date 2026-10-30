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
      readingStatus: 'reading',
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
      readingStatus: 'completed',
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
    // 0: Tier 1 - Reading Pulse and Categories
    // 1: Tier 2 - Recent Acquisitions (On the Shelves)
    // 2: Tier 3 - Explore Collection Visualizers (Timeline, World Map, Constellation)
    expect(sectionLabels).toEqual([
      'Reading Pulse and Categories',
      'Recent Acquisitions',
      'Explore Collection Visualizers',
    ]);
  });

  it('shows Reading Pulse in Tier 1 with Currently Reading above Top Categories when a volume is actively being read', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Reading Pulse')).toBeInTheDocument();
    const currentlyReadingCard = screen.getByTestId('currently-reading-card');
    const topCategoriesHeading = screen.getByText('Top Categories');
    expect(currentlyReadingCard).toBeInTheDocument();
    expect(topCategoriesHeading).toBeInTheDocument();
    expect(
      currentlyReadingCard.compareDocumentPosition(topCategoriesHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
      readingStatus: 'completed' as const,
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

  it('renders Explore The Collection (Tier 3) with Timeline, World Map, Constellation, and Have You Read It? links', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Explore The Collection')).toBeInTheDocument();
    expect(screen.getByText('Historical Timeline')).toBeInTheDocument();
    expect(screen.getByText('Literary World Map')).toBeInTheDocument();
    expect(screen.getByText('Thematic Constellations')).toBeInTheDocument();
    expect(screen.getByText('Have You Read It?')).toBeInTheDocument();
    expect(screen.getByText('1 Unread')).toBeInTheDocument();
  });

  it('renders the unified swipeable CurrentlyReadingCard when multiple books in the library are being read', () => {
    const setCurrentTab = vi.fn();
    const multiReadingBooks: Book[] = [
      ...mockBooks,
      {
        id: 'b3',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        libraryId: 'lib-1',
        primaryGenre: 'Science Fiction',
        readingStatus: 'reading',
        addedAt: '2024-01-03',
      },
      {
        id: 'b4',
        title: 'Invisible Cities',
        author: 'Italo Calvino',
        libraryId: 'lib-1',
        primaryGenre: 'Fiction',
        readingStatus: 'reading',
        addedAt: '2024-01-04',
      },
    ];

    render(
      <MemoryRouter>
        <LibraryOverview
          {...defaultProps}
          books={multiReadingBooks}
          setCurrentTab={setCurrentTab}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('3 Active')).toBeInTheDocument();
    expect(screen.getByTestId('book-swipe-deck')).toBeInTheDocument();
    expect(
      screen.getByTestId('currently-reading-step-indicator'),
    ).toHaveTextContent('1 / 3');
    // Redundant library provenance label is hidden inside LibraryOverview
    expect(
      screen.queryByText(/In Philosophy & Fiction/i),
    ).not.toBeInTheDocument();

    // View All switches to the library's collection tab
    const viewAllBtn = screen.getByTestId('currently-reading-view-all');
    expect(viewAllBtn).toHaveTextContent('View All (3)');
    viewAllBtn.click();
    expect(setCurrentTab).toHaveBeenCalledWith('collection');
  });

  it('renders the warm empty state with BookshelfBookendsIllustration and single CTA when library has 0 books', () => {
    render(
      <MemoryRouter>
        <LibraryOverview {...defaultProps} books={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Ready for Its First Book')).toBeInTheDocument();
    expect(screen.getByText('Add Your First Book')).toBeInTheDocument();
    expect(screen.queryByText('Browse Empty Shelves')).not.toBeInTheDocument();
  });
});
