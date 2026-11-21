import {describe, it, expect, vi, beforeEach} from 'vitest';
import {TRPCError} from '@trpc/server';
import {LibraryService, LibraryMetadataCache} from './index';
import {AllowlistService} from '../../auth/allowlistService';
import * as adminModule from '../firebaseAdmin';
import {
  createFakeFirestore,
  type FakeFirestore,
} from '../../testing/fakeFirestore';

describe('LibraryService — FakeFirestore Integration & Collaborator Indexes', () => {
  let fake: FakeFirestore;

  beforeEach(() => {
    vi.restoreAllMocks();
    LibraryMetadataCache.clear();
    AllowlistService.clearCache();
    const created = createFakeFirestore();
    fake = created.fake;
    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue(created.db);
  });

  describe('verifyLibraryAccess', () => {
    it('grants access immediately to SUPERADMIN_EMAIL without reading Firestore', async () => {
      const colSpy = vi.spyOn(fake, 'collection');
      const result = await LibraryService.verifyLibraryAccess(
        'admin_uid',
        'nikhil.singhal@gmail.com',
        'any_lib',
        'owner',
      );
      expect(result).toBe(true);
      expect(colSpy).not.toHaveBeenCalled();
    });

    it('throws INTERNAL_SERVER_ERROR when Firestore throws PERMISSION_DENIED', async () => {
      vi.spyOn(fake, 'readDocSnapshot').mockImplementationOnce(() => {
        throw new Error(
          '7 PERMISSION_DENIED: Missing or insufficient permissions.',
        );
      });

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
      await expect(
        LibraryService.verifyLibraryAccess(
          'u1',
          'test@example.com',
          'nonexistent',
          'viewer',
        ),
      ).rejects.toThrow("Library 'nonexistent' not found");
    });

    it('grants access to library owner and case-insensitive collaborators, and enforces role hierarchy', async () => {
      fake.seedDoc('libraries/lib1', {
        name: 'Shared Archive',
        ownerId: 'owner_123',
        access: {
          'editor@example.com': 'editor',
          'viewer@example.com': 'viewer',
        },
        collaboratorEmails: ['editor@example.com', 'viewer@example.com'],
      });

      await expect(
        LibraryService.verifyLibraryAccess(
          'owner_123',
          'owner@example.com',
          'lib1',
          'editor',
        ),
      ).resolves.toBe(true);

      await expect(
        LibraryService.verifyLibraryAccess(
          'user_456',
          'Editor@Example.com',
          'lib1',
          'editor',
        ),
      ).resolves.toBe(true);

      LibraryMetadataCache.clear();
      await expect(
        LibraryService.verifyLibraryAccess(
          'user_789',
          'viewer@example.com',
          'lib1',
          'editor',
        ),
      ).rejects.toThrow("Required role 'editor', but caller has 'viewer'");

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

    it('auto-provisions virtual_<userId> personal reading shelf without mock guards', async () => {
      const ok = await LibraryService.verifyLibraryAccess(
        'u_virtual',
        'reader@example.com',
        'virtual_u_virtual',
        'owner',
      );
      expect(ok).toBe(true);
      expect(fake.inspectDoc('libraries/virtual_u_virtual')).toMatchObject({
        ownerId: 'u_virtual',
        isVirtual: true,
      });
    });
  });

  describe('createLibrary, upsertCollaborator, removeCollaborator & getUserLibraries', () => {
    it('maintains collaboratorEmails array on create/upsert/remove and queries shared libraries via array-contains', async () => {
      const created = await LibraryService.createLibrary(
        'owner_1',
        'Owner@Example.com',
        'Owner One',
        {name: 'Main Library'},
      );

      expect(
        fake.inspectDoc(`libraries/${created.id}`)?.collaboratorEmails,
      ).toEqual(['owner@example.com']);

      fake.seedDoc('appSettings/allowlist/users/friend@example.com', {
        email: 'friend@example.com',
        role: 'user',
      });

      const upserted = await LibraryService.upsertCollaborator(
        'owner_1',
        'owner@example.com',
        created.id,
        'Friend@Example.com',
        'editor',
      );
      expect(upserted.allowlistStatus).toBe('approved');
      expect(
        fake.inspectDoc(`libraries/${created.id}`)?.collaboratorEmails,
      ).toEqual(
        expect.arrayContaining(['owner@example.com', 'friend@example.com']),
      );

      const friendLibs = await LibraryService.getUserLibraries(
        'friend_uid',
        'Friend@Example.com',
      );
      expect(friendLibs.libraries).toHaveLength(1);
      expect(friendLibs.libraries[0]).toMatchObject({
        id: created.id,
        callerRole: 'editor',
        ownershipType: 'shared',
      });

      await LibraryService.removeCollaborator(
        'owner_1',
        'owner@example.com',
        created.id,
        'friend@example.com',
      );
      const afterRemove = await LibraryService.getUserLibraries(
        'friend_uid',
        'friend@example.com',
      );
      expect(afterRemove.libraries).toHaveLength(0);
    });

    it('returns all system libraries with global_admin type for super admin with scope all', async () => {
      fake.seedDoc('libraries/lib_owned', {
        name: 'Owned Library',
        ownerId: 'superadmin_id',
        access: {},
      });
      fake.seedDoc('libraries/lib_other', {
        name: 'Other User Library',
        ownerId: 'stranger_id',
        access: {},
      });

      const result = await LibraryService.getUserLibraries(
        'superadmin_id',
        'nikhil.singhal@gmail.com',
        ['all'],
        true,
      );

      expect(result.libraries.length).toBe(2);
      expect(
        result.libraries.find(l => l.id === 'lib_other')?.ownershipType,
      ).toBe('global_admin');
    });

    it('self-heals residual deprecated sharedWith fields on Firestore library snapshots while still rejecting arbitrary unknown shadow fields', async () => {
      fake.seedDoc('libraries/7Y8kXlJv96sjul1bXVT9', {
        name: 'Primary Library',
        ownerId: 'owner_1',
        access: {'owner@example.com': 'owner'},
        collaboratorEmails: ['owner@example.com'],
        sharedWith: ['legacy-collab@example.com'],
      });

      const listed = await LibraryService.getUserLibraries(
        'owner_1',
        'owner@example.com',
      );
      expect(listed.libraries).toHaveLength(1);
      expect(listed.libraries[0]?.id).toBe('7Y8kXlJv96sjul1bXVT9');

      // Flush microtask queue so fire-and-forget FieldValue.delete() self-heal settles
      await new Promise(resolve => setTimeout(resolve, 0));

      const healedOnDisk = fake.inspectDoc('libraries/7Y8kXlJv96sjul1bXVT9');
      expect(healedOnDisk).toBeDefined();
      expect(healedOnDisk && 'sharedWith' in healedOnDisk).toBe(false);

      // Arbitrary unknown shadow fields must still fail strictStoredLibraryDoc validation
      fake.seedDoc('libraries/lib_shadow_drift', {
        name: 'Drifted Library',
        ownerId: 'owner_1',
        unexpectedShadowField: 'should-fail',
      });

      await expect(
        LibraryService.getUserLibraries('owner_1', 'owner@example.com'),
      ).rejects.toThrow(/Unrecognized key/);
    });
  });

  describe('getLibrary with prefetched context data', () => {
    it('reuses prefetched library data and callerRole without extra Firestore reads', async () => {
      const readSpy = vi.spyOn(fake, 'readDocSnapshot');
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

      expect(readSpy).not.toHaveBeenCalled();
      expect(lib.name).toBe('Prefetched Archive');
      expect(lib.canEdit).toBe(true);
    });
  });

  describe('resetMetadata & uploadImage', () => {
    it('resets genre taxonomy fields only on books that include genre, clears stale provenance, and stamps updatedAt', async () => {
      fake.seedDoc('libraries/lib1', {
        name: 'Test Lib',
        ownerId: 'u1',
      });
      fake.seedDoc('libraries/lib1/books/b1', {
        id: 'b1',
        title: 'Book 1',
        author: 'Author 1',
        primaryGenre: 'Science Fiction',
        primaryGenreLower: 'science fiction',
        subgenres: ['Cyberpunk'],
        fieldSources: {genre: 'Google Books', primaryGenre: 'Google Books'},
        skippedProviders: ['Open Library'],
        missingFlags: ['geo'],
      });
      fake.seedDoc('libraries/lib1/books/b2', {
        id: 'b2',
        title: 'Book 2 Without Genre',
        author: 'Author 2',
        missingFlags: ['genre', 'geo'],
      });

      const result = await LibraryService.resetMetadata(
        'u1',
        'u1@example.com',
        'lib1',
        'genre',
      );

      expect(result.count).toBe(1);
      const b1 = fake.inspectDoc('libraries/lib1/books/b1');
      expect(b1?.primaryGenre).toBeUndefined();
      expect(b1?.primaryGenreLower).toBeUndefined();
      expect(b1?.skippedProviders).toBeUndefined();
      expect(
        (b1?.fieldSources as Record<string, unknown> | undefined)?.genre,
      ).toBeUndefined();
      expect(b1?.updatedAt).toBeDefined();
      expect(b1?.missingFlags).toEqual(
        expect.arrayContaining(['geo', 'genre']),
      );

      const b2 = fake.inspectDoc('libraries/lib1/books/b2');
      expect(b2?.updatedAt).toBeUndefined();
    });

    it('self-heals missing collaboratorEmails on pre-migration shared libraries and backfills missing book index fields on read', async () => {
      const {bookDocConverter} = await import('../book/bookPartitioner');
      fake.seedDoc('libraries/lib_legacy_shared', {
        name: 'Legacy Shared Shelf',
        ownerId: 'owner_99',
        access: {
          'owner99@example.com': 'owner',
          'CollabReader@Example.com': 'editor',
        },
      });
      fake.seedDoc('libraries/lib_legacy_shared/books/b_legacy', {
        title: 'Piranesi',
        author: 'Susanna Clarke',
        isbn: '978-1-63557-563-7',
        primaryGenre: 'Fantasy',
        addedAt: '2025-05-01T00:00:00.000Z',
      });

      // Owner reads the library once -> self-heals collaboratorEmails onto Firestore
      await LibraryService.getLibrary(
        'owner_99',
        'owner99@example.com',
        'lib_legacy_shared',
      );
      await new Promise(resolve => setTimeout(resolve, 10));

      const healedLib = fake.inspectDoc('libraries/lib_legacy_shared');
      expect(healedLib?.collaboratorEmails).toEqual(
        expect.arrayContaining([
          'owner99@example.com',
          'collabreader@example.com',
        ]),
      );

      // Collaborator can now discover the shared library via array-contains
      const collabLibs = await LibraryService.getUserLibraries(
        'collab_uid',
        'collabreader@example.com',
      );
      expect(collabLibs.libraries.map(l => l.id)).toContain(
        'lib_legacy_shared',
      );

      // Reading the legacy book queues a background self-heal for all 5 index fields
      const rawBook =
        fake.inspectDoc('libraries/lib_legacy_shared/books/b_legacy') || {};
      bookDocConverter.fromFirestore(
        'b_legacy',
        rawBook,
        '/libraries/lib_legacy_shared/books/b_legacy',
      );
      await new Promise(resolve => setTimeout(resolve, 40));

      const healedBook = fake.inspectDoc(
        'libraries/lib_legacy_shared/books/b_legacy',
      );
      expect(healedBook?.cleanIsbn).toBe('9781635575637');
      expect(healedBook?.dedupeKey).toBeTruthy();
      expect(Array.isArray(healedBook?.searchTokens)).toBe(true);
      expect(healedBook?.primaryGenreLower).toBe('fantasy');
      expect(Array.isArray(healedBook?.missingFlags)).toBe(true);
    });

    it('rejects paths outside the target library directory and returns non-data http URLs directly', async () => {
      fake.seedDoc('libraries/lib1', {
        name: 'Test Lib',
        ownerId: 'u1',
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

  describe('getCollaboratorStatuses & deleteLibrary subcollection cleanup', () => {
    it('resolves non-owner collaborator statuses in bulk and deletes books, bookDetails, reviews, allowedDuplicates, jobs, and tombstones on deleteLibrary', async () => {
      fake.seedDoc('appSettings/allowlist/users/approved@example.com', {
        email: 'approved@example.com',
        role: 'user',
      });

      const collabRes = await LibraryService.getCollaboratorStatuses(
        'u1',
        'owner@example.com',
        'lib1',
        {
          skipAccessCheck: true,
          prefetchedData: {
            name: 'Lib 1',
            ownerId: 'u1',
            access: {
              'owner@example.com': 'owner',
              'approved@example.com': 'editor',
              'pending@example.com': 'viewer',
            },
          },
        },
      );
      expect(collabRes.collaborators).toEqual([
        {
          email: 'owner@example.com',
          role: 'owner',
          allowlistStatus: 'approved',
        },
        {
          email: 'approved@example.com',
          role: 'editor',
          allowlistStatus: 'approved',
        },
        {
          email: 'pending@example.com',
          role: 'viewer',
          allowlistStatus: 'pending_approval',
        },
      ]);

      fake.seedDoc('libraries/lib1', {name: 'Lib 1', ownerId: 'u1'});
      fake.seedDoc('libraries/lib1/books/b1', {
        id: 'b1',
        title: 'Book 1',
        author: 'Author 1',
      });
      fake.seedDoc('libraries/lib1/bookDetails/b1', {synopsis: 'Text'});
      fake.seedDoc('libraries/lib1/books/b1/reviews/rev1', {
        userId: 'u1',
        rating: 5,
        text: 'Great',
      });
      fake.seedDoc('libraries/lib1/allowedDuplicates/dup1', {
        bookIds: ['b1', 'b2'],
      });
      fake.seedDoc('libraries/lib1/jobs/job1', {
        libraryId: 'lib1',
        enrichmentType: 'genre',
        status: 'completed',
        totalBooks: 1,
        completedBooks: 1,
        failedBooks: 0,
        skippedBooks: 0,
        overwrite: false,
        startedAt: 1,
        updatedAtMs: 2,
      });
      fake.seedDoc('libraries/lib1/tombstones/old_book', {
        id: 'old_book',
        libraryId: 'lib1',
        deletedAtMs: 100,
      });

      const delRes = await LibraryService.deleteLibrary(
        'u1',
        'owner@example.com',
        'lib1',
        {skipAccessCheck: true},
      );
      expect(delRes.success).toBe(true);
      expect(fake.inspectDoc('libraries/lib1')).toBeUndefined();
      expect(fake.inspectDoc('libraries/lib1/books/b1')).toBeUndefined();
      expect(fake.inspectDoc('libraries/lib1/bookDetails/b1')).toBeUndefined();
      expect(
        fake.inspectDoc('libraries/lib1/books/b1/reviews/rev1'),
      ).toBeUndefined();
      expect(
        fake.inspectDoc('libraries/lib1/allowedDuplicates/dup1'),
      ).toBeUndefined();
      expect(fake.inspectDoc('libraries/lib1/jobs/job1')).toBeUndefined();
      expect(
        fake.inspectDoc('libraries/lib1/tombstones/old_book'),
      ).toBeUndefined();
    });
  });
});
