import {renderHook, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useBulkEnrichment, UseBulkEnrichmentConfig} from './useBulkEnrichment';
import {Book} from '../types';

// Mock dependencies
const mockBatch = {
  update: vi.fn(),
  commit: vi.fn(() => Promise.resolve()),
};

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  writeBatch: vi.fn(() => mockBatch),
}));

vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user123',
      getIdToken: () => Promise.resolve('mock-token'),
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useBulkEnrichment', () => {
  const mockBooks: Book[] = Array.from(
    {length: 45},
    (_, i) =>
      ({
        id: `book_${i}`,
        title: `Book Title ${i}`,
        author: `Author ${i}`,
      }) as Book,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: () =>
          Promise.resolve({
            results: [
              {
                id: 'book_0',
                temporalMetadata: {isNonHistorical: false, startYear: 1800},
              },
            ],
          }),
      }),
    );
  });

  it('calculates books to backfill based on predicate', () => {
    const filterPredicate = (b: Book) => !b.temporalMetadata;
    const {result} = renderHook(() =>
      useBulkEnrichment({
        books: mockBooks,
        isBooksLoading: false,
        libraryId: 'lib123',
        apiEndpoint: '/api/batch-enrich',
        metadataField: 'temporalMetadata',
        batchSize: 20,
        concurrencyLimit: 2,
        filterPredicate,
        autoTrigger: false,
      }),
    );

    expect(result.current.booksToBackfill.length).toBe(45);
  });

  it('runs batch backfill successfully', async () => {
    const filterPredicate = (b: Book) => !b.temporalMetadata;
    const {result} = renderHook(() =>
      useBulkEnrichment({
        books: mockBooks,
        isBooksLoading: false,
        libraryId: 'lib123',
        apiEndpoint: '/api/batch-enrich',
        metadataField: 'temporalMetadata',
        batchSize: 20,
        concurrencyLimit: 2,
        filterPredicate,
        autoTrigger: false,
      }),
    );

    await act(async () => {
      await result.current.triggerBackfill();
    });

    expect(global.fetch).toHaveBeenCalled();
  });

  it('retries when the server returns 429 or 500', async () => {
    const filterPredicate = (b: Book) => !b.temporalMetadata;
    const {result} = renderHook(() =>
      useBulkEnrichment({
        books: mockBooks.slice(0, 5), // small subset
        isBooksLoading: false,
        libraryId: 'lib123',
        apiEndpoint: '/api/batch-enrich',
        metadataField: 'temporalMetadata',
        batchSize: 20,
        concurrencyLimit: 1,
        filterPredicate,
        autoTrigger: false,
      }),
    );

    let count = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      count++;
      if (count === 1) {
        return Promise.resolve({
          status: 429,
          ok: false,
        });
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: () =>
          Promise.resolve({
            results: [
              {
                id: 'book_0',
                temporalMetadata: {isNonHistorical: false, startYear: 1800},
              },
            ],
          }),
      });
    });

    await act(async () => {
      await result.current.triggerBackfill();
    });

    // Expect fetch to be called twice (initial fail + 1 retry)
    expect(count).toBe(2);
  });
});
