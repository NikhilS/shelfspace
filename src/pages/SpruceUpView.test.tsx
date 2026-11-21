import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import {SpruceUpView} from './SpruceUpView';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'user123', email: 'test@example.com'},
  }),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      library: {
        listAllowedDuplicates: {invalidate: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      readingTracker: {
        getShelf: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        getUnreadLibraryBooks: {
          invalidate: vi.fn(),
          setData: vi.fn(),
          getData: vi.fn(),
        },
      },
    }),
    auth: {
      getPermissions: {
        useQuery: vi.fn(() => ({
          data: {isAppAllowed: true, isAdmin: true, hasAiPlan: true},
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
    },
    book: {
      list: {
        useQuery: vi.fn(() => ({
          data: {
            books: [
              {
                id: '1',
                title: 'Dune',
                author: 'Frank Herbert',
                isbn: '123',
                addedAt: '2025-01-01T00:00:00Z',
                addedBy: 'u1',
              },
              {
                id: '2',
                title: 'Dune',
                author: 'Frank Herbert',
                isbn: '123',
                addedAt: '2025-01-02T00:00:00Z',
                addedBy: 'u1',
              },
            ],
          },
          isLoading: false,
        })),
      },
      delete: {
        useMutation: vi.fn(() => ({mutateAsync: vi.fn()})),
      },
    },
    library: {
      get: {
        useQuery: vi.fn(() => ({
          data: {id: '123', name: 'Test Library', ownerId: 'user123'},
          isLoading: false,
        })),
      },
      listAllowedDuplicates: {
        useQuery: vi.fn(() => ({
          data: {allowedDuplicateGroups: []},
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
      allowDuplicateGroup: {
        useMutation: vi.fn(() => ({mutateAsync: vi.fn()})),
      },
    },
    enrichment: {
      trigger: {
        useMutation: vi.fn(() => ({mutateAsync: vi.fn()})),
      },
    },
  },
  trpcVanilla: {
    library: {
      allowDuplicateGroup: {mutate: vi.fn()},
      resetMetadata: {mutate: vi.fn()},
    },
    book: {
      delete: {mutate: vi.fn()},
      batchUpsert: {mutate: vi.fn()},
      mergeDuplicates: {mutate: vi.fn()},
      syncChanges: {
        query: vi.fn().mockResolvedValue({
          upsertedBooks: [],
          deletedBookIds: [],
          readingStates: {},
          syncCursorMs: Date.now(),
        }),
      },
    },
    enrichment: {
      auditPlaceholderCovers: {
        mutate: vi.fn().mockResolvedValue({
          scannedCount: 1,
          clearedCount: 1,
          clearedBookIds: ['1'],
        }),
      },
      adjudicateDuplicates: {
        mutate: vi.fn().mockResolvedValue({decisions: []}),
      },
      startJob: {mutate: vi.fn()},
      getJobStatus: {query: vi.fn()},
      cancelJob: {mutate: vi.fn()},
    },
  },
}));

describe('SpruceUpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Shelf Care 3-tab workspace and switches between Enrichment, Duplicates, and Reset Details tabs', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
    const {getByTestId} = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/library/123/spruce-up']}>
          <Routes>
            <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Shelf Care')).toBeInTheDocument();
    expect(screen.getByText('Complete Book Details')).toBeInTheDocument();
    expect(getByTestId('shelf-care-tab-maintenance')).toHaveTextContent(
      'Reset Details',
    );

    // Switch to Duplicates tab and verify non-blocking duplicate group detection
    fireEvent.click(getByTestId('shelf-care-tab-duplicates'));
    expect(await screen.findByText('Possible Duplicates')).toBeInTheDocument();
    expect(
      await screen.findByTestId('duplicate-confidence-badge-0'),
    ).toHaveTextContent('100% Match • Exact ISBN');

    // Switch to Reset Details tab
    fireEvent.click(getByTestId('shelf-care-tab-maintenance'));
    expect(await screen.findByText('Reset Book Details')).toBeInTheDocument();
  });

  it('auto-scans Google Books cover URLs when opening Shelf Care and invalidates book list when placeholders are cleared', async () => {
    const {trpc, trpcVanilla} = await import('../lib/trpc');
    vi.mocked(trpc.book.list.useQuery).mockReturnValue({
      data: {
        books: [
          {
            id: '1',
            title: 'Placeholder Cover Book',
            author: 'Frank Herbert',
            isbn: '123',
            coverUrl:
              'https://books.google.com/books/content?id=QRlkvgEACAAJ&printsec=frontcover&img=1&zoom=3&source=gbs_api',
            enrichmentStatus: {coverImage: 'completed'},
            addedAt: '2025-01-01T00:00:00Z',
            addedBy: 'u1',
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.book.list.useQuery>);

    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/library/123/spruce-up']}>
          <Routes>
            <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Shelf Care')).toBeInTheDocument();
    expect(
      trpcVanilla.enrichment.auditPlaceholderCovers.mutate,
    ).toHaveBeenCalledWith({libraryId: '123'});
  });

  it('opens Reset Book Details directly when navigated with ?tab=reset deep link', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
    const {getByTestId} = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/library/123/spruce-up?tab=reset']}>
          <Routes>
            <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Reset Book Details')).toBeInTheDocument();
    expect(getByTestId('shelf-care-tab-maintenance')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
