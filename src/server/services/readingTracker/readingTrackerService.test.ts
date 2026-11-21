import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ReadingTrackerService} from './index';
import {LibraryService} from '../library';
import {BookService} from '../book';
import {catalogOrchestrator} from '../catalog';
import {getAdminDb} from '../firebaseAdmin';

vi.mock('../library', () => ({
  LibraryService: {
    getUserLibraries: vi.fn(),
    resolveLibraryAccess: vi.fn(),
    verifyLibraryAccess: vi.fn(),
  },
}));

vi.mock('../book', async importOriginal => {
  const actual = await importOriginal<typeof import('../book')>();
  return {
    ...actual,
    BookService: {
      updateBookStatus: vi.fn(),
      addReview: vi.fn(),
      createBook: vi.fn(),
    },
    BookPartitioner: {
      partitionBookPayload: vi.fn(),
      mergeBookAndDetails: vi.fn(
        (id: string, data: Record<string, unknown>) => ({
          id,
          ...data,
        }),
      ),
    },
    fetchUserReadingStatesMap: vi.fn(),
    fetchUserReadingStatesProjection: vi.fn(),
  };
});

vi.mock('../catalog', () => ({
  catalogOrchestrator: {
    searchByQuery: vi.fn(),
    searchByIsbn: vi.fn(),
  },
}));

vi.mock('../firebaseAdmin', () => ({
  getAdminDb: vi.fn(),
}));

describe('ReadingTrackerService', () => {
  const mockCollectionGet = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn();
  const mockGetAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockResolvedValue([]);

    const queryChain = {
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockCollectionGet,
      doc: vi.fn((docId: string) => ({
        id: docId,
        get: mockDocGet,
        set: mockDocSet,
      })),
    };
    mockWhere.mockReturnValue(queryChain);
    mockOrderBy.mockReturnValue(queryChain);
    mockLimit.mockReturnValue(queryChain);

    vi.mocked(getAdminDb).mockReturnValue({
      getAll: mockGetAll,
      collection: vi.fn((colName: string) => {
        if (colName === 'libraries') {
          return {
            doc: vi.fn((libId: string) => ({
              id: libId,
              get: mockDocGet,
              set: mockDocSet,
              collection: vi.fn(() => queryChain),
            })),
          };
        }
        return {};
      }),
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  describe('getPersonalReadingShelf', () => {
    it('hydrates live catalog fields via db.getAll over slim readingStates stubs and falls back cleanly for unowned/deleted stubs', async () => {
      const {fetchUserReadingStatesMap} = await import('../book');
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-1',
            name: 'Home Library',
            ownerId: 'u1',
            ownerName: 'Reader',
            callerRole: 'owner',
            createdAt: '2026-01-01',
            bookCount: 2,
          },
        ],
      });

      vi.mocked(fetchUserReadingStatesMap).mockResolvedValueOnce(
        new Map([
          [
            'book:lib-1:book-1',
            {
              id: 'book:lib-1:book-1',
              userId: 'u1',
              keyType: 'book',
              cleanIsbn: '9780441478125',
              bookId: 'book-1',
              libraryId: 'lib-1',
              status: 'reading',
              rating: 5,
              updatedAt: '2026-02-01T00:00:00.000Z',
              bookSnapshot: {
                title: 'Stale Snapshot Title',
                author: 'Ursula K. Le Guin',
                isbn: '9780441478125',
                cleanIsbn: '9780441478125',
                ownershipStatus: 'owned',
              },
            },
          ],
          [
            'ext:9780061054884',
            {
              id: 'ext:9780061054884',
              userId: 'u1',
              keyType: 'ext',
              cleanIsbn: '9780061054884',
              bookId: 'ext_9780061054884',
              libraryId: 'virtual_u1',
              status: 'want_to_read',
              updatedAt: '2026-02-02T00:00:00.000Z',
              bookSnapshot: {
                title: 'The Dispossessed',
                author: 'Ursula K. Le Guin',
                isbn: '9780061054884',
                cleanIsbn: '9780061054884',
                ownershipStatus: 'unowned',
              },
            },
          ],
        ]),
      );

      mockGetAll.mockResolvedValueOnce([
        {
          exists: true,
          id: 'book-1',
          data: () => ({
            title: 'The Left Hand of Darkness',
            author: 'Ursula K. Le Guin',
            isbn: '9780441478125',
            cleanIsbn: '9780441478125',
            primaryGenre: 'Science Fiction',
            subgenres: ['Anthropological Sci-Fi'],
            ownershipStatus: 'owned',
          }),
        },
      ]);

      const summary = await ReadingTrackerService.getPersonalReadingShelf(
        'u1',
        'u1@example.com',
        {shelf: 'all'},
      );

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(summary.counts.all).toBe(2);
      expect(summary.counts.reading).toBe(1);
      expect(summary.counts.want_to_read).toBe(1);
      expect(summary.items[0].title).toBe('The Dispossessed');
      expect(summary.items[0].ownershipStatus).toBe('unowned');
      expect(summary.items[1].title).toBe('The Left Hand of Darkness');
      expect(summary.items[1].subgenres).toEqual(['Anthropological Sci-Fi']);
      expect(summary.items[1].userRating).toBe(5);
      expect(summary.items[1].libraryName).toBe('Home Library');
    });
  });

  describe('getUnreadLibraryBooks', () => {
    it('returns unset and want_to_read books across non-virtual libraries using canonical book: and ext: lookup keys', async () => {
      const {fetchUserReadingStatesProjection} = await import('../book');
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-1',
            name: 'Home Library',
            ownerId: 'u1',
            ownerName: 'Reader',
            callerRole: 'owner',
            createdAt: '2026-01-01',
            bookCount: 3,
          },
          {
            id: 'lib-2',
            name: 'Shared Library',
            ownerId: 'u2',
            ownerName: 'Friend',
            callerRole: 'viewer',
            createdAt: '2026-01-01',
            bookCount: 2,
          },
        ],
      });

      mockCollectionGet
        // lib-1 books
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'b1-unread',
              data: () => ({
                title: 'The Dispossessed',
                author: 'Ursula K. Le Guin',
                isbn: '978-0061054884',
              }),
            },
            {
              id: 'b1-reading',
              data: () => ({
                title: 'Project Hail Mary',
                author: 'Andy Weir',
              }),
            },
            {
              id: 'b1-read-by-isbn',
              data: () => ({
                title: 'Piranesi',
                author: 'Susanna Clarke',
                isbn: '9781635575637',
              }),
            },
          ],
        })
        // lib-2 books
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'b2-want-to-read',
              data: () => ({
                title: 'Hyperion',
                author: 'Dan Simmons',
              }),
            },
            {
              id: 'b2-abandoned',
              data: () => ({
                title: 'Infinite Jest',
                author: 'David Foster Wallace',
              }),
            },
          ],
        });

      vi.mocked(fetchUserReadingStatesProjection).mockResolvedValueOnce(
        new Map([
          [
            'book:lib-1:b1-reading',
            {id: 'book:lib-1:b1-reading', status: 'reading'},
          ],
          ['ext:9781635575637', {id: 'ext:9781635575637', status: 'finished'}],
          [
            'book:lib-2:b2-want-to-read',
            {id: 'book:lib-2:b2-want-to-read', status: 'want_to_read'},
          ],
          [
            'book:lib-2:b2-abandoned',
            {id: 'book:lib-2:b2-abandoned', status: 'abandoned'},
          ],
        ]),
      );

      const unread = await ReadingTrackerService.getUnreadLibraryBooks(
        'u1',
        'u1@example.com',
      );

      expect(unread).toHaveLength(2);
      expect(unread.map(b => b.title)).toEqual([
        'The Dispossessed',
        'Hyperion',
      ]);
      expect(unread[0].readingStatus).toBe('unset');
      expect(unread[0].libraryName).toBe('Home Library');
      expect(unread[1].readingStatus).toBe('want_to_read');
      expect(unread[1].libraryName).toBe('Shared Library');
    });
  });

  describe('searchUnifiedCatalog', () => {
    it('queries searchTokens via array-contains, overlays readingStates, and cross-references external catalog matches', async () => {
      const {fetchUserReadingStatesMap} = await import('../book');
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-1',
            name: 'Home Library',
            ownerId: 'u1',
            ownerName: 'Reader',
            callerRole: 'owner',
            createdAt: '2026-01-01',
            bookCount: 1,
          },
        ],
      });

      mockCollectionGet
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'book-1',
              data: () => ({
                title: 'Dune',
                author: 'Frank Herbert',
                isbn: '9780441172719',
                searchTokens: ['dune', 'frank', 'herbert'],
              }),
            },
          ],
        })
        .mockResolvedValueOnce({docs: []})
        .mockResolvedValueOnce({docs: []});

      vi.mocked(fetchUserReadingStatesMap).mockResolvedValueOnce(
        new Map([
          [
            'ext:9780441172719',
            {id: 'ext:9780441172719', status: 'finished', rating: 5},
          ],
        ]),
      );

      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue({
        books: [
          {
            title: 'Dune',
            author: 'Frank Herbert',
            isbn: '9780441172719',
            coverUrl: '',
            publishedDate: '1965',
          },
          {
            title: 'Dune Messiah',
            author: 'Frank Herbert',
            isbn: '9780593098233',
            coverUrl: '',
            publishedDate: '1969',
          },
        ],
        skippedProviders: [],
        respondedProviders: ['google-books'],
      });

      const result = await ReadingTrackerService.searchUnifiedCatalog(
        'u1',
        'u1@example.com',
        'Dune',
      );

      expect(mockWhere).toHaveBeenCalledWith(
        'searchTokens',
        'array-contains',
        'dune',
      );
      expect(catalogOrchestrator.searchByQuery).toHaveBeenCalledWith(
        {rawQuery: 'Dune', limit: 15},
        {priority: 'INTERACTIVE', verifyCovers: false},
      );
      expect(result.libraryMatches).toHaveLength(1);
      expect(result.libraryMatches[0].title).toBe('Dune');
      expect(result.libraryMatches[0].readingStatus).toBe('finished');
      expect(result.libraryMatches[0].userRating).toBe(5);
      expect(result.externalMatches).toHaveLength(2);
      expect(result.externalMatches[0].existingMatch?.libraryId).toBe('lib-1');
      expect(result.externalMatches[1].existingMatch).toBeUndefined();
    });

    it('matches multi-word title+author queries and series names via indexed searchTokens while filtering prefix false positives without fallback scans', async () => {
      const {fetchUserReadingStatesMap} = await import('../book');
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-mixed',
            name: 'Mixed Library',
            ownerId: 'u1',
            ownerName: 'Reader',
            callerRole: 'owner',
            createdAt: '2026-01-01',
            bookCount: 2,
          },
        ],
      });

      mockCollectionGet
        // 1. Indexed searchTokens query on lib-mixed returns both a prefix false positive ('herber' -> 'Herbarium') and the canonical indexed match
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'book-false-pos',
              data: () => ({
                title: 'The Royal Herbarium',
                author: 'Jane Botanist',
                searchTokens: ['royal', 'herber', 'herbarium'],
              }),
            },
            {
              id: 'book-indexed-dune',
              data: () => ({
                title: 'Dune',
                author: 'Frank Herbert',
                series: 'Dune Chronicles',
                searchTokens: ['dune', 'frank', 'herber', 'herbert'],
              }),
            },
          ],
        })
        // 2. virtual_u1 indexed query
        .mockResolvedValueOnce({docs: []});

      vi.mocked(fetchUserReadingStatesMap).mockResolvedValueOnce(new Map());
      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue({
        books: [],
        skippedProviders: [],
        respondedProviders: [],
      });

      const result = await ReadingTrackerService.searchUnifiedCatalog(
        'u1',
        'u1@example.com',
        'Dune Herbert',
      );

      expect(mockCollectionGet).toHaveBeenCalledTimes(2);
      expect(result.libraryMatches).toHaveLength(1);
      expect(result.libraryMatches[0].bookId).toBe('book-indexed-dune');
      expect(result.libraryMatches[0].series).toBe('Dune Chronicles');
    });

    it('merges searchByIsbn and searchByQuery results for ISBN queries', async () => {
      const {fetchUserReadingStatesMap} = await import('../book');
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [],
      });
      mockCollectionGet.mockResolvedValue({docs: []});
      vi.mocked(fetchUserReadingStatesMap).mockResolvedValueOnce(new Map());

      vi.mocked(catalogOrchestrator.searchByIsbn).mockResolvedValueOnce({
        title: 'Born a Crime',
        author: 'Trevor Noah',
        isbn: '9780399588174',
        coverUrl: 'https://example.com/born-a-crime.jpg',
        publishedDate: '2016-11-15',
      });
      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValueOnce({
        books: [
          {
            title: 'Born a Crime',
            author: 'Trevor Noah',
            isbn: '9780399588174',
            coverUrl: 'https://example.com/born-a-crime.jpg',
            publishedDate: '2016-11-15',
          },
        ],
        skippedProviders: [],
        respondedProviders: ['apple-books'],
      });

      const result = await ReadingTrackerService.searchUnifiedCatalog(
        'u1',
        'u1@example.com',
        '978-0399588174',
      );

      expect(catalogOrchestrator.searchByIsbn).toHaveBeenCalledWith(
        '9780399588174',
        {priority: 'INTERACTIVE', verifyCovers: false},
      );
      expect(result.externalMatches).toHaveLength(1);
      expect(result.externalMatches[0].title).toBe('Born a Crime');
    });
  });

  describe('trackBook', () => {
    it('commits status, rating, and review in a single addReview call when tracking an existing library book with review text', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);
      vi.mocked(BookService.addReview).mockResolvedValue({
        success: true,
        id: 'u1',
        rating: 4,
        reviewText: 'Excited to read',
        reviewedAt: '2026-11-15T00:00:00.000Z',
        userName: 'Reader',
      });

      const res = await ReadingTrackerService.trackBook(
        'u1',
        'u1@example.com',
        'Reader',
        {
          source: 'library',
          libraryId: 'lib-shared',
          bookId: 'book-1',
          status: 'want_to_read',
          rating: 4,
          reviewText: 'Excited to read',
        },
      );

      expect(res.libraryId).toBe('lib-shared');
      expect(res.bookId).toBe('book-1');
      expect(BookService.updateBookStatus).not.toHaveBeenCalled();
      expect(BookService.addReview).toHaveBeenCalledWith(
        'u1',
        'u1@example.com',
        'Reader',
        'lib-shared',
        'book-1',
        {
          rating: 4,
          text: 'Excited to read',
        },
        {skipAccessCheck: true, status: 'want_to_read'},
      );
    });

    it('updates status and rating in a single updateBookStatus call when rating is provided without review text', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);
      vi.mocked(BookService.updateBookStatus).mockResolvedValue({
        success: true,
        id: 'book-1',
        status: 'finished',
        stateKey: 'book:lib-shared:book-1',
      });

      const res = await ReadingTrackerService.trackBook(
        'u1',
        'u1@example.com',
        'Reader',
        {
          source: 'library',
          libraryId: 'lib-shared',
          bookId: 'book-1',
          status: 'finished',
          rating: 5,
        },
      );

      expect(res.status).toBe('finished');
      expect(BookService.updateBookStatus).toHaveBeenCalledWith(
        'u1',
        'lib-shared',
        'book-1',
        'finished',
        {rating: 5},
      );
      expect(BookService.addReview).not.toHaveBeenCalled();
    });

    it('queries cleanIsbn and dedupeKey indexes and creates an unowned book in virtual_${userId} when no match exists', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);
      mockCollectionGet.mockResolvedValue({docs: []});
      vi.mocked(BookService.createBook).mockResolvedValue({
        success: true,
        id: 'vbook-99',
        libraryBookCountDelta: 1,
      });

      const res = await ReadingTrackerService.trackBook(
        'u1',
        'u1@example.com',
        'Reader',
        {
          source: 'external',
          status: 'reading',
          bookData: {
            title: ' Piranesi ',
            author: 'Susanna Clarke',
            isbn: '978-1635575637',
          },
        },
      );

      expect(mockWhere).toHaveBeenCalledWith(
        'cleanIsbn',
        '==',
        '9781635575637',
      );
      expect(mockWhere).toHaveBeenCalledWith(
        'dedupeKey',
        '==',
        'piranesi::susanna clarke',
      );
      expect(res.libraryId).toBe('virtual_u1');
      expect(res.bookId).toBe('vbook-99');
      expect(res.ownershipStatus).toBe('unowned');
      expect(BookService.createBook).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          libraryId: 'virtual_u1',
          title: 'Piranesi',
          ownershipStatus: 'unowned',
          readingStatus: 'reading',
        }),
      );
    });

    it('reuses existing book in destination library when cleanIsbn index query matches', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);
      mockCollectionGet
        .mockResolvedValueOnce({
          docs: [{id: 'existing-book-42', data: () => ({title: 'Piranesi'})}],
        })
        .mockResolvedValueOnce({docs: []});
      vi.mocked(BookService.updateBookStatus).mockResolvedValue({
        success: true,
        id: 'existing-book-42',
        status: 'finished',
        stateKey: 'book:lib-home:existing-book-42',
      });

      const res = await ReadingTrackerService.trackBook(
        'u1',
        'u1@example.com',
        'Reader',
        {
          source: 'external',
          targetLibraryId: 'lib-home',
          status: 'finished',
          bookData: {
            title: 'Piranesi',
            author: 'Susanna Clarke',
            isbn: '9781635575637',
          },
        },
      );

      expect(res.bookId).toBe('existing-book-42');
      expect(BookService.createBook).not.toHaveBeenCalled();
      expect(BookService.updateBookStatus).toHaveBeenCalledWith(
        'u1',
        'lib-home',
        'existing-book-42',
        'finished',
        undefined,
      );
    });
  });
});
