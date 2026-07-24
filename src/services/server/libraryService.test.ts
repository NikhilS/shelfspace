import {describe, it, expect, vi, beforeEach} from 'vitest';
import {LibraryService} from './libraryService';
import {TRPCError} from '@trpc/server';

const mockLibGet = vi.fn();
const mockBooksGet = vi.fn();
const mockBookDocGet = vi.fn();

const mockCollection = vi.fn((path: string) => {
  if (path === 'libraries') {
    return {
      doc: vi.fn((libId: string) => ({
        get: mockLibGet,
        collection: vi.fn((subPath: string) => {
          if (subPath === 'books') {
            return {
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  get: mockBooksGet,
                })),
                startAfter: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    get: mockBooksGet,
                  })),
                })),
              })),
              doc: vi.fn(() => ({
                get: mockBookDocGet,
              })),
            };
          }
          return {};
        }),
      })),
      get: mockLibGet,
    };
  }
  return {};
});

vi.mock('./firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
  }),
}));

describe('LibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyLibraryAccess', () => {
    it('throws UNAUTHORIZED if userId is empty', async () => {
      await expect(
        LibraryService.verifyLibraryAccess('', 'test@example.com', 'lib1', 'viewer'),
      ).rejects.toThrow(TRPCError);
    });

    it('throws NOT_FOUND if library document does not exist', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: false,
      });

      await expect(
        LibraryService.verifyLibraryAccess('u1', 'test@example.com', 'nonexistent', 'viewer'),
      ).rejects.toThrow("Library 'nonexistent' not found");
    });

    it('grants access to library owner', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'owner_123',
          access: {},
        }),
      });

      const granted = await LibraryService.verifyLibraryAccess(
        'owner_123',
        'owner@example.com',
        'lib1',
        'editor',
      );
      expect(granted).toBe(true);
    });

    it('grants access via access map (case-insensitive email matching)', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'some_other_owner',
          access: {
            'editor@example.com': 'editor',
          },
        }),
      });

      const granted = await LibraryService.verifyLibraryAccess(
        'user_456',
        'Editor@Example.com', // Uppercase test
        'lib1',
        'editor',
      );
      expect(granted).toBe(true);
    });

    it('denies access if user role in access map is below required role', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'some_other_owner',
          access: {
            'viewer@example.com': 'viewer',
          },
        }),
      });

      await expect(
        LibraryService.verifyLibraryAccess(
          'user_789',
          'viewer@example.com',
          'lib1',
          'editor', // Requires editor, but user is viewer
        ),
      ).rejects.toThrow("Required role 'editor', but caller has 'viewer'");
    });

    it('denies access if user is not owner and not in access map', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'owner_123',
          access: {
            'friend@example.com': 'viewer',
          },
        }),
      });

      await expect(
        LibraryService.verifyLibraryAccess(
          'intruder_uid',
          'stranger@example.com',
          'lib1',
          'viewer',
        ),
      ).rejects.toThrow("Access denied: You do not have permission to access library 'lib1'");
    });
  });

  describe('getUserLibraries', () => {
    it('returns libraries accessible to caller with assigned callerRole', async () => {
      const mockDocs = [
        {
          id: 'lib_owned',
          data: () => ({
            name: 'Owned Library',
            ownerId: 'user_1',
            access: {'user_1@example.com': 'owner'},
            bookCount: 10,
            createdAt: '2026-01-01T00:00:00.000Z',
          }),
        },
        {
          id: 'lib_shared',
          data: () => ({
            name: 'Shared Library',
            ownerId: 'other_owner',
            access: {'user_1@example.com': 'editor'},
            bookCount: 5,
            createdAt: '2026-02-01T00:00:00.000Z',
          }),
        },
        {
          id: 'lib_inaccessible',
          data: () => ({
            name: 'Private Library',
            ownerId: 'stranger',
            access: {},
            bookCount: 100,
          }),
        },
      ];

      mockLibGet.mockResolvedValueOnce({
        forEach: (cb: (doc: unknown) => void) => mockDocs.forEach(cb),
      });

      const result = await LibraryService.getUserLibraries('user_1', 'user_1@example.com');

      expect(result.libraries.length).toBe(2);
      expect(result.libraries[0].id).toBe('lib_owned');
      expect(result.libraries[0].callerRole).toBe('owner');
      expect(result.libraries[1].id).toBe('lib_shared');
      expect(result.libraries[1].callerRole).toBe('editor');
    });
  });

  describe('getFilteredBooks', () => {
    it('retrieves books and calculates metadata status flags correctly', async () => {
      // 1. Mock verify access
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'u1',
          access: {},
        }),
      });

      // 2. Mock books collection
      const mockBookDocs = [
        {
          id: 'b1',
          data: () => ({
            title: 'Complete Book',
            author: 'Author A',
            synopsis: 'A great tale',
            genre: ['Fantasy'],
            coverUrl: 'https://example.com/cover.jpg',
            geoMetadata: {locations: [{name: 'Paris'}]},
            temporalMetadata: {startYear: 1800, eraName: '19th Century'},
            addedAt: '2026-01-01',
          }),
        },
        {
          id: 'b2',
          data: () => ({
            title: 'Incomplete Book',
            author: 'Author B',
            addedAt: '2026-01-02',
          }),
        },
      ];

      mockBooksGet.mockResolvedValueOnce({
        forEach: (cb: (doc: unknown) => void) => mockBookDocs.forEach(cb),
      });

      const res = await LibraryService.getFilteredBooks('u1', 'u1@example.com', {
        libraryId: 'lib1',
        limit: 50,
      });

      expect(res.books.length).toBe(2);

      const b1 = res.books[0];
      expect(b1.metadataStatus).toEqual({
        hasGeo: true,
        hasTemporal: true,
        hasGenre: true,
        hasSynopsis: true,
        hasCoverImage: true,
      });

      const b2 = res.books[1];
      expect(b2.metadataStatus).toEqual({
        hasGeo: false,
        hasTemporal: false,
        hasGenre: false,
        hasSynopsis: false,
        hasCoverImage: false,
      });
    });

    it('filters books by missing metadata criteria (e.g. missing cover image)', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'u1',
        }),
      });

      const mockBookDocs = [
        {
          id: 'b1',
          data: () => ({
            title: 'With Cover',
            author: 'Author A',
            coverUrl: 'https://example.com/cover.jpg',
          }),
        },
        {
          id: 'b2',
          data: () => ({
            title: 'Without Cover',
            author: 'Author B',
          }),
        },
      ];

      mockBooksGet.mockResolvedValueOnce({
        forEach: (cb: (doc: unknown) => void) => mockBookDocs.forEach(cb),
      });

      const res = await LibraryService.getFilteredBooks('u1', 'u1@example.com', {
        libraryId: 'lib1',
        filters: {
          missingMetadata: 'coverImage',
        },
        limit: 50,
      });

      expect(res.books.length).toBe(1);
      expect(res.books[0].id).toBe('b2');
      expect(res.books[0].title).toBe('Without Cover');
    });
  });
});
