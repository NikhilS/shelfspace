import {describe, it, expect, vi, beforeEach} from 'vitest';
import {EnrichmentService} from './enrichmentService';
import {LibraryService} from './libraryService';
import {MetadataRegistry} from './metadata';

vi.mock('./libraryService');
vi.mock('./metadata');

const mockBookGet = vi.fn();
const mockBookUpdate = vi.fn();

const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mockBookGet,
        update: mockBookUpdate,
      })),
    })),
  })),
}));

vi.mock('./firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
  }),
}));

describe('EnrichmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully executes batch enrichment for valid books', async () => {
    // 1. Mock library access check
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    // 2. Mock provider
    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi
        .fn()
        .mockResolvedValue({b1: {locations: [{name: 'London'}]}}),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    // 3. Mock book doc in DB
    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Oliver Twist',
        author: 'Charles Dickens',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'geo',
        bookIds: ['b1'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);
    expect(res.results[0]).toEqual({
      id: 'b1',
      geoMetadata: {locations: [{name: 'London'}]},
    });
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        geoMetadata: {locations: [{name: 'London'}]},
      }),
    );
  });

  it('handles non-existent books by returning empty results array', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => mockProvider,
    } as unknown as MetadataRegistry);

    mockBookGet.mockResolvedValueOnce({
      exists: false,
    });

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'synopsis',
        bookIds: ['nonexistent_book'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('ignores books lacking a title and enriches valid ones', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => mockProvider,
    } as unknown as MetadataRegistry);

    mockBookGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: '', // Empty title
      }),
    });

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'genre',
        bookIds: ['b_notitle'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(res.results).toEqual([]);
  });
});
