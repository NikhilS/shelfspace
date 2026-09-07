import {describe, it, expect, vi, beforeEach} from 'vitest';
import {resolveBookSynopses} from './utils';
import {MetadataRegistry} from './registry';
import {CoreBookData, MetadataKey} from '../../../types/metadata';

vi.mock('./registry');

describe('resolveBookSynopses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses synopsis if already present on book', async () => {
    const books: CoreBookData[] = [
      {
        id: '1',
        title: 'Book One',
        author: 'Author One',
        synopsis: 'Existing synopsis',
      },
    ];

    const result = await resolveBookSynopses(books);
    expect(result.get('1')).toBe('Existing synopsis');
  });

  it('bulk fetches missing synopses in a single provider call', async () => {
    const books: CoreBookData[] = [
      {
        id: '1',
        title: 'Book One',
        author: 'Author One',
        synopsis: 'Already has one',
      },
      {
        id: '2',
        title: 'Book Two',
        author: 'Author Two',
      },
      {
        id: '3',
        title: 'Book Three',
        author: 'Author Three',
      },
    ];

    const mockBulkFetch = vi.fn().mockResolvedValue({
      '2': 'Fetched Synopsis Two',
      '3': 'Fetched Synopsis Three',
    });

    const mockRegistry = {
      getProvider: vi.fn().mockImplementation((key: MetadataKey) => {
        if (key === MetadataKey.SYNOPSIS) {
          return {
            bulkFetch: mockBulkFetch,
          };
        }
        return null;
      }),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    const result = await resolveBookSynopses(books);

    expect(result.get('1')).toBe('Already has one');
    expect(result.get('2')).toBe('Fetched Synopsis Two');
    expect(result.get('3')).toBe('Fetched Synopsis Three');
    // Ensure bulkFetch was called exactly once with ONLY the missing books (2 & 3)
    expect(mockBulkFetch).toHaveBeenCalledTimes(1);
    expect(mockBulkFetch).toHaveBeenCalledWith([books[1], books[2]]);
  });

  it('handles provider failure gracefully without throwing', async () => {
    const books: CoreBookData[] = [
      {
        id: '1',
        title: 'Book One',
        author: 'Author One',
      },
    ];

    const mockBulkFetch = vi
      .fn()
      .mockRejectedValue(new Error('Network failure'));

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue({
        bulkFetch: mockBulkFetch,
      }),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    const result = await resolveBookSynopses(books);
    expect(result.get('1')).toBeUndefined();
  });
});
