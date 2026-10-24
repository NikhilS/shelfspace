import {describe, it, expect, vi, beforeEach} from 'vitest';
import {BookService} from './index';
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
const mockWhere = vi.fn().mockReturnThis();

const mockBookDoc = {
  id: 'book-1',
  get: mockBookGet,
  collection: vi.fn((sub: string) => {
    if (sub === 'reviews') {
      return {
        get: mockReviewsGet,
        doc: vi.fn(() => ({id: 'rev-1'})),
      };
    }
    return {doc: vi.fn()};
  }),
};

const mockDetailDoc = {
  id: 'book-1',
  get: mockDetailGet,
};

const mockDoc: (docId?: string) => Record<string, unknown> = vi.fn(
  (docId?: string) => {
    const effectiveId = docId || 'generated-id-123';
    return {
      id: effectiveId,
      get: mockBookGet,
      collection: vi.fn((sub: string) => {
        if (sub === 'books') {
          const queryObj = {
            doc: vi.fn((id?: string): unknown =>
              id === 'book-1' ? mockBookDoc : mockDoc(id),
            ),
            where: mockWhere,
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
            doc: vi.fn(() => ({id: 'rev-1'})),
          };
        }
        return {doc: mockDoc};
      }),
    };
  },
);

const mockCollection = vi.fn(() => ({
  doc: mockDoc,
}));

const mockGetAll = vi.fn(
  async (...refs: Array<{get: () => Promise<unknown>}>) =>
    Promise.all(refs.map(r => r.get())),
);

vi.mock('../firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
    batch: mockBatch,
    getAll: mockGetAll,
  }),
  formatFirestoreAdminError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP',
    increment: (n: number) => ({_increment: n}),
  },
  FieldPath: class {
    fields: string[];
    constructor(...f: string[]) {
      this.fields = f;
    }
  },
}));

describe('BookService - Unified Write Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBook', () => {
    it('creates book and partitions heavy details to bookDetails subcollection with deterministic index fields', async () => {
      const res = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '978-0-441-17271-9',
        synopsis: 'Desert planet spice story',
        authorBio: 'American sci-fi master',
        embedding: [0.1, 0.2, 0.3],
        status: 'reading',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBe('book-1');

      // Verify core book write includes deterministic index fields
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'book-1',
          title: 'Dune',
          author: 'Frank Herbert',
          cleanIsbn: '9780441172719',
          dedupeKey: 'dune::frank herbert',
          searchTokens: expect.arrayContaining(['dune', 'frank', 'herbert']),
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
      expect(
        (res.books[0].temporalMetadata as {endYear?: number} | undefined)
          ?.endYear,
      ).toBe(1984);
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

    it('uses limit + 1 lookahead to populate nextCursor only when more books exist', async () => {
      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {id: 'book-1', data: () => ({title: 'Book 1'})},
          {id: 'book-2', data: () => ({title: 'Book 2'})},
          {id: 'book-3', data: () => ({title: 'Book 3'})},
        ],
      });

      const res = await BookService.listBooks('user-1', 'lib-1', {limit: 2});
      expect(res.books).toHaveLength(2);
      expect(res.nextCursor).toBe('book-2');
    });

    it('self-heals parent library.bookCount when an unfiltered read detects count drift', async () => {
      const mockLibUpdate = vi.fn().mockResolvedValue(undefined);
      mockDoc.mockImplementationOnce((docId?: string) => ({
        id: docId || 'lib-1',
        update: mockLibUpdate,
        collection: vi.fn(() => ({
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: mockBooksQueryGet,
        })),
      }));

      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {id: 'book-1', data: () => ({title: 'Book 1'})},
          {id: 'book-2', data: () => ({title: 'Book 2'})},
        ],
      });

      const res = await BookService.listBooks('user-1', 'lib-1', {
        prefetchedLibraryData: {bookCount: 1000},
      });

      expect(res.books).toHaveLength(2);
      expect(res.totalCount).toBe(2);
    });

    it('pushes status and primaryGenre filters down to native Firestore .where() queries', async () => {
      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'book-1',
            data: () => ({
              title: 'Hyperion',
              author: 'Dan Simmons',
              primaryGenre: 'Sci-Fi',
              userStatuses: {'user-1': 'reading'},
              addedAt: 2000,
            }),
          },
        ],
      });

      const resStatus = await BookService.listBooks('user-1', 'lib-1', {
        filters: {status: 'reading'},
      });

      expect(resStatus.books).toHaveLength(1);
      expect(resStatus.books[0].title).toBe('Hyperion');
      expect(mockWhere).toHaveBeenCalledWith(
        expect.objectContaining({fields: ['userStatuses', 'user-1']}),
        '==',
        'reading',
      );

      mockBooksQueryGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'book-2',
            data: () => ({
              title: 'Foundation',
              author: 'Isaac Asimov',
              primaryGenre: 'Sci-Fi',
              addedAt: 3000,
            }),
          },
        ],
      });

      const resGenre = await BookService.listBooks('user-1', 'lib-1', {
        filters: {primaryGenre: 'Sci-Fi'},
      });

      expect(resGenre.books).toHaveLength(1);
      expect(resGenre.books[0].title).toBe('Foundation');
      expect(mockWhere).toHaveBeenCalledWith('primaryGenre', '==', 'Sci-Fi');
    });
  });

  describe('mergeDuplicates', () => {
    it('fetches survivor and duplicate books in bulk via db.getAll and commits merge in batch', async () => {
      mockGetAll.mockResolvedValueOnce([
        {
          exists: true,
          id: 'book-1',
          data: () => ({
            title: 'Dune',
            userStatuses: {'user-1': 'want_to_read'},
          }),
        },
        {
          exists: true,
          id: 'book-dup-1',
          data: () => ({
            title: 'Dune (Duplicate)',
            userStatuses: {'user-1': 'reading', 'user-2': 'completed'},
          }),
        },
      ]);

      const res = await BookService.mergeDuplicates('user-1', {
        libraryId: 'lib-1',
        survivorBookId: 'book-1',
        duplicateBookIds: ['book-dup-1'],
        mergedFields: {
          title: 'Dune (Definitive Edition)',
        },
      });

      expect(res.success).toBe(true);
      expect(res.survivorBookId).toBe('book-1');
      expect(res.deletedCount).toBe(1);
      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'Dune (Definitive Edition)',
          userStatuses: {
            'user-1': 'reading',
            'user-2': 'completed',
          },
        }),
        {merge: true},
      );
      expect(mockCommit).toHaveBeenCalledTimes(1);
    });
  });

  describe('addReview', () => {
    it('commits review document and parent book rating/status atomically in a single batch', async () => {
      const res = await BookService.addReview(
        'user-1',
        'user1@example.com',
        'Reader One',
        'lib-1',
        'book-1',
        {rating: 5, text: 'Masterpiece!'},
        {skipAccessCheck: true, status: 'finished'},
      );

      expect(res.success).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'user-1',
          userName: 'Reader One',
          rating: 5,
          text: 'Masterpiece!',
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          'userRatings.user-1': 5,
          'userStatuses.user-1': 'finished',
        }),
      );
      expect(mockCommit).toHaveBeenCalledTimes(1);
    });
  });
});
