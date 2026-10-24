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

vi.mock('../book', () => ({
  BookService: {
    updateBookStatus: vi.fn(),
    addReview: vi.fn(),
    createBook: vi.fn(),
  },
  BookPartitioner: {
    partitionBookPayload: vi.fn(),
    mergeBookAndDetails: vi.fn((id: string, data: Record<string, unknown>) => ({
      id,
      ...data,
    })),
  },
}));

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
  const mockLimit = vi.fn();
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    const queryChain = {
      where: mockWhere,
      limit: mockLimit,
      get: mockCollectionGet,
      doc: vi.fn(() => ({
        set: mockDocSet,
      })),
    };
    mockWhere.mockReturnValue(queryChain);
    mockLimit.mockReturnValue(queryChain);

    vi.mocked(getAdminDb).mockReturnValue({
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
    it('queries non-virtual libraries using FieldPath userStatuses in filter and aggregates virtual shelf', async () => {
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

      mockCollectionGet
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'book-1',
              data: () => ({
                title: 'The Left Hand of Darkness',
                author: 'Ursula K. Le Guin',
                isbn: '9780441478125',
                userStatuses: {u1: 'reading'},
                userRatings: {u1: 5},
                updatedAt: '2026-02-01T00:00:00.000Z',
              }),
            },
          ],
        })
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'vbook-1',
              data: () => ({
                title: 'The Dispossessed',
                author: 'Ursula K. Le Guin',
                isbn: '9780061054884',
                ownershipStatus: 'unowned',
                userStatuses: {u1: 'want_to_read'},
                updatedAt: '2026-02-02T00:00:00.000Z',
              }),
            },
          ],
        });

      const summary = await ReadingTrackerService.getPersonalReadingShelf(
        'u1',
        'u1@example.com',
        {shelf: 'all'},
      );

      expect(mockWhere).toHaveBeenCalledWith(
        expect.anything(),
        'in',
        expect.arrayContaining([
          'want_to_read',
          'reading',
          'finished',
          'completed',
          'abandoned',
        ]),
      );
      expect(summary.counts.all).toBe(2);
      expect(summary.counts.reading).toBe(1);
      expect(summary.counts.want_to_read).toBe(1);
      expect(summary.items[0].title).toBe('The Dispossessed');
      expect(summary.items[0].ownershipStatus).toBe('unowned');
      expect(summary.items[1].title).toBe('The Left Hand of Darkness');
      expect(summary.items[1].userRating).toBe(5);
    });
  });

  describe('getUnreadLibraryBooks', () => {
    it('returns unset and want_to_read books across non-virtual libraries while excluding books read/reading/abandoned in any library or virtual shelf', async () => {
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
                isbn: '9780061054884',
              }),
            },
            {
              id: 'b1-reading',
              data: () => ({
                title: 'Project Hail Mary',
                author: 'Andy Weir',
                userStatuses: {u1: 'reading'},
              }),
            },
            {
              id: 'b1-read-on-virtual',
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
                userStatuses: {u1: 'want_to_read'},
              }),
            },
            {
              id: 'b2-abandoned',
              data: () => ({
                title: 'Infinite Jest',
                author: 'David Foster Wallace',
                userStatuses: {u1: 'abandoned'},
              }),
            },
          ],
        })
        // virtual_u1 active/finished/abandoned query
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'v-piranesi',
              data: () => ({
                title: 'Piranesi',
                author: 'Susanna Clarke',
                isbn: '9781635575637',
                userStatuses: {u1: 'finished'},
              }),
            },
          ],
        });

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
    it('queries searchTokens via array-contains and cross-references external catalog matches', async () => {
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
                userStatuses: {u1: 'finished'},
              }),
            },
          ],
        })
        .mockResolvedValueOnce({docs: []})
        .mockResolvedValueOnce({docs: []});

      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue([
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
      ]);

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
      expect(result.libraryMatches).toHaveLength(1);
      expect(result.libraryMatches[0].title).toBe('Dune');
      expect(result.externalMatches).toHaveLength(2);
      expect(result.externalMatches[0].existingMatch?.libraryId).toBe('lib-1');
      expect(result.externalMatches[1].existingMatch).toBeUndefined();
    });

    it('matches multi-word title+author queries, series names, and falls back to unindexed docs when indexed prefix match is a false positive', async () => {
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
        // 1. Indexed searchTokens query on lib-mixed returns a false-positive prefix hit ('herber' -> 'Herbarium')
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
          ],
        })
        // 2. Fallback scan on lib-mixed returns both the indexed false positive and an unindexed legacy book
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
              id: 'book-legacy-dune',
              data: () => ({
                title: 'Dune',
                author: 'Frank Herbert',
                series: 'Dune Chronicles',
              }),
            },
          ],
        })
        // 3. virtual_u1 indexed query
        .mockResolvedValueOnce({docs: []})
        // 4. virtual_u1 fallback scan
        .mockResolvedValueOnce({docs: []});

      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue([]);

      const result = await ReadingTrackerService.searchUnifiedCatalog(
        'u1',
        'u1@example.com',
        'Dune Herbert',
      );

      expect(result.libraryMatches).toHaveLength(1);
      expect(result.libraryMatches[0].bookId).toBe('book-legacy-dune');
      expect(result.libraryMatches[0].series).toBe('Dune Chronicles');
    });
  });

  describe('trackBook', () => {
    it('commits status, rating, and review in a single addReview call when tracking an existing library book with review text', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('viewer');
      vi.mocked(BookService.addReview).mockResolvedValue({
        success: true,
        id: 'rev-1',
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
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('viewer');
      vi.mocked(BookService.updateBookStatus).mockResolvedValue({
        success: true,
        id: 'book-1',
        status: 'finished',
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
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('owner');
      mockCollectionGet.mockResolvedValue({docs: []});
      vi.mocked(BookService.createBook).mockResolvedValue({
        success: true,
        id: 'vbook-99',
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
          status: 'reading',
        }),
      );
    });

    it('reuses existing book in destination library when cleanIsbn index query matches', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('editor');
      mockCollectionGet
        .mockResolvedValueOnce({
          docs: [{id: 'existing-book-42', data: () => ({title: 'Piranesi'})}],
        })
        .mockResolvedValueOnce({docs: []});
      vi.mocked(BookService.updateBookStatus).mockResolvedValue({
        success: true,
        id: 'existing-book-42',
        status: 'finished',
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
