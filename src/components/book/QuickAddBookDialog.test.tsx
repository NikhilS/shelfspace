import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {QuickAddBookDialog} from './QuickAddBookDialog';
import {useAuth} from '../../stores/authStore';

const mockNavigate = vi.fn();
const mockBatchUpsertMutate = vi.fn().mockResolvedValue({success: true});
const mockSearchUnifiedQuery = vi.fn().mockResolvedValue({
  libraryMatches: [
    {
      bookId: 'existing-lib-book-1',
      libraryId: 'lib123',
      libraryName: 'Living Room Shelf',
      isVirtual: false,
      ownershipStatus: 'owned',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      readingStatus: 'unset',
    },
  ],
  externalMatches: [
    {
      title: 'Piranesi',
      author: 'Susanna Clarke',
      isbn: '9781635575637',
    },
  ],
});
const mockSearchByTitleMutate = vi.fn().mockResolvedValue([
  {
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    isbn: '9780593135204',
  },
]);
const mockTrackBookMutate = vi.fn().mockResolvedValue({success: true});

vi.mock('../../stores/authStore', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as Record<string, unknown>),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {invalidate: vi.fn(), getData: vi.fn()},
      },
      library: {
        list: {invalidate: vi.fn()},
      },
      readingTracker: {
        getShelf: {invalidate: vi.fn()},
      },
    }),
    book: {
      list: {
        useQuery: vi.fn(() => ({
          data: {books: []},
          isLoading: false,
        })),
      },
    },
    readingTracker: {
      getShelf: {
        useQuery: vi.fn(() => ({
          data: {
            items: [],
            counts: {
              all: 0,
              want_to_read: 0,
              reading: 0,
              finished: 0,
              abandoned: 0,
            },
          },
          isLoading: false,
        })),
      },
    },
  },
  trpcVanilla: {
    book: {
      batchUpsert: {
        mutate: (...args: unknown[]) => mockBatchUpsertMutate(...args),
      },
    },
    readingTracker: {
      searchUnified: {
        query: (...args: unknown[]) => mockSearchUnifiedQuery(...args),
      },
      trackBook: {
        mutate: (...args: unknown[]) => mockTrackBookMutate(...args),
      },
    },
    metadata: {
      searchByIsbn: {
        mutate: vi.fn().mockResolvedValue(null),
      },
      searchByTitle: {
        mutate: (...args: unknown[]) => mockSearchByTitleMutate(...args),
      },
    },
  },
}));

describe('QuickAddBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'reader@example.com'},
    });
  });

  it('supports 1-click add as unowned in Reading Mode, closes immediately on add, and links to /reading/add via Advanced', async () => {
    const onClose = vi.fn();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <QuickAddBookDialog
            isOpen={true}
            onClose={onClose}
            mode="reading"
            initialStatus="reading"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('quick-add-context-badge')).toHaveTextContent(
      'Personal Reading Shelf',
    );
    expect(
      screen.getByRole('radio', {name: 'Currently Reading'}),
    ).toHaveAttribute('aria-checked', 'true');

    // Search for a book
    const searchInput = screen.getByPlaceholderText(
      /Search by title, author, or ISBN/i,
    );
    fireEvent.change(searchInput, {target: {value: 'Piranesi'}});
    fireEvent.submit(searchInput.closest('form')!);

    expect(await screen.findByText('Piranesi')).toBeInTheDocument();

    // 1-click add on external result saves as unowned and closes dialog immediately
    const addButtons = screen.getAllByRole('button', {
      name: /Add to Currently Reading/i,
    });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(mockBatchUpsertMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryId: 'virtual_user1',
          operations: [
            expect.objectContaining({
              type: 'create',
              data: expect.objectContaining({
                title: 'Piranesi',
                ownershipStatus: 'unowned',
                status: 'reading',
              }),
            }),
          ],
        }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Clicking Advanced navigates to /reading/add?status=reading
    fireEvent.click(screen.getByTestId('quick-add-advanced-link'));
    expect(mockNavigate).toHaveBeenCalledWith('/reading/add?status=reading');
  });

  it('supports 1-click add as owned in Library Mode, closes immediately on add, and links to /library/:id/add via Advanced', async () => {
    const onClose = vi.fn();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <QuickAddBookDialog
            isOpen={true}
            onClose={onClose}
            mode="library"
            libraryId="lib-42"
            libraryName="Home Study"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('quick-add-context-badge')).toHaveTextContent(
      'Owned · Library Collection',
    );

    const searchInput = screen.getByPlaceholderText(
      /Search by title, author, or ISBN/i,
    );
    fireEvent.change(searchInput, {target: {value: 'Project Hail Mary'}});
    fireEvent.submit(searchInput.closest('form')!);

    expect(await screen.findByText('Project Hail Mary')).toBeInTheDocument();

    const addButtons = screen.getAllByRole('button', {name: /Add/i});
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(mockBatchUpsertMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryId: 'lib-42',
          operations: [
            expect.objectContaining({
              type: 'create',
              data: expect.objectContaining({
                title: 'Project Hail Mary',
                ownershipStatus: 'owned',
              }),
            }),
          ],
        }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('quick-add-advanced-link'));
    expect(mockNavigate).toHaveBeenCalledWith('/library/lib-42/add');
  });
});
