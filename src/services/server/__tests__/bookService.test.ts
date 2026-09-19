import {describe, it, expect, vi, beforeEach} from 'vitest';
import {BookService} from '../bookService';
import {TRPCError} from '@trpc/server';

const mockSet = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockCommit = vi.fn().mockResolvedValue(undefined);

const mockBatch = vi.fn(() => ({
  set: mockSet,
  update: mockUpdate,
  delete: mockDelete,
  commit: mockCommit,
}));

const mockBookGet = vi.fn();
const mockDetailGet = vi.fn();
const mockReviewsGet = vi.fn().mockResolvedValue({
  forEach: vi.fn(),
});
const mockBooksQueryGet = vi.fn().mockResolvedValue({
  docs: [],
});

const mockBookDoc = {
  id: 'book-1',
  get: mockBookGet,
  collection: vi.fn((sub: string) => {
    if (sub === 'reviews') {
      return {get: mockReviewsGet};
    }
    return {doc: vi.fn()};
  }),
};

const mockDetailDoc = {
  id: 'book-1',
  get: mockDetailGet,
};

const mockDoc = vi.fn((docId?: string) => {
  const effectiveId = docId || 'generated-id-123';
  return {
    id: effectiveId,
    get: mockBookGet,
    collection: vi.fn((sub: string) => {
      if (sub === 'books') {
        const queryObj = {
          doc: vi.fn((id?: string) =>
            id === 'book-1' ? mockBookDoc : mockDoc(id),
          ),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: mockBooksQueryGet,
        };
        return queryObj;
      }
      if (sub === 'bookDetails') {
        return {
          doc: vi.fn((id?: string) =>
            id === 'book-1' ? mockDetailDoc : mockDoc(id),
          ),
        };
      }
      if (sub === 'reviews') {
        return {
          get: mockReviewsGet,
        };
      }
      return {doc: mockDoc};
    }),
  };
});

const mockCollection = vi.fn(() => ({
  doc: mockDoc,
}));

vi.mock('../firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
    batch: mockBatch,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP',
    increment: (n: number) => ({_increment: n}),
  },
}));

describe('BookService - Unified Write Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBook', () => {
    it('creates book and partitions heavy details to bookDetails subcollection', async () => {
      const res = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        synopsis: 'Desert planet spice story',
        authorBio: 'American sci-fi master',
        embedding: [0.1, 0.2, 0.3],
        status: 'reading',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBe('book-1');

      // Verify core book write
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'book-1',
          title: 'Dune',
          author: 'Frank Herbert',
          userStatuses: {'user-1': 'reading'},
          bookDetailsMetadata: {
            hasSynopsis: true,
            hasAuthorBio: true,
            hasEmbedding: true,
            hasClusterCoordinates: false,
          },
        }),
      );

      // Verify heavy details write
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          synopsis: 'Desert planet spice story',
          authorBio: 'American sci-fi master',
          embedding: [0.1, 0.2, 0.3],
        }),
      );

      // Verify library bookCount increment
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bookCount: {_increment: 1},
        }),
      );

      expect(mockCommit).toHaveBeenCalled();
    });

    it('generates a book ID if none is supplied', async () => {
      const res = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        title: 'Untitled Book',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBeDefined();
      expect(mockCommit).toHaveBeenCalled();
    });
  });

  describe('updateBook', () => {
    it('updates core fields and propagates heavy fields to bookDetails', async () => {
      const res = await BookService.updateBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        updates: {
          title: 'Dune Messiah',
          synopsis: 'Second Dune book',
          primaryGenre: 'Science Fiction',
        },
      });

      expect(res.success).toBe(true);

      // Core update contains title, primaryGenre, and metadata flag
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'Dune Messiah',
          primaryGenre: 'Science Fiction',
          'bookDetailsMetadata.hasSynopsis': true,
        }),
      );

      // Heavy update contains synopsis
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          synopsis: 'Second Dune book',
        }),
        {merge: true},
      );

      expect(mockCommit).toHaveBeenCalled();
    });
  });

  describe('deleteBook', () => {
    it('deletes book doc, detail doc, reviews, and decrements bookCount', async () => {
      const res = await BookService.deleteBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
      });

      expect(res.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledTimes(2); // bookRef and detailRef
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bookCount: {_increment: -1},
        }),
      );
      expect(mockCommit).toHaveBeenCalled();
    });
  });

  describe('batchUpsert', () => {
    it('executes batch creation and decrements/increments book count net delta', async () => {
      const res = await BookService.batchUpsert('user-1', {
        libraryId: 'lib-1',
        operations: [
          {
            type: 'create',
            bookId: 'b-1',
            data: {title: 'Book 1'},
            heavyData: {synopsis: 'Synopsis 1'},
          },
          {
            type: 'create',
            bookId: 'b-2',
            data: {title: 'Book 2'},
          },
          {
            type: 'delete',
            bookId: 'b-3',
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(3);
      expect(res.added).toBe(2);
      expect(res.deleted).toBe(1);

      // Net delta = +1
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bookCount: {_increment: 1},
        }),
      );

      expect(mockCommit).toHaveBeenCalled();
    });

    it('handles books array with action flags', async () => {
      const res = await BookService.batchUpsert('user-1', {
        libraryId: 'lib-1',
        books: [
          {id: 'b-10', title: 'Book 10', action: 'create'},
          {id: 'b-11', title: 'Book 11', action: 'update'},
          {id: 'b-12', action: 'delete'},
        ],
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(3);
      expect(res.added).toBe(1);
      expect(res.updated).toBe(1);
      expect(res.deleted).toBe(1);
      expect(mockCommit).toHaveBeenCalled();
    });
  });

  describe('getBook', () => {
    it('fetches book and merges heavy details', async () => {
      mockBookGet.mockResolvedValueOnce({
        exists: true,
        id: 'book-1',
        data: () => ({title: 'Dune', author: 'Frank Herbert'}),
      });

      mockDetailGet.mockResolvedValueOnce({
        exists: true,
        id: 'book-1',
        data: () => ({synopsis: 'Spice world'}),
      });

      const res = await BookService.getBook('user-1', 'lib-1', 'book-1');
      expect(res.id).toBe('book-1');
      expect(res.title).toBe('Dune');
      expect(res.synopsis).toBe('Spice world');
    });

    it('throws NOT_FOUND when book document does not exist', async () => {
      mockBookGet.mockResolvedValueOnce({
        exists: false,
      });

      await expect(
        BookService.getBook('user-1', 'lib-1', 'book-1'),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe('listBooks', () => {
    it('returns formatted books from Firestore query', async () => {
      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'book-1',
            data: () => ({
              title: 'Neuromancer',
              author: 'William Gibson',
              primaryGenre: 'Cyberpunk',
              subgenres: ['Sci-Fi'],
              temporalMetadata: {startYear: 1984},
            }),
          },
          {
            id: 'book-2',
            data: () => ({
              title: 'Snow Crash',
              author: 'Neal Stephenson',
            }),
          },
        ],
      });

      const res = await BookService.listBooks('user-1', 'lib-1');
      expect(res.books).toHaveLength(2);
      expect(res.books[0].title).toBe('Neuromancer');
      expect(res.books[0].primaryGenre).toBe('Cyberpunk');
      expect((res.books[0].temporalMetadata as any)?.endYear).toBe(1984);
      expect(res.books[1].title).toBe('Snow Crash');
    });

    it('filters books by missingMetadata if specified', async () => {
      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'book-1',
            data: () => ({
              title: 'Has Geo',
              geoMetadata: {lat: 10, lng: 20},
            }),
          },
          {
            id: 'book-2',
            data: () => ({
              title: 'Missing Geo',
            }),
          },
        ],
      });

      const res = await BookService.listBooks('user-1', 'lib-1', {
        filters: {missingMetadata: 'geo'},
      });

      expect(res.books).toHaveLength(1);
      expect(res.books[0].title).toBe('Missing Geo');
    });
  });
});
