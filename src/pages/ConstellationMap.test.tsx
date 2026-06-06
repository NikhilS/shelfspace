import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import ConstellationMap from './ConstellationMap';
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
  collection: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({forEach: vi.fn()}),
  doc: vi.fn(),
  writeBatch: vi.fn(),
  updateDoc: vi.fn(),
  deleteField: vi.fn(),
}));

describe('ConstellationMap', () => {
  it('renders loading state initially', () => {
    const {container} = render(
      <MemoryRouter>
        <ConstellationMap />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('Loading books...');
  });
});
