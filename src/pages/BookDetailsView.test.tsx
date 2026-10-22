import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {BookDetailsView} from './BookDetailsView';
import {getRouteBoundaryKey} from '../components/layout/ScrollToTop';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Book} from '../types';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const mockBooksList: Book[] = [
  {
    id: 'b-1',
    libraryId: '123',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    primaryGenre: 'Science Fiction',
    subgenres: ['Anthropological Sci-Fi'],
    addedAt: '2026-01-01',
    synopsis: 'A lone human emissary to Winter.',
  },
  {
    id: 'b-2',
    libraryId: '123',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    primaryGenre: 'Fantasy',
    subgenres: ['Mythic Fiction'],
    addedAt: '2026-01-02',
    synopsis: 'Piranesi lives in the House of infinite halls.',
  },
  {
    id: 'b-3',
    libraryId: '123',
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    primaryGenre: 'Literary Fiction',
    subgenres: ['Fable'],
    addedAt: '2026-01-03',
    synopsis: 'Marco Polo describes fifty-five cities to Kublai Khan.',
  },
  {
    id: 'b-4',
    libraryId: '123',
    title: 'Solaris',
    author: 'Stanislaw Lem',
    primaryGenre: 'Science Fiction',
    subgenres: ['First Contact'],
    addedAt: '2026-01-04',
  },
  {
    id: 'b-5',
    libraryId: '123',
    title: 'Roadside Picnic',
    author: 'Arkady & Boris Strugatsky',
    primaryGenre: 'Science Fiction',
    subgenres: ['Zone Fiction'],
    addedAt: '2026-01-05',
  },
];

const mockGetListData = vi.fn<() => Book[] | undefined>(() => undefined);
const mockGetBookData = vi.fn<
  (input: {libraryId: string; bookId: string}) => Book | undefined
>(() => undefined);
const mockPrefetchBook = vi.fn(() => Promise.resolve());
const mockBookGetUseQuery = vi.fn<
  (
    input: {libraryId: string; bookId: string},
    opts?: {enabled?: boolean; initialData?: () => Book | undefined},
  ) => {data: Book | null | undefined; isLoading: boolean}
>(() => ({
  data: null,
  isLoading: true,
}));
const mockListReviewsUseQuery = vi.fn<
  (
    input: {libraryId: string; bookId: string},
    opts?: {enabled?: boolean},
  ) => {data: unknown[]; isLoading: boolean}
>(() => ({
  data: [],
  isLoading: false,
}));

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: {uid: 'u1'}, logOut: vi.fn()}),
}));

vi.mock('../hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({
    isAppAllowed: true,
    isAdmin: false,
    hasAiPlan: true,
    isLoadingPermissions: false,
    refetchPermissions: vi.fn(),
  }),
}));

vi.mock('../firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
      uid: 'u1',
    },
  },
  handleFirestoreError: vi.fn(),
  OperationType: {},
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {
          invalidate: vi.fn(),
          setData: vi.fn(),
          getData: () => mockGetListData(),
        },
        get: {
          invalidate: vi.fn(),
          setData: vi.fn(),
          getData: (input: {libraryId: string; bookId: string}) =>
            mockGetBookData(input),
          prefetch: () => mockPrefetchBook(),
        },
      },
      library: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
    }),
    gemini: {
      generateBookInsights: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
    },
    library: {
      get: {
        useQuery: vi.fn(() => ({
          data: {
            id: '123',
            name: 'Test Library',
            ownerId: 'u1',
            callerRole: 'owner',
          },
          isLoading: false,
        })),
      },
      getPermissions: {
        useQuery: vi.fn(() => ({
          data: {
            role: 'owner',
            canEdit: true,
          },
          isLoading: false,
        })),
      },
    },
    book: {
      get: {
        useQuery: (
          input: {libraryId: string; bookId: string},
          opts?: {enabled?: boolean; initialData?: () => Book | undefined},
        ) => mockBookGetUseQuery(input, opts),
      },
      listReviews: {
        useQuery: (
          input: {libraryId: string; bookId: string},
          opts?: {enabled?: boolean},
        ) => mockListReviewsUseQuery(input, opts),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
      addReview: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
      deleteReview: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
    },
  },
  trpcVanilla: {
    enrichment: {
      trigger: {
        mutate: vi.fn().mockResolvedValue({processedCount: 1}),
      },
    },
  },
}));

describe('BookDetailsView & 3-Slot BookSwipeDeck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetListData.mockReturnValue(undefined);
    mockGetBookData.mockReturnValue(undefined);
    mockBookGetUseQuery.mockReturnValue({data: null, isLoading: true});
    mockListReviewsUseQuery.mockReturnValue({data: [], isLoading: false});

    // Enable prefers-reduced-motion in JSDOM tests for deterministic synchronous commits
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
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

  it('renders loading state initially when cache is cold', () => {
    const testQueryClient = createTestQueryClient();
    const {container} = render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/123/book/456']}>
          <Routes>
            <Route
              path="/library/:libraryId/book/:bookId"
              element={<BookDetailsView />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('normalizes route boundary keys so swiping between books never remounts the view', () => {
    expect(getRouteBoundaryKey('/library/lib-1/book/book-a')).toBe(
      '/library/lib-1/book',
    );
    expect(getRouteBoundaryKey('/library/lib-1/book/book-b')).toBe(
      '/library/lib-1/book',
    );
    expect(getRouteBoundaryKey('/library/lib-2/book/book-a')).toBe(
      '/library/lib-2/book',
    );
    expect(getRouteBoundaryKey('/library/lib-1/collection')).toBe(
      '/library/lib-1/collection',
    );
  });

  it('mounts a constant O(1) 3-slot window (prev, active, next) and gates reviews/insights to the active slot', () => {
    mockGetListData.mockReturnValue(mockBooksList);
    mockBookGetUseQuery.mockImplementation((input, opts) => ({
      data:
        opts?.initialData?.() ||
        mockBooksList.find(b => b.id === input.bookId) ||
        null,
      isLoading: false,
    }));

    const testQueryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/123/book/b-2']}>
          <Routes>
            <Route
              path="/library/:libraryId/book/:bookId"
              element={<BookDetailsView />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Even though the library has 5 books, strictly 3 slots (-1, 0, +1) are mounted in the DOM
    expect(screen.getByTestId('book-swipe-slot--1')).toHaveAttribute(
      'data-book-id',
      'b-1',
    );
    expect(screen.getByTestId('book-swipe-slot-0')).toHaveAttribute(
      'data-book-id',
      'b-2',
    );
    expect(screen.getByTestId('book-swipe-slot-1')).toHaveAttribute(
      'data-book-id',
      'b-3',
    );
    expect(screen.getByTestId('book-deck-counter')).toHaveTextContent('2 of 5');

    // Verify listReviews is enabled ONLY for the active slot (b-2) and disabled for flanking slots (b-1, b-3)
    const enabledReviewCalls = mockListReviewsUseQuery.mock.calls.filter(
      call => call[1]?.enabled === true,
    );
    expect(enabledReviewCalls.map(c => c[0].bookId)).toEqual(['b-2']);
  });

  it('advances and retreats through books via touch swipe gestures, keyboard arrows, and chevron buttons', async () => {
    mockGetListData.mockReturnValue(mockBooksList);
    mockBookGetUseQuery.mockImplementation((input, opts) => ({
      data:
        opts?.initialData?.() ||
        mockBooksList.find(b => b.id === input.bookId) ||
        null,
      isLoading: false,
    }));

    const testQueryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/123/book/b-2']}>
          <Routes>
            <Route
              path="/library/:libraryId/book/:bookId"
              element={<BookDetailsView />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('book-deck-counter')).toHaveTextContent('2 of 5');

    // 1. Horizontal touch swipe left (advances from b-2 -> b-3)
    const deck = screen.getByTestId('book-swipe-deck');
    fireEvent.touchStart(deck, {touches: [{clientX: 300, clientY: 200}]});
    fireEvent.touchMove(deck, {touches: [{clientX: 140, clientY: 202}]});
    fireEvent.touchEnd(deck, {changedTouches: [{clientX: 140, clientY: 202}]});

    await waitFor(() => {
      expect(screen.getByTestId('book-deck-counter')).toHaveTextContent(
        '3 of 5',
      );
    });
    expect(screen.getByTestId('book-swipe-slot-0')).toHaveAttribute(
      'data-book-id',
      'b-3',
    );

    // 2. Keyboard ArrowRight advances from b-3 -> b-4
    fireEvent.keyDown(window, {key: 'ArrowRight'});
    await waitFor(() => {
      expect(screen.getByTestId('book-deck-counter')).toHaveTextContent(
        '4 of 5',
      );
    });
    expect(screen.getByTestId('book-swipe-slot-0')).toHaveAttribute(
      'data-book-id',
      'b-4',
    );

    // 3. Keyboard ArrowLeft retreats from b-4 -> b-3
    fireEvent.keyDown(window, {key: 'ArrowLeft'});
    await waitFor(() => {
      expect(screen.getByTestId('book-deck-counter')).toHaveTextContent(
        '3 of 5',
      );
    });
    expect(screen.getByTestId('book-swipe-slot-0')).toHaveAttribute(
      'data-book-id',
      'b-3',
    );
  });
});
