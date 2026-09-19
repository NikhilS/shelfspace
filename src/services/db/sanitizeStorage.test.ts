import {describe, it, expect, vi, beforeEach} from 'vitest';
import {sanitizeBookStorage, hasHeavyLeaks} from './sanitizeStorage';
import {Book} from '../../types';
import {trpcVanilla} from '../../lib/trpc';

const mockResetMetadata = vi.fn().mockResolvedValue({
  success: true,
  count: 3,
});

vi.mock('../../lib/trpc', () => ({
  trpcVanilla: {
    library: {
      resetMetadata: {
        mutate: vi.fn((...args) => mockResetMetadata(...args)),
      },
    },
  },
}));

describe('sanitizeStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly detects books with heavy leaks', () => {
    expect(hasHeavyLeaks({id: '1', title: 'Clean Book'} as Book)).toBe(false);
    expect(
      hasHeavyLeaks({id: '2', title: 'Leaked', synopsis: 'Long text'} as Book),
    ).toBe(true);
    expect(
      hasHeavyLeaks({id: '3', title: 'Leaked', embedding: [0.1]} as Book),
    ).toBe(true);
    expect(
      hasHeavyLeaks({id: '4', title: 'Leaked', _inBooks: {} as any} as Book),
    ).toBe(true);
  });

  it('calls trpc resetMetadata sanitize to purge heavy fields server-side', async () => {
    const mockBooks: Book[] = [
      {
        id: 'book-1',
        title: 'Leaked Book 1',
      } as any,
      {
        id: 'book-2',
        title: 'Clean Book 2',
      } as any,
    ];

    const onProgress = vi.fn();
    const result = await sanitizeBookStorage('lib-123', mockBooks, onProgress);

    expect(trpcVanilla.library.resetMetadata.mutate).toHaveBeenCalledWith({
      libraryId: 'lib-123',
      metadataType: 'sanitize',
    });
    expect(result.scannedCount).toBe(2);
    expect(result.sanitizedCount).toBe(3);
    expect(result.purgedFieldsCount).toBe(3);
    expect(onProgress).toHaveBeenCalledWith({completed: 3, total: 3});
  });
});
