import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import BookDetailsView from './BookDetailsView';
import {MemoryRouter} from 'react-router-dom';

vi.mock('../contexts/AuthContext', () => ({
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
  onSnapshot: vi.fn((_ref, cb) => {
    cb();
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
    const {container} = render(
      <MemoryRouter>
        <BookDetailsView />
      </MemoryRouter>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
