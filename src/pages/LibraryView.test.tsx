/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
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
    doc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    onSnapshot: vi.fn((ref, callback) => {
      // Very basic mock to trigger the data load depending on if it's the library doc or books collection
      if (!ref) return () => {};
      setTimeout(() => {
        // If it's a collection simulation (books) vs doc simulation (library)
        if (
          ref.type === 'collection' ||
          (ref.type === undefined && ref.toString().includes('books'))
        ) {
          callback({
            forEach: (cb: unknown) => {
              cb({
                id: 'book1',
                data: () => ({
                  title: 'Dune',
                  author: 'Frank Herbert',
                  addedAt: '2023-01-01',
                }),
              });
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
    updateDoc: vi.fn(),
    Timestamp: {
      fromDate: vi.fn(),
    },
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
});
