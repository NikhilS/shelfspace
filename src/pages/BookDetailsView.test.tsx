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
  handleFirestoreError: vi.fn(),
  OperationType: {},
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
