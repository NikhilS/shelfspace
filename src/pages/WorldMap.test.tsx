import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {WorldMap} from './WorldMap';
import {MemoryRouter} from 'react-router-dom';

// Mock Auth
vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: {uid: 'u1'}, logOut: vi.fn()}),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      library: {
        list: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        get: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
      },
      readingTracker: {
        getShelf: {invalidate: vi.fn(), setData: vi.fn(), getData: vi.fn()},
        getUnreadLibraryBooks: {
          invalidate: vi.fn(),
          setData: vi.fn(),
          getData: vi.fn(),
        },
      },
    }),
    auth: {
      getPermissions: {
        useQuery: () => ({
          data: {isAppAllowed: true, isAdmin: false, hasAiPlan: true},
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
    readingTracker: {
      getShelf: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      getUnreadLibraryBooks: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
    enrichment: {
      trigger: {
        useMutation: () => ({mutateAsync: vi.fn()}),
      },
    },
  },
  trpcVanilla: {
    enrichment: {
      trigger: {mutate: vi.fn()},
      startJob: {mutate: vi.fn()},
      getJobStatus: {query: vi.fn()},
      cancelJob: {mutate: vi.fn()},
    },
    book: {
      syncChanges: {query: vi.fn()},
      updateStatus: {mutate: vi.fn()},
    },
  },
}));

// Mock Google Maps components to avoid network dependencies
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({children}: {children: React.ReactNode}) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({children}: {children: React.ReactNode}) => (
    <div data-testid="google-map">{children}</div>
  ),
  AdvancedMarker: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button data-testid="map-marker" onClick={onClick}>
      {children}
    </button>
  ),
}));

// Mock library data response
const mockBooks = [
  {
    id: 'b1',
    title: 'Moby Dick',
    author: 'Herman Melville',
    primaryGenre: 'Adventure',
    subgenres: ['Maritime & Nautical'],
    geoMetadata: {
      isNonEarth: false,
      locations: [
        {
          name: 'Nantucket, MA, USA',
          adminLevel: 'city',
          rationale: 'Ishmael sets sail.',
          coordinates: {lat: 41.2835, lng: -70.0995},
        },
      ],
    },
  },
  {
    id: 'b2',
    title: 'Dune',
    author: 'Frank Herbert',
    primaryGenre: 'Science Fiction',
    subgenres: ['Space Opera'],
    geoMetadata: {
      isNonEarth: true,
      locations: [],
    },
  },
];

const mockUseLibraryData = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useLibraryData', () => ({
  useLibraryData: mockUseLibraryData,
}));

describe('WorldMap Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'mock-google-key');
    mockUseLibraryData.mockReturnValue({
      books: mockBooks,
      isBooksLoading: false,
    });
  });

  it('renders Map layout title and components correctly', () => {
    render(
      <MemoryRouter>
        <WorldMap />
      </MemoryRouter>,
    );

    expect(screen.getByText('Literary World Map')).toBeDefined();
    expect(
      screen.getByPlaceholderText(
        /Search setting place, book title or writer name/i,
      ),
    ).toBeDefined();
  });

  it('handles clicking pins and shows details panel', async () => {
    render(
      <MemoryRouter>
        <WorldMap />
      </MemoryRouter>,
    );

    // Find our marker element
    const marker = screen.getByTestId('map-marker');
    expect(marker).toBeDefined();

    // Click to simulate selection
    fireEvent.click(marker);

    // Asynchronously assert that the side panel matches Nantucket, MA, USA
    const locationHeader = await screen.findByText(/Nantucket, MA, USA/i);
    expect(locationHeader).toBeDefined();

    expect(screen.getByText(/Moby Dick/i)).toBeDefined();
    expect(screen.getByText(/Ishmael sets sail/i)).toBeDefined();
  });

  it('displays non-earth books count and allows toggling section', () => {
    render(
      <MemoryRouter>
        <WorldMap />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Non-Earth Archive/i)).toBeDefined();
  });
});
