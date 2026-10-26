import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AddBookView} from './AddBookView';
import {useAuth} from '../stores/authStore';
import {BrowserRouter} from 'react-router-dom';

const mockExtractBooksFromImage = vi.fn();
const mockBatchUpsertMutate = vi.fn().mockResolvedValue({success: true});
const mockSearchUnifiedQuery = vi.fn().mockResolvedValue({
  libraryMatches: [
    {
      bookId: 'existing-lib-book-1',
      libraryId: 'lib123',
      libraryName: 'Living Room Shelf',
      isVirtual: false,
      ownershipStatus: 'owned',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      readingStatus: 'unset',
    },
  ],
  externalMatches: [
    {
      title: 'Piranesi',
      author: 'Susanna Clarke',
      isbn: '9781635575637',
    },
  ],
});
const mockTrackBookMutate = vi.fn().mockResolvedValue({success: true});

let mockRouteParams: {id?: string} = {id: 'lib123'};

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      library: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      readingTracker: {
        getShelf: {invalidate: vi.fn()},
      },
    }),
    book: {
      list: {
        useQuery: vi.fn(() => ({
          data: {books: []},
          isLoading: false,
          isFetching: false,
        })),
      },
    },
    readingTracker: {
      getShelf: {
        useQuery: vi.fn(() => ({
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
        })),
      },
    },
    gemini: {
      extractBooksFromImage: {
        useMutation: () => ({
          mutateAsync: mockExtractBooksFromImage,
        }),
      },
    },
  },
  trpcVanilla: {
    book: {
      create: {
        mutate: vi.fn().mockResolvedValue({id: 'new-book-1'}),
      },
      batchUpsert: {
        mutate: (...args: unknown[]) => mockBatchUpsertMutate(...args),
      },
    },
    readingTracker: {
      searchUnified: {
        query: (...args: unknown[]) => mockSearchUnifiedQuery(...args),
      },
      trackBook: {
        mutate: (...args: unknown[]) => mockTrackBookMutate(...args),
      },
    },
    metadata: {
      enrichCreate: {
        mutate: vi.fn(() => Promise.resolve({status: 'success', results: []})),
      },
    },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as Record<string, unknown>),
    useParams: () => mockRouteParams,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'user1',
      email: 'test@example.com',
      emailVerified: true,
      isAnonymous: false,
      providerData: [],
    },
  },
  handleFirestoreError: vi.fn(),
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
}));

vi.mock('../lib/storage', () => ({
  uploadBase64Image: vi.fn(() => Promise.resolve('mocked-url')),
}));

describe('AddBookView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {id: 'lib123'};
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {
        uid: 'user1',
        email: 'test@example.com',
        displayName: 'Test User',
      },
    });

    // Mock getUserMedia
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(() =>
          Promise.resolve({
            getTracks: () => [{stop: vi.fn()}],
            getVideoTracks: () => [{stop: vi.fn()}],
          }),
        ),
      },
      configurable: true,
    });
  });

  it('can add multiple books sequentially from the camera in Library Mode (marked as owned)', async () => {
    mockExtractBooksFromImage.mockResolvedValueOnce([
      {title: 'Book One', author: 'Author One'},
    ]);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AddBookView />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('add-book-context-badge')).toHaveTextContent(
      'Owned · Library Collection',
    );

    // Switch to camera tab
    fireEvent.click(screen.getByTestId('method-selector-trigger')); // Open dropdown
    fireEvent.click(screen.getByTestId('method-option-camera')); // Select camera

    // Wait for the video to appear and trigger onloadedmetadata so isCameraActive becomes true
    const video = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      expect(v!.onloadedmetadata).not.toBeNull();
      return v;
    });

    if (video && video.onloadedmetadata) {
      act(() => {
        video.onloadedmetadata!(new Event('loadedmetadata'));
      });
    }

    const captureButton = await screen.findByTestId('capture-shelf-action');

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      value: 480,
    });

    // Mock canvas context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue('data:image/png;base64,mocked');

    fireEvent.click(captureButton);

    await screen.findByText('Found 1 Books');
    expect(screen.getByText('Book One')).toBeInTheDocument();

    const addButton = screen.getByRole('button', {name: /Add Selected/i});
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockBatchUpsertMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockBatchUpsertMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib123',
        operations: [
          expect.objectContaining({
            type: 'create',
            data: expect.objectContaining({
              title: 'Book One',
              ownershipStatus: 'owned',
            }),
          }),
        ],
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Found 1 Books')).not.toBeInTheDocument();
    });

    const video2 = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      expect(v!.onloadedmetadata).not.toBeNull();
      return v;
    });

    if (video2 && video2.onloadedmetadata) {
      act(() => {
        video2.onloadedmetadata!(new Event('loadedmetadata'));
      });
    }

    const captureButton2 = await screen.findByTestId('capture-shelf-action');

    mockExtractBooksFromImage.mockResolvedValueOnce([
      {title: 'Book Two', author: 'Author Two'},
    ]);
    fireEvent.click(captureButton2);

    await screen.findByText('Found 1 Books');
    expect(screen.getByText('Book Two')).toBeInTheDocument();

    const addButton2 = screen.getByRole('button', {name: /Add Selected/i});
    fireEvent.click(addButton2);

    await waitFor(() => {
      expect(mockBatchUpsertMutate).toHaveBeenCalledTimes(2);
    });
  });

  it('defaults to Scan ISBN on the Advanced page, hides Capture Shelf, and saves external books as unowned in Reading Mode (/reading/add)', async () => {
    mockRouteParams = {};
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AddBookView />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole('heading', {name: 'Find a Book'}),
    ).toBeInTheDocument();
    expect(screen.getByTestId('add-book-context-badge')).toHaveTextContent(
      'Un-owned · Personal Reading Shelf',
    );

    // Capture Shelf is hidden in Reading Mode
    fireEvent.click(screen.getByTestId('method-selector-trigger'));
    expect(
      screen.queryByTestId('method-option-camera'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('method-option-search')).toBeInTheDocument();
    expect(screen.getByTestId('method-option-scan')).toBeInTheDocument();
    expect(screen.getByTestId('method-option-csv')).toBeInTheDocument();
    expect(screen.getByTestId('method-option-manual')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('method-option-search'));

    // Switch target status to "Currently Reading"
    fireEvent.click(screen.getByRole('radio', {name: 'Currently Reading'}));

    // Perform unified search
    const searchInput = screen.getByPlaceholderText(
      /Search by title, author, or ISBN/i,
    );
    fireEvent.change(searchInput, {target: {value: 'Piranesi'}});
    fireEvent.submit(searchInput.closest('form')!);

    await waitFor(() => {
      expect(mockSearchUnifiedQuery).toHaveBeenCalledWith({query: 'Piranesi'});
    });

    // Shows both accessible library match and external catalog match
    expect(
      await screen.findByText('The Left Hand Of Darkness'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Piranesi')).toBeInTheDocument();

    // Clicking Track on existing library match tracks it in place
    fireEvent.click(
      screen.getByRole('button', {name: /Track as Currently Reading/i}),
    );
    await waitFor(() => {
      expect(mockTrackBookMutate).toHaveBeenCalledWith({
        source: 'library',
        libraryId: 'lib123',
        bookId: 'existing-lib-book-1',
        status: 'reading',
      });
    });

    // Clicking Add on external match saves as unowned in virtual_user1 with status 'reading'
    const addButtons = screen.getAllByRole('button', {
      name: /Add to Currently Reading/i,
    });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(mockBatchUpsertMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryId: 'virtual_user1',
          operations: [
            expect.objectContaining({
              type: 'create',
              data: expect.objectContaining({
                title: 'Piranesi',
                ownershipStatus: 'unowned',
                readingStatus: 'reading',
              }),
            }),
          ],
        }),
      );
    });
  });
});
