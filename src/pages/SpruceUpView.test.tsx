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
      book: {list: {invalidate: vi.fn()}},
      library: {listAllowedDuplicates: {invalidate: vi.fn()}},
    }),
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
    },
  },
}));

describe('SpruceUpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Shelf Care 3-tab workspace and switches between Enrichment, Duplicates, and Maintenance tabs', async () => {
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

    // Switch to Duplicates tab and verify non-blocking duplicate group detection
    fireEvent.click(getByTestId('shelf-care-tab-duplicates'));
    expect(await screen.findByText('Possible Duplicates')).toBeInTheDocument();
    expect(
      await screen.findByTestId('duplicate-confidence-badge-0'),
    ).toHaveTextContent('100% Match • Exact ISBN');

    // Switch to Maintenance tab
    fireEvent.click(getByTestId('shelf-care-tab-maintenance'));
    expect(
      await screen.findByText('Optimize Library Storage'),
    ).toBeInTheDocument();
  });
});
