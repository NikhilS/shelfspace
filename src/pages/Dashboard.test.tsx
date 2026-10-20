import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import Dashboard from './Dashboard';
import {useAuth} from '../stores/authStore';

vi.mock('../stores/authStore');

const mockCreateMutateAsync = vi.fn().mockResolvedValue({id: 'newLibId'});

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      library: {
        list: {invalidate: vi.fn()},
        get: {setData: vi.fn()},
      },
    })),
    auth: {
      getPermissions: {
        useQuery: vi.fn(() => ({
          data: {isAllowed: true, role: 'user'},
          isLoading: false,
        })),
      },
    },
    library: {
      list: {
        useQuery: vi.fn(() => ({
          data: [
            {
              id: 'lib1',
              name: 'Test Library',
              ownerId: 'user1',
              ownerName: 'User One',
              bookCount: 5,
            },
          ],
          isLoading: false,
        })),
      },
      create: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockCreateMutateAsync,
          isLoading: false,
        })),
      },
    },
    gemini: {
      generateLibraryHeroImage: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue(''),
        }),
      },
      getPickOfTheDay: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue([
            {
              title: 'The Left Hand of Darkness',
              author: 'Ursula K. Le Guin',
              reason: 'A luminous exploration of duality and kinship.',
            },
          ]),
        }),
      },
    },
    readingTracker: {
      getShelf: {
        useQuery: vi.fn(() => ({
          data: {
            items: [
              {
                id: 'b-reading-1',
                libraryId: 'lib1',
                libraryName: 'Test Library',
                isVirtual: false,
                ownershipStatus: 'owned',
                readingStatus: 'reading',
                title: 'Project Hail Mary',
                author: 'Andy Weir',
                primaryGenre: 'Science Fiction',
                addedAt: '2026-01-01',
              },
              {
                id: 'b-read-1',
                libraryId: 'virtual_user1',
                libraryName: 'Personal Reading Shelf',
                isVirtual: true,
                ownershipStatus: 'unowned',
                readingStatus: 'finished',
                userRating: 5,
                title: 'Piranesi',
                author: 'Susanna Clarke',
                primaryGenre: 'Fantasy',
                addedAt: '2026-01-02',
              },
            ],
            counts: {
              all: 2,
              want_to_read: 0,
              reading: 1,
              finished: 1,
              abandoned: 0,
            },
          },
          isLoading: false,
        })),
      },
    },
  },
  trpcVanilla: {
    library: {
      update: {
        mutate: vi.fn().mockResolvedValue({}),
      },
    },
    metadata: {
      searchByTitleAndAuthor: {
        mutate: vi.fn().mockResolvedValue({}),
      },
    },
  },
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

  it('renders libraries and Reading Room Bento cards when user is logged in', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    renderDashboard();
    expect(await screen.findByText('Test Library')).toBeInTheDocument();
    expect(await screen.findByText('5 Volumes')).toBeInTheDocument();
    expect(
      (await screen.findAllByText('Project Hail Mary')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Books Read by Genre')).toBeInTheDocument();
    expect(await screen.findByText('Fantasy')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Interactive stack of your last 1 finished books/i),
    ).toBeInTheDocument();
  });

  it('navigates to the library view when clicking a library card', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    renderDashboard();
    const cardTitle = await screen.findByText('Test Library');
    fireEvent.click(cardTitle);
    expect(mockNavigate).toHaveBeenCalledWith('/library/lib1');
  });

  it('can create a new library', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });

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
      expect(mockCreateMutateAsync).toHaveBeenCalled();
    });
  });

  it('safely handles non-array cached query data without crashing', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });

    // Seed queryClient with object-format data instead of raw array
    queryClient.setQueryData(['userLibraries', 'user1'], {
      libraries: [
        {
          id: 'cached-lib-1',
          name: 'Cached Object Library',
          ownerId: 'user1',
          ownerName: 'User One',
          bookCount: 12,
        },
      ],
    });

    renderDashboard();
    expect(await screen.findByText('Test Library')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });
});
