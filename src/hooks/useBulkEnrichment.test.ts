import {renderHook, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useBulkEnrichment} from './useBulkEnrichment';
import {Book} from '../types';
import {trpcVanilla} from '../lib/trpc';

vi.mock('../lib/trpc', () => ({
  trpcVanilla: {
    enrichment: {
      trigger: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'test-user-123'},
  }),
}));

vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useBulkEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseBook: Book = {
    id: 'b1',
    title: 'Book 1',
    author: 'Author 1',
    addedBy: 'user-1',
    addedAt: {toDate: () => new Date(), toMillis: () => Date.now()},
  };

  it('filters out books that have status "unsupported" when overwrite is false', () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b1',
        title: 'Unsupported Book',
        enrichmentStatus: {geo: 'unsupported'},
      },
      {
        ...baseBook,
        id: 'b2',
        title: 'New Book',
      },
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'geo',
        metadataField: 'geoMetadata',
        filterPredicate: b => !b.geoMetadata,
        autoTrigger: false,
      }),
    );

    // Only b2 should be queued for backfill, b1 is skipped due to tombstone
    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b2']);
  });

  it('includes unsupported books when overwrite is true', () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b1',
        title: 'Unsupported Book',
        enrichmentStatus: {geo: 'unsupported'},
      },
      {
        ...baseBook,
        id: 'b2',
        title: 'New Book',
      },
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'geo',
        metadataField: 'geoMetadata',
        filterPredicate: b => !b.geoMetadata,
        autoTrigger: false,
        overwrite: true,
      }),
    );

    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  it('dispatches to trpcVanilla.enrichment.trigger.mutate during triggerBackfill', async () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b10',
        title: 'Novel',
      },
    ];

    vi.mocked(trpcVanilla.enrichment.trigger.mutate).mockResolvedValueOnce({
      status: 'success',
      enrichmentType: 'temporal',
      processedCount: 1,
      results: [{id: 'b10', temporalMetadata: {startYear: 1920}}],
    });

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'temporal',
        metadataField: 'temporalMetadata',
        filterPredicate: b => !b.temporalMetadata,
        autoTrigger: false,
      }),
    );

    await act(async () => {
      await result.current.triggerBackfill();
    });

    expect(trpcVanilla.enrichment.trigger.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib1',
        bookIds: ['b10'],
        enrichmentType: 'temporal',
        overwrite: false,
      }),
    );
  });
});
