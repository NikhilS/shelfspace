import {describe, it, expect, vi, beforeEach} from 'vitest';
import {LibraryService} from './index';
import {TRPCError} from '@trpc/server';

const mockLibGet = vi.fn();
const mockLibWhereGet = vi.fn();
const mockLibWhere = vi.fn(() => ({
  get: mockLibWhereGet,
}));
const mockBooksGet = vi.fn();
const mockBookDocGet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBatch = vi.fn(() => ({
  update: mockBatchUpdate,
  commit: mockBatchCommit,
}));

const mockCollection = vi.fn((path: string) => {
  if (path === 'libraries') {
    return {
      doc: vi.fn((libId: string) => ({
        get: mockLibGet,
        collection: vi.fn((subPath: string) => {
          if (subPath === 'books') {
            return {
              get: mockBooksGet,
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
      where: mockLibWhere,
    };
  }
  return {};
});

vi.mock('../firebaseAdmin', () => ({
  getAdminApp: () => ({}),
  firebaseConfig: {
    projectId: 'test-project',
    storageBucket: 'test-project.firebasestorage.app',
  },
  getAdminDb: () => ({
    collection: mockCollection,
    batch: mockBatch,
  }),
  formatFirestoreAdminError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

describe('LibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyLibraryAccess', () => {
    it('grants access immediately to SUPERADMIN_EMAIL', async () => {
      const result = await LibraryService.verifyLibraryAccess(
        'admin_uid',
        'nikhil.singhal@gmail.com',
        'any_lib',
        'owner',
      );
      expect(result).toBe(true);
      expect(mockLibGet).not.toHaveBeenCalled();
    });

    it('throws INTERNAL_SERVER_ERROR when Firestore throws PERMISSION_DENIED', async () => {
      mockLibGet.mockRejectedValueOnce(
        new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'),
      );

      await expect(
        LibraryService.verifyLibraryAccess(
          'u1',
          'regular@example.com',
          'lib1',
          'editor',
        ),
      ).rejects.toThrow(TRPCError);
    });

    it('throws UNAUTHORIZED if userId is empty', async () => {
      await expect(
        LibraryService.verifyLibraryAccess(
          '',
          'test@example.com',
          'lib1',
          'viewer',
        ),
      ).rejects.toThrow(TRPCError);
    });

    it('throws NOT_FOUND if library document does not exist', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: false,
      });

      await expect(
        LibraryService.verifyLibraryAccess(
          'u1',
          'test@example.com',
          'nonexistent',
          'viewer',
        ),
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
      ).rejects.toThrow(
        "Access denied: You do not have permission to access library 'lib1'",
      );
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

      mockLibWhereGet
        .mockResolvedValueOnce({
          forEach: (cb: (doc: unknown) => void) => [mockDocs[0]].forEach(cb),
        })
        .mockResolvedValueOnce({
          forEach: (cb: (doc: unknown) => void) => [mockDocs[1]].forEach(cb),
        });

      const result = await LibraryService.getUserLibraries(
        'user_1',
        'user_1@example.com',
      );

      expect(result.libraries.length).toBe(2);
      expect(result.libraries[0].id).toBe('lib_owned');
      expect(result.libraries[0].callerRole).toBe('owner');
      expect(result.libraries[0].ownershipType).toBe('owned');
      expect(result.libraries[1].id).toBe('lib_shared');
      expect(result.libraries[1].callerRole).toBe('editor');
      expect(result.libraries[1].ownershipType).toBe('shared');
    });

    it('returns all system libraries with global_admin type for super admin with scope all', async () => {
      const mockDocs = [
        {
          id: 'lib_owned',
          data: () => ({
            name: 'Owned Library',
            ownerId: 'superadmin_id',
            access: {},
          }),
        },
        {
          id: 'lib_other',
          data: () => ({
            name: 'Other User Library',
            ownerId: 'stranger_id',
            access: {},
          }),
        },
      ];

      mockLibGet.mockResolvedValueOnce({
        forEach: (cb: (doc: unknown) => void) => mockDocs.forEach(cb),
      });

      const result = await LibraryService.getUserLibraries(
        'superadmin_id',
        'nikhil.singhal@gmail.com',
        ['all'],
        true,
      );

      expect(result.libraries.length).toBe(2);
      expect(result.libraries[0].id).toBe('lib_owned');
      expect(result.libraries[0].ownershipType).toBe('owned');
      expect(result.libraries[1].id).toBe('lib_other');
      expect(result.libraries[1].callerRole).toBe('admin');
      expect(result.libraries[1].ownershipType).toBe('global_admin');
    });
  });

  describe('getLibrary with prefetched context data', () => {
    it('reuses prefetched library data and callerRole without extra Firestore reads', async () => {
      const lib = await LibraryService.getLibrary(
        'u1',
        'u1@example.com',
        'lib1',
        {
          skipAccessCheck: true,
          prefetchedData: {
            name: 'Prefetched Archive',
            ownerId: 'u1',
            ownerName: 'Archivist',
            bookCount: 42,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          callerRole: 'owner',
        },
      );

      expect(mockLibGet).not.toHaveBeenCalled();
      expect(lib.id).toBe('lib1');
      expect(lib.name).toBe('Prefetched Archive');
      expect(lib.callerRole).toBe('owner');
      expect(lib.isOwner).toBe(true);
      expect(lib.canEdit).toBe(true);
    });
  });

  describe('resetMetadata', () => {
    it('resets genre taxonomy fields across all books using FieldValue.delete()', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'u1',
        }),
      });

      const mockRef1 = {id: 'b1'};
      const mockRef2 = {id: 'b2'};

      mockBooksGet.mockResolvedValueOnce({
        empty: false,
        size: 2,
        docs: [
          {
            ref: mockRef1,
            data: () => ({
              primaryGenre: 'Science Fiction',
              subgenres: ['Cyberpunk'],
            }),
          },
          {
            ref: mockRef2,
            data: () => ({
              primaryGenre: 'History',
              isCustomPrimary: false,
            }),
          },
        ],
      });

      const result = await LibraryService.resetMetadata(
        'u1',
        'u1@example.com',
        'lib1',
        'genre',
      );

      expect(result.count).toBe(2);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
      expect(mockBatchCommit).toHaveBeenCalled();
    });

    it('resets specified metadata category across all books', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'u1',
        }),
      });

      const mockRef = {id: 'b1'};

      mockBooksGet.mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [{ref: mockRef, data: () => ({geoMetadata: {locations: []}})}],
      });

      const result = await LibraryService.resetMetadata(
        'u1',
        'u1@example.com',
        'lib1',
        'geo',
      );

      expect(result.count).toBe(1);
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        mockRef,
        expect.objectContaining({
          geoMetadata: expect.anything(),
          'enrichmentStatus.geo': expect.anything(),
        }),
      );
    });

    it('returns count 0 if library has no books', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'u1',
        }),
      });

      mockBooksGet.mockResolvedValueOnce({
        empty: true,
        size: 0,
        docs: [],
      });

      const result = await LibraryService.resetMetadata(
        'u1',
        'u1@example.com',
        'lib1',
        'genre',
      );
      expect(result.count).toBe(0);
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });
  });

  describe('uploadImage', () => {
    it('rejects paths outside the target library directory', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ownerId: 'u1'}),
      });

      await expect(
        LibraryService.uploadImage(
          'u1',
          'u1@example.com',
          'lib1',
          'libraries/other_lib/hero.png',
          'data:image/png;base64,iVBORw0KGgo=',
        ),
      ).rejects.toThrow("Invalid storage path 'libraries/other_lib/hero.png'");
    });

    it('returns non-data URLs directly without uploading', async () => {
      mockLibGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ownerId: 'u1'}),
      });

      const res = await LibraryService.uploadImage(
        'u1',
        'u1@example.com',
        'lib1',
        'libraries/lib1/hero.png',
        'https://example.com/existing.png',
      );
      expect(res.url).toBe('https://example.com/existing.png');
    });
  });
});
