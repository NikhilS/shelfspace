import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Dashboard} from './Dashboard';
import {useAuth} from '../stores/authStore';

vi.mock('../stores/authStore');

const mockCreateMutateAsync = vi.fn().mockResolvedValue({id: 'newLibId'});
const mockUpdateStatusMutate = vi.fn().mockResolvedValue({});
const mockGetUnreadLibraryBooksUseQuery = vi.fn(
  (): {data: unknown[]; isLoading: boolean} => ({
    data: [],
    isLoading: false,
  }),
);

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      library: {
        list: {invalidate: vi.fn()},
        get: {setData: vi.fn()},
      },
      readingTracker: {
        getShelf: {invalidate: vi.fn()},
        getUnreadLibraryBooks: {invalidate: vi.fn()},
      },
    })),
    auth: {
      getPermissions: {
        useQuery: vi.fn(() => ({
          data: {isAllowed: true, role: 'user', hasAiPlan: true},
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
      getUnreadLibraryBooks: {
        useQuery: () => mockGetUnreadLibraryBooksUseQuery(),
      },
    },
  },
  trpcVanilla: {
    book: {
      updateStatus: {
        mutate: (...args: unknown[]) => mockUpdateStatusMutate(...args),
      },
    },
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
    mockGetUnreadLibraryBooksUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
    });
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

  it('renders libraries and Reading Room Bento cards when user is logged in, omitting the unread library card when none match', async () => {
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
    expect(screen.getByText('Explore Your Reading')).toBeInTheDocument();
    expect(
      screen.queryByTestId('reading-discovery-row'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', {name: /Overview/i})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: /All Books/i})).toBeInTheDocument();
    expect(screen.queryByText('Shelf Care')).not.toBeInTheDocument();

    // Switch to the shared All Books collection tab
    fireEvent.click(screen.getByRole('tab', {name: /All Books/i}));
    expect(
      await screen.findByRole('tab', {name: /All Tracked/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'In Libraries'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Un-owned'})).toBeInTheDocument();
  });

  it('renders unread library books inside SuggestedNextReadsCard when unread books exist and supports Want to Read, pill selection, and book detail navigation', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });

    mockGetUnreadLibraryBooksUseQuery.mockReturnValue({
      data: [
        {
          id: 'unread-1',
          libraryId: 'lib1',
          libraryName: 'Test Library',
          title: 'The Dispossessed',
          author: 'Ursula K. Le Guin',
          synopsis: 'An ambiguous utopia across twin worlds.',
          readingStatus: 'unset',
        },
        {
          id: 'unread-2',
          libraryId: 'lib2',
          libraryName: 'Shared Family Shelf',
          title: 'Hyperion',
          author: 'Dan Simmons',
          primaryGenre: 'Science Fiction',
          readingStatus: 'want_to_read',
        },
      ],
      isLoading: false,
    });

    renderDashboard();

    const suggestionsCard = await screen.findByTestId(
      'suggested-next-reads-card',
    );
    expect(suggestionsCard).toBeInTheDocument();
    expect(
      screen.getAllByText(/From Your Libraries/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Filter to On Your Shelves and select The Dispossessed pill tab
    fireEvent.click(screen.getByRole('tab', {name: /On Your Shelves/i}));
    fireEvent.click(screen.getByRole('tab', {name: 'The Dispossessed'}));
    const dispossessedHeading = await screen.findByRole('heading', {
      name: 'The Dispossessed',
    });
    expect(dispossessedHeading).toBeInTheDocument();

    // Clicking the book title navigates to the book detail view
    fireEvent.click(dispossessedHeading);
    expect(mockNavigate).toHaveBeenCalledWith('/library/lib1/book/unread-1', {
      state: {from: '/'},
    });

    // Clicking Want to Read updates the book status to want_to_read
    const wantToReadButtons = screen.getAllByRole('button', {
      name: /^Want to Read$/i,
    });
    fireEvent.click(wantToReadButtons[0]);
    await waitFor(() => {
      expect(mockUpdateStatusMutate).toHaveBeenCalledWith({
        libraryId: 'lib1',
        bookId: 'unread-1',
        status: 'want_to_read',
      });
    });

    // Clicking the Hyperion pill in the strip switches to the other unread book
    const hyperionPill = screen.getByRole('tab', {name: 'Hyperion'});
    fireEvent.click(hyperionPill);
    expect(
      await screen.findByRole('heading', {name: 'Hyperion'}),
    ).toBeInTheDocument();
  });

  it('navigates to the library view when clicking a library card and opens QuickAddBookDialog with Advanced link when clicking Find a Book', async () => {
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });
    renderDashboard();
    const cardTitle = await screen.findByText('Test Library');
    fireEvent.click(cardTitle);
    expect(mockNavigate).toHaveBeenCalledWith('/library/lib1');

    const trackBtn = screen.getByRole('button', {name: /Find a Book/i});
    fireEvent.click(trackBtn);

    expect(
      await screen.findByTestId('quick-add-book-dialog'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quick-add-advanced-link'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/reading/add?status=want_to_read',
    );
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

  it('disables write and AI actions in place with offline tooltips when offline', async () => {
    const onLineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false);
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'user1', email: 'user@example.com'},
    });

    try {
      renderDashboard();
      const findBookBtn = await screen.findByRole('button', {
        name: /Find a Book/i,
      });
      expect(findBookBtn).toBeDisabled();
      expect(findBookBtn).toHaveAttribute('title', 'Unavailable while offline');

      const createLibraryBtn = screen.getByRole('button', {
        name: /Create Library/i,
      });
      expect(createLibraryBtn).toBeDisabled();
      expect(createLibraryBtn).toHaveAttribute(
        'title',
        'Unavailable while offline',
      );

      const markFinishedBtn = screen.getByRole('button', {
        name: /Mark Finished/i,
      });
      expect(markFinishedBtn).toBeDisabled();
      expect(markFinishedBtn).toHaveAttribute(
        'title',
        'Unavailable while offline',
      );
    } finally {
      onLineSpy.mockRestore();
    }
  });

  it('renders the Getting Started onboarding studio and Empty Libraries guide when a new user has zero tracked books and zero libraries', async () => {
    const {trpc} = await import('../lib/trpc');
    const shelfMock = vi.mocked(trpc.readingTracker.getShelf.useQuery);
    const listMock = vi.mocked(trpc.library.list.useQuery);
    const prevShelfImpl = shelfMock.getMockImplementation();
    const prevListImpl = listMock.getMockImplementation();

    shelfMock.mockReturnValue({
      data: {
        items: [],
        counts: {
          all: 0,
          want_to_read: 0,
          reading: 0,
          finished: 0,
          abandoned: 0,
        },
      },
      isLoading: false,
    } as never);
    listMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as never);

    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {uid: 'new-user', email: 'newreader@example.com'},
    });

    try {
      renderDashboard();

      expect(
        await screen.findByTestId('reading-onboarding-studio'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Welcome to Your Reading Room'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('empty-libraries-guide')).toBeInTheDocument();
      expect(
        screen.getByText('Catalog Your Home Bookshelves'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Browse Friends & Family Libraries/i),
      ).toBeInTheDocument();
    } finally {
      if (prevShelfImpl) shelfMock.mockImplementation(prevShelfImpl);
      if (prevListImpl) listMock.mockImplementation(prevListImpl);
    }
  });
});
