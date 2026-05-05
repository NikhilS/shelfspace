import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import Dashboard from './Dashboard';
import {useAuth} from '../contexts/AuthContext';
import {addDoc} from 'firebase/firestore';

vi.mock('../contexts/AuthContext');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
      uid: 'user1',
    },
  },
  handleFirestoreError: vi.fn(),
  OperationType: {CREATE: 'create'},
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({id: 'newLibId'}),
});

vi.mock('firebase/firestore', async () => {
  const actual =
    await vi.importActual<typeof import('firebase/firestore')>(
      'firebase/firestore',
    );
  return {
    ...actual,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    or: vi.fn(),
    onSnapshot: vi.fn((query, callback) => {
      callback({
        forEach: (cb: (doc: unknown) => void) =>
          cb({
            id: 'lib1',
            data: () => ({
              name: 'Test Library',
              ownerId: 'user1',
              ownerName: 'User One',
              bookCount: 5,
            }),
          }),
        empty: false,
      });
      return () => {};
    }),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    doc: vi.fn(),
    getCountFromServer: vi.fn().mockResolvedValue({data: () => ({count: 0})}),
  };
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="sidebar-actions-root"></div>';
  });

  it('renders loading state initially', () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: null,
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
  });

  it('renders libraries when user is logged in', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Test Library')).toBeInTheDocument();
    expect(await screen.findByText('5 Volumes')).toBeInTheDocument();
  });

  it('can create a new library', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    (addDoc as import('vitest').Mock).mockResolvedValue({id: 'newLibId'});

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const createBtnInitial = await screen.findByText('Create Library');
    fireEvent.click(createBtnInitial);
    const input = await screen.findByPlaceholderText(
      'Library Name (e.g. Private Study)',
    );
    const createBtn = screen.getByText('Create Collection');

    fireEvent.change(input, {target: {value: 'My New Lib'}});
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
