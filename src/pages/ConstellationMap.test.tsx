import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ConstellationMap} from './ConstellationMap';
import {ConstellationChart} from './constellations/ConstellationChart';
import {
  kmeans,
  optimalKMeans,
  normalizeAndRelaxPositions,
  computeClusterMST,
  computePaddedConvexHull,
  computeSemanticNeighbors,
} from '../lib/clustering';
import {ScatterPoint} from '../hooks/useConstellationData';

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: {uid: 'u1'}, logOut: vi.fn()}),
}));

vi.mock('../hooks/useLibraryData', () => ({
  useLibraryData: () => ({
    books: [],
    isBooksLoading: true,
  }),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    readingTracker: {
      getShelf: {
        useQuery: () => ({
          data: undefined,
          isLoading: true,
        }),
      },
    },
    gemini: {
      generateBookEmbeddings: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue([]),
        }),
      },
      generateClusterNames: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({}),
        }),
      },
    },
  },
  trpcVanilla: {
    book: {
      getBookDetailsChunk: {
        mutate: vi.fn().mockResolvedValue({details: {}}),
      },
      batchUpsert: {
        mutate: vi.fn().mockResolvedValue({}),
      },
    },
  },
}));

vi.mock('../firebase', () => ({
  auth: {},
}));

describe('ConstellationMap & Celestial Math Engine', () => {
  it('renders loading state initially', () => {
    const {container} = render(
      <MemoryRouter>
        <ConstellationMap />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('Loading books...');
  });

  it('computes deterministic K-Means++, Silhouette K, collision relaxation, MST, and hulls', () => {
    const points = [
      [-50, -50],
      [-48, -52],
      [-52, -49],
      [50, 50],
      [48, 52],
      [52, 49],
    ];
    const labels = kmeans(points, 2, 100, 42);
    expect(labels.length).toBe(6);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[0]).toBe(labels[2]);
    expect(labels[3]).toBe(labels[4]);
    expect(labels[0]).not.toBe(labels[3]);

    const opt = optimalKMeans(points, 42);
    expect(opt.k).toBeGreaterThanOrEqual(2);

    // Collision relaxation separates identical points
    const relaxed = normalizeAndRelaxPositions([
      {x: 0, y: 0},
      {x: 0, y: 0},
      {x: 10, y: 10},
    ]);
    const dist01 = Math.hypot(
      relaxed[1].x - relaxed[0].x,
      relaxed[1].y - relaxed[0].y,
    );
    expect(dist01).toBeGreaterThan(1);

    // MST and Padded Convex Hull
    const mst = computeClusterMST(relaxed, [0, 1, 2]);
    expect(mst.length).toBe(2);

    const hull = computePaddedConvexHull(relaxed, 8);
    expect(hull.length).toBeGreaterThanOrEqual(3);

    const neighbors = computeSemanticNeighbors(
      relaxed,
      [
        [1, 0, 0],
        [0.95, 0.05, 0],
        [0, 1, 0],
      ],
      2,
    );
    expect(neighbors[0][0].index).toBe(1);
    expect(neighbors[0][0].similarity).toBeGreaterThan(
      neighbors[0][1].similarity,
    );
  });

  it('renders ConstellationChart inspector, filters clusters, and locks onto stars and neighbors', () => {
    const sampleData: ScatterPoint[] = [
      {
        id: 'b1',
        x: -35,
        y: -20,
        clusterId: 0,
        book: {
          id: 'b1',
          title: 'Dune',
          author: 'Frank Herbert',
          primaryGenre: 'Science Fiction',
          publishedDate: '1965',
        },
        neighbors: [
          {
            bookId: 'b2',
            title: 'Hyperion',
            author: 'Dan Simmons',
            clusterId: 0,
            similarity: 0.94,
          },
        ],
      },
      {
        id: 'b2',
        x: -25,
        y: -15,
        clusterId: 0,
        book: {
          id: 'b2',
          title: 'Hyperion',
          author: 'Dan Simmons',
          primaryGenre: 'Science Fiction',
          publishedDate: '1989',
        },
        neighbors: [
          {
            bookId: 'b1',
            title: 'Dune',
            author: 'Frank Herbert',
            clusterId: 0,
            similarity: 0.94,
          },
        ],
      },
      {
        id: 'b3',
        x: 40,
        y: 30,
        clusterId: 1,
        book: {
          id: 'b3',
          title: 'The Name of the Rose',
          author: 'Umberto Eco',
          primaryGenre: 'Historical Mystery',
          publishedDate: '1980',
        },
        neighbors: [
          {
            bookId: 'b1',
            title: 'Dune',
            author: 'Frank Herbert',
            clusterId: 0,
            similarity: 0.72,
          },
        ],
      },
    ];

    render(
      <MemoryRouter>
        <ConstellationChart
          plotData={sampleData}
          clusterNames={{0: 'Galactic Empires', 1: 'Monastic Mysteries'}}
          libraryId="lib-1"
        />
      </MemoryRouter>,
    );

    // Default Atlas Index lists constellations
    expect(screen.getByText('Celestial Atlas Index')).toBeTruthy();
    expect(screen.getAllByText('Galactic Empires').length).toBeGreaterThan(0);

    // Click constellation in Atlas Index to inspect its book roster
    fireEvent.click(screen.getAllByText('Galactic Empires')[0]);
    expect(screen.getByText('Constellation Territory')).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();

    // Click a book in the constellation roster to lock onto its star
    fireEvent.click(screen.getByText('Dune'));
    expect(screen.getByText('Locked Star Inspector')).toBeTruthy();
    expect(screen.getByText('Nearest Semantic Neighbors')).toBeTruthy();
    expect(screen.getByText('94%')).toBeTruthy();
    expect(screen.getByText('Open Book Record')).toBeTruthy();

    // Click the neighbor in the inspector to hop to Hyperion
    fireEvent.click(screen.getByText('Hyperion'));
    expect(screen.getByText('Dan Simmons')).toBeTruthy();
  });
});
