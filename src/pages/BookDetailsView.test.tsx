import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import BookDetailsView from './BookDetailsView';
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
  useAuth: () => ({user: {uid: 'u1'}, logOut: vi.fn()}),
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
        useQuery: vi.fn(() => ({
          data: null,
          isLoading: true,
        })),
      },
      listReviews: {
        useQuery: vi.fn(() => ({
          data: [],
          isLoading: false,
        })),
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
  trpcVanilla: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({exists: () => false}),
  collection: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn((...args) => {
    return () => {};
  }),
  orderBy: vi.fn(),
  updateDoc: vi.fn(),
  Timestamp: {},
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  deleteDoc: vi.fn(),
  getDocFromCache: vi.fn().mockRejectedValue(new Error('no cache')),
  getDocsFromCache: vi.fn().mockRejectedValue(new Error('no cache')),
}));

describe('BookDetailsView', () => {
  it('renders loading state initially', () => {
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
});
