import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import Dashboard from './Dashboard';
import {useAuth} from '../stores/authStore';
import {addDoc} from 'firebase/firestore';

vi.mock('../stores/authStore');

vi.mock('../lib/trpc', () => ({
  trpc: {
    gemini: {
      generateLibraryHeroImage: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue(''),
        }),
      },
    },
  },
  trpcVanilla: {},
}));

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
    onSnapshot: vi.fn((...args: unknown[]) => {
      const callback = (typeof args[1] === 'function' ? args[1] : args[2]) as (
        snap: unknown,
      ) => void;
      if (callback) {
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
          metadata: {fromCache: false},
          empty: false,
        });
      }
      return () => {};
    }),
    addDoc: vi.fn().mockResolvedValue({id: 'newLibId'}),
    updateDoc: vi.fn(),
    doc: vi.fn(),
    getCountFromServer: vi.fn().mockResolvedValue({data: () => ({count: 0})}),
  };
});

describe('Dashboard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    document.body.innerHTML = '<div id="sidebar-actions-root"></div>';
  });

  const renderDashboard = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('renders loading state initially', () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: null,
    });
    renderDashboard();
  });

  it('renders libraries when user is logged in', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    renderDashboard();
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

    renderDashboard();

    const createBtnInitial = await screen.findByText('Create Library');
    fireEvent.click(createBtnInitial);
    const input = await screen.findByPlaceholderText(
      /Give your library a name/i,
    );
    const createBtn = screen.getByText('Create Collection');

    fireEvent.change(input, {target: {value: 'My New Lib'}});
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(addDoc).toHaveBeenCalled();
    });
  });
});
