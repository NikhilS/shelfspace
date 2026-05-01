import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import LibraryView from './LibraryView';
import {MemoryRouter, Route, Routes} from 'react-router-dom';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({user: {uid: 'u1', email: 'test@test.com'}, logOut: vi.fn()}),
}));

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {},
}));

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((db, ...pathArgs) => ({path: pathArgs.join('/')})),
    collection: vi.fn((db, ...pathArgs) => ({path: pathArgs.join('/')})),
    query: vi.fn(),
    onSnapshot: vi.fn((ref, callback) => {
      // Use setTimeout so the first render completes before we trigger the data.
      setTimeout(() => {
        if (ref.path && ref.path.includes('books')) {
          callback({
            docs: [
              {
                id: 'book1',
                data: () => ({
                  title: 'Dune',
                  genres: ['Sci-Fi', 'Fantasy'],
                  author: 'Frank Herbert',
                  addedAt: '2023-01-01',
                }),
              },
              {
                id: 'book2',
                data: () => ({
                  title: 'Foundation',
                  genres: ['Sci-Fi', 'Classic'],
                  author: 'Isaac Asimov',
                  addedAt: '2023-01-01',
                }),
              },
            ],
            forEach: function (cb: (doc: unknown) => void) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (this as any).docs.forEach(cb);
            },
          });
        } else {
          callback({
            exists: () => true,
            id: 'lib1',
            data: () => ({
              name: 'My Sci-Fi Library',
              ownerId: 'u1',
              sharedWith: [],
            }),
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
    Timestamp: {
      fromDate: vi.fn(),
    },
  };
});

vi.mock('recharts', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual('recharts')) as any;
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ResponsiveContainer: ({children}: any) => (
      <div style={{width: 800, height: 800}}>{children}</div>
    ),
  };
});

describe('LibraryView', () => {
  it('renders loading state initially', () => {
    const {container} = render(
      <MemoryRouter initialEntries={['/library/lib1']}>
        <Routes>
          <Route path="/library/:id" element={<LibraryView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders top categories after loading data', async () => {
    render(
      <MemoryRouter initialEntries={['/library/lib1']}>
        <Routes>
          <Route path="/library/:id" element={<LibraryView />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for the library to finish loading
    const topCatCard = await screen.findByText(/Top Categories/i);
    expect(topCatCard).toBeInTheDocument();
  });
});
