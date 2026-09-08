import {describe, it, expect, vi, beforeEach} from 'vitest';
import {sanitizeBookStorage, hasHeavyLeaks} from './sanitizeStorage';
import {Book} from '../../types';

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/clientBulkWriter', () => {
  return {
    ClientBulkWriter: class {
      update = mockUpdate;
      set = mockSet;
      close = mockClose;
    },
  };
});

vi.mock('../../firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db, ...parts) => ({path: parts.join('/')})),
  getDocs: vi.fn(),
  deleteField: vi.fn(() => '__DELETE_FIELD__'),
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

  it('migrates heavy fields to bookDetails and purges them from books doc', async () => {
    const mockBooks: Book[] = [
      {
        id: 'book-1',
        title: 'Leaked Book 1',
        synopsis: 'A deep space odyssey across the stars.',
        authorBio: 'Arthur C. Clarke was a British science fiction writer.',
        embedding: [0.1, -0.2, 0.3],
        clusterCoordinates: {x: 10, y: 20},
        genre: 'Sci-Fi',
        _inBooks: {
          synopsis: true,
          authorBio: true,
          embedding: true,
          clusterCoordinates: true,
        },
      } as any,
      {
        id: 'book-2',
        title: 'Clean Book 2',
        bookDetailsMetadata: {hasSynopsis: false},
      } as any,
    ];

    const result = await sanitizeBookStorage('lib-123', mockBooks);

    expect(result.scannedCount).toBe(2);
    expect(result.sanitizedCount).toBe(1);
    expect(result.purgedFieldsCount).toBe(6); // synopsis, authorBio, embedding, clusterCoordinates, genre, _inBooks

    // Check set on bookDetails
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/bookDetails/book-1'}),
      expect.objectContaining({
        synopsis: 'A deep space odyssey across the stars.',
        authorBio: 'Arthur C. Clarke was a British science fiction writer.',
        embedding: [0.1, -0.2, 0.3],
        clusterCoordinates: {x: 10, y: 20},
      }),
      {merge: true},
    );

    // Check update on books doc with deleteField()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/books/book-1'}),
      expect.objectContaining({
        bookDetailsMetadata: {
          hasSynopsis: true,
          hasAuthorBio: true,
          hasEmbedding: true,
          hasClusterCoordinates: true,
        },
        synopsis: '__DELETE_FIELD__',
        authorBio: '__DELETE_FIELD__',
        embedding: '__DELETE_FIELD__',
        clusterCoordinates: '__DELETE_FIELD__',
        genre: '__DELETE_FIELD__',
        _inBooks: '__DELETE_FIELD__',
      }),
    );

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
