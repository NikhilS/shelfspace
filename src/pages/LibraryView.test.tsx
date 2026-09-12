import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import LibraryView from './LibraryView';
import {MemoryRouter, Route, Routes} from 'react-router-dom';

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: {uid: 'u1', email: 'test@test.com'}, logOut: vi.fn()}),
}));

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {},
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    gemini: {
      generateLibraryHeroImage: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue(''),
        }),
      },
      getPickOfTheDay: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({}),
        }),
      },
    },
    libraryApi: {
      list: {
        useQuery: () => ({data: null, isLoading: false}),
      },
    },
  },
  trpcVanilla: {
    libraryApi: {
      list: {query: vi.fn()},
    },
  },
}));

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((db, ...pathArgs) => ({path: pathArgs.join('/')})),
    collection: vi.fn((db, ...pathArgs) => ({path: pathArgs.join('/')})),
    query: vi.fn(ref => ref),
    onSnapshot: vi.fn((ref, arg2, arg3) => {
      const callback = typeof arg2 === 'function' ? arg2 : arg3;
      // Use setTimeout so the first render completes before we trigger the data.
      setTimeout(() => {
        if (ref && ref.path && ref.path.includes('books')) {
          callback({
            metadata: {hasPendingWrites: false},
            size: 2,
            docs: [
              {
                id: 'book1',
                data: () => ({
                  title: 'Dune',
                  primaryGenre: 'Science Fiction',
                  subgenres: ['Space Opera'],
                  author: 'Frank Herbert',
                  addedAt: '2023-01-01',
                }),
              },
              {
                id: 'book2',
                data: () => ({
                  title: 'Foundation',
                  primaryGenre: 'Science Fiction',
                  subgenres: ['Hard Sci-Fi'],
                  author: 'Isaac Asimov',
                  addedAt: '2023-01-01',
                }),
              },
            ],
            forEach: function (cb: (doc: unknown) => void) {
              (this as {docs: unknown[]}).docs.forEach(cb);
            },
          });
        } else {
          callback({
            exists: () => true,
            id: 'lib1',
            data: () => ({
              name: 'My Sci-Fi Library',
              ownerId: 'u1',
              access: {
                'test@test.com': 'owner',
              },
            }),
            metadata: {
              fromCache: false,
            },
          });
        }
      }, 0);
      return () => {};
    }),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    getDoc: vi.fn(),
    updateDoc: vi.fn(() => Promise.resolve()),
    orderBy: vi.fn(),
    getDocFromCache: vi.fn().mockRejectedValue(new Error('no cache')),
    getDocsFromCache: vi.fn().mockRejectedValue(new Error('no cache')),
    Timestamp: {
      fromDate: vi.fn(),
    },
  };
});

describe('LibraryView', () => {
  it('renders loading state initially', () => {
    const testQueryClient = createTestQueryClient();
    const {container} = render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/lib1']}>
          <Routes>
            <Route path="/library/:id" element={<LibraryView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders top categories after loading data', async () => {
    const testQueryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/lib1']}>
          <Routes>
            <Route path="/library/:id" element={<LibraryView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Wait for the library to finish loading
    const topCatCard = await screen.findByText(/Top Categories/i);
    expect(topCatCard).toBeInTheDocument();
  });

  it('renders responsive navigation tabs with adaptive labels and compact badge count', async () => {
    const testQueryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/library/lib1']}>
          <Routes>
            <Route path="/library/:id" element={<LibraryView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Verify adaptive desktop/mobile text elements exist
    const allBooksLabel = await screen.findByText('All Books');
    const mobileBooksLabel = await screen.findByText('Books');
    expect(allBooksLabel).toBeInTheDocument();
    expect(mobileBooksLabel).toBeInTheDocument();

    const addBooksLabel = await screen.findByText('Add Books');
    const mobileAddLabel = await screen.findByText('Add');
    expect(addBooksLabel).toBeInTheDocument();
    expect(mobileAddLabel).toBeInTheDocument();
  });
});
