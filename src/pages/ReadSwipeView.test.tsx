import React from 'react';
import {describe, expect, it, vi, beforeEach} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {ReadSwipeView} from './ReadSwipeView';
import type {Book} from '../types';

const mockUpdateStatusMutate = vi.fn().mockResolvedValue({success: true});
const mockRecordReviewMutate = vi.fn().mockResolvedValue({
  success: true,
  reviewedAt: '2026-10-24T12:00:00.000Z',
});
const mockGetDetailsChunkMutate = vi.fn().mockResolvedValue({details: {}});
const mockSetListData = vi.fn();
const mockSetGetData = vi.fn();
const mockInvalidateShelf = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'user-123', email: 'reader@example.com'},
  }),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

const mockUseLibraryData = vi.fn();
vi.mock('../hooks/useLibraryData', () => ({
  useLibraryData: (...args: unknown[]) => mockUseLibraryData(...args),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {setData: mockSetListData},
        get: {setData: mockSetGetData},
      },
      readingTracker: {
        getShelf: {invalidate: mockInvalidateShelf},
      },
    }),
  },
  trpcVanilla: {
    book: {
      updateStatus: {
        mutate: (...args: unknown[]) => mockUpdateStatusMutate(...args),
      },
      recordReadSwipeReview: {
        mutate: (...args: unknown[]) => mockRecordReviewMutate(...args),
      },
      getBookDetailsChunk: {
        mutate: (...args: unknown[]) => mockGetDetailsChunkMutate(...args),
      },
    },
  },
}));

const SAMPLE_BOOKS: Book[] = [
  {
    id: 'book-unread-1',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    primaryGenre: 'Science Fiction',
    publishedDate: '1969',
    synopsis: 'An envoy visits the winter planet of Gethen.',
    addedAt: '2026-01-01',
  },
  {
    id: 'book-reading-2',
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    primaryGenre: 'Literary Fiction',
    publishedDate: '1972',
    readingStatus: 'reading',
    addedAt: '2026-01-02',
  },
  {
    id: 'book-finished-3',
    title: 'Already Read Book',
    author: 'Author Three',
    readingStatus: 'finished',
    addedAt: '2026-01-03',
  },
  {
    id: 'book-abandoned-4',
    title: 'Abandoned Book',
    author: 'Author Four',
    readingStatus: 'abandoned',
    addedAt: '2026-01-04',
  },
];

function renderReadSwipeView() {
  return render(
    <MemoryRouter initialEntries={['/library/lib-1/swipe']}>
      <Routes>
        <Route path="/library/:id/swipe" element={<ReadSwipeView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReadSwipeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLibraryData.mockReturnValue({
      library: {id: 'lib-1', name: 'Home Archive'},
      books: SAMPLE_BOOKS,
      isLoading: false,
      isBooksLoading: false,
    });
  });

  it('excludes finished and abandoned books from the eligible pool and renders rich card details', () => {
    renderReadSwipeView();

    const stats = screen.getByTestId('swipe-session-stats');
    expect(stats).toHaveTextContent('2 Remaining');
    expect(stats).toHaveTextContent('0 Reviewed');
    expect(stats).toHaveTextContent('0 Marked Read');

    expect(screen.queryByText('Already Read Book')).not.toBeInTheDocument();
    expect(screen.queryByText('Abandoned Book')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-swipe-card')).toBeInTheDocument();
  });

  it('marks the active book as read on swipe right (ArrowRight), shows subtle confirmation banner with Undo, and reverts when Undo is clicked', async () => {
    renderReadSwipeView();

    const firstCardTitle =
      screen.getByTestId('active-swipe-card').textContent || '';
    const wasFirstLeftHand = firstCardTitle.includes(
      'The Left Hand Of Darkness',
    );
    const expectedFirstTitle = wasFirstLeftHand
      ? 'The Left Hand Of Darkness'
      : 'Invisible Cities';
    const expectedSecondTitle = wasFirstLeftHand
      ? 'Invisible Cities'
      : 'The Left Hand Of Darkness';

    expect(screen.getByTestId('active-swipe-card')).toHaveTextContent(
      expectedFirstTitle,
    );

    fireEvent.keyDown(window, {key: 'ArrowRight'});

    await waitFor(() => {
      expect(mockUpdateStatusMutate).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib-1',
        status: 'finished',
        recordReadStatusReview: true,
      }),
    );

    expect(screen.getByTestId('read-confirmation-banner')).toHaveTextContent(
      /Marked .* as Read/i,
    );
    const cardsAfterSwipe = screen.getAllByTestId('active-swipe-card');
    expect(cardsAfterSwipe[cardsAfterSwipe.length - 1]).toHaveTextContent(
      expectedSecondTitle,
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '1 Remaining',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '1 Reviewed',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '1 Marked Read',
    );

    // Click Undo in the confirmation banner
    fireEvent.click(screen.getByTestId('undo-swipe-button'));

    await waitFor(() => {
      expect(mockUpdateStatusMutate).toHaveBeenCalledTimes(2);
    });
    expect(mockUpdateStatusMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        libraryId: 'lib-1',
        reviewedAtOverride: null,
      }),
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId('active-swipe-card');
      expect(cards[cards.length - 1]).toHaveTextContent(expectedFirstTitle);
    });
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '2 Remaining',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '0 Reviewed',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '0 Marked Read',
    );
  });

  it('leaves book status unchanged on swipe left (ArrowLeft), shows subtle set-aside banner with Undo, and restores book on Undo', async () => {
    renderReadSwipeView();

    fireEvent.keyDown(window, {key: 'ArrowLeft'});

    expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockRecordReviewMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockRecordReviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib-1',
      }),
    );
    expect(screen.getByTestId('skip-confirmation-banner')).toHaveTextContent(
      /Set .* aside for later/i,
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '1 Remaining',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '1 Reviewed',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '0 Marked Read',
    );

    // Click Undo in the set-aside banner
    fireEvent.click(screen.getByTestId('undo-swipe-button'));

    await waitFor(() => {
      expect(mockRecordReviewMutate).toHaveBeenCalledTimes(2);
    });
    expect(mockRecordReviewMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        libraryId: 'lib-1',
        reviewedAt: null,
      }),
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '2 Remaining',
    );
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '0 Reviewed',
    );
  });

  it('shows the friendly Caught Up state when all unread books were checked within 2 days and lets the user browse them again', () => {
    const recentIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    mockUseLibraryData.mockReturnValue({
      library: {id: 'lib-1', name: 'Home Archive'},
      books: [
        {
          ...SAMPLE_BOOKS[0],
          readStatusReviewedAt: recentIso,
        },
        {
          ...SAMPLE_BOOKS[1],
          readStatusReviewedAt: recentIso,
        },
      ],
      isLoading: false,
      isBooksLoading: false,
    });

    renderReadSwipeView();

    expect(screen.getByTestId('swipe-empty-state')).toBeInTheDocument();
    expect(
      screen.getByText(/You're All Caught Up for Now/i),
    ).toBeInTheDocument();

    const browseAgainBtn = screen.getByRole('button', {
      name: /Browse Them Again/i,
    });
    fireEvent.click(browseAgainBtn);

    expect(screen.getByTestId('active-swipe-card')).toBeInTheDocument();
    expect(screen.getByTestId('swipe-session-stats')).toHaveTextContent(
      '2 Remaining',
    );
  });

  it('renders the All Sorted empty state when all books are already read or abandoned', () => {
    mockUseLibraryData.mockReturnValue({
      library: {id: 'lib-1', name: 'Home Archive'},
      books: SAMPLE_BOOKS.slice(2),
      isLoading: false,
      isBooksLoading: false,
    });

    renderReadSwipeView();

    expect(screen.getByTestId('swipe-empty-state')).toBeInTheDocument();
    expect(
      screen.getByText(/Every Book Is Accounted For/i),
    ).toBeInTheDocument();
  });
});
