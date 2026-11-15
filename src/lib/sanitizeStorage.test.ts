import {describe, it, expect, vi, beforeEach} from 'vitest';
import {sanitizeBookStorage, hasHeavyLeaks} from './sanitizeStorage';
import {Book} from '../types';
import {trpcVanilla} from './trpc';

const mockResetMetadata = vi
  .fn<(input: unknown) => Promise<{success: boolean; count: number}>>()
  .mockResolvedValue({
    success: true,
    count: 3,
  });

vi.mock('./trpc', () => ({
  trpcVanilla: {
    library: {
      resetMetadata: {
        mutate: vi.fn((input: unknown) => mockResetMetadata(input)),
      },
    },
  },
}));

describe('sanitizeStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly detects books with heavy leaks', () => {
    expect(hasHeavyLeaks({id: '1', title: 'Clean Book'})).toBe(false);
    expect(
      hasHeavyLeaks({id: '2', title: 'Leaked', synopsis: 'Long text'}),
    ).toBe(true);
    expect(hasHeavyLeaks({id: '3', title: 'Leaked', embedding: [0.1]})).toBe(
      true,
    );
    expect(
      hasHeavyLeaks({
        id: '4',
        title: 'Leaked',
        _inBooks: {},
      }),
    ).toBe(true);
  });

  it('calls trpc resetMetadata sanitize to purge heavy fields server-side', async () => {
    const mockBooks: Book[] = [
      {
        id: 'book-1',
        title: 'Leaked Book 1',
      } as unknown as Book,
      {
        id: 'book-2',
        title: 'Clean Book 2',
      } as unknown as Book,
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
