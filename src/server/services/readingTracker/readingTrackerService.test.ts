import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ReadingTrackerService} from './index';
import {LibraryService} from '../library';
import {BookService, BookPartitioner} from '../book';
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
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getAdminDb).mockReturnValue({
      collection: vi.fn((colName: string) => {
        if (colName === 'libraries') {
          return {
            doc: vi.fn((libId: string) => ({
              id: libId,
              get: mockDocGet,
              set: mockDocSet,
              collection: vi.fn(() => ({
                get: mockCollectionGet,
                doc: vi.fn(() => ({
                  set: mockDocSet,
                })),
              })),
            })),
          };
        }
        return {};
      }),
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  describe('getPersonalReadingShelf', () => {
    it('aggregates tracked books across accessible libraries and virtual shelf with deduplication', async () => {
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-1',
            name: 'Home Library',
            ownerId: 'u1',
            ownerName: 'Reader',
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

      expect(summary.counts.all).toBe(2);
      expect(summary.counts.reading).toBe(1);
      expect(summary.counts.want_to_read).toBe(1);
      expect(summary.items[0].title).toBe('The Dispossessed');
      expect(summary.items[0].ownershipStatus).toBe('unowned');
      expect(summary.items[1].title).toBe('The Left Hand of Darkness');
      expect(summary.items[1].userRating).toBe(5);
    });
  });

  describe('searchUnifiedCatalog', () => {
    it('returns library matches and external catalog matches cross-referenced with library state', async () => {
      vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
        libraries: [
          {
            id: 'lib-1',
            name: 'Home Library',
            ownerId: 'u1',
            ownerName: 'Reader',
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
                userStatuses: {u1: 'finished'},
              }),
            },
          ],
        })
        .mockResolvedValueOnce({docs: []});

      vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue([
        {
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
        },
        {
          title: 'Dune Messiah',
          author: 'Frank Herbert',
          isbn: '9780593098233',
        },
      ]);

      const result = await ReadingTrackerService.searchUnifiedCatalog(
        'u1',
        'u1@example.com',
        'Dune',
      );

      expect(result.libraryMatches).toHaveLength(1);
      expect(result.libraryMatches[0].title).toBe('Dune');
      expect(result.externalMatches).toHaveLength(2);
      expect(result.externalMatches[0].existingMatch?.libraryId).toBe('lib-1');
      expect(result.externalMatches[1].existingMatch).toBeUndefined();
    });
  });

  describe('trackBook', () => {
    it('updates status and adds review when tracking an existing library book', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('viewer');
      vi.mocked(BookService.updateBookStatus).mockResolvedValue({
        success: true,
        id: 'book-1',
        status: 'want_to_read',
      });
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
      expect(BookService.updateBookStatus).toHaveBeenCalledWith(
        'u1',
        'lib-shared',
        'book-1',
        'want_to_read',
      );
      expect(BookService.addReview).toHaveBeenCalled();
    });

    it('creates an unowned book in virtual_${userId} when tracking an external book without targetLibraryId', async () => {
      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue('owner');
      mockCollectionGet.mockResolvedValueOnce({docs: []});
      vi.mocked(BookService.createBook).mockResolvedValue({
        success: true,
        id: 'vbook-99',
      });
      vi.mocked(BookPartitioner.partitionBookPayload).mockReturnValue({
        coreBook: {},
        bookDetails: {},
        hasDetailsMutations: false,
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
            isbn: '9781635575637',
          },
        },
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
  });
});
