import {describe, it, expect, vi, beforeEach} from 'vitest';
import {BookPartitioner} from './bookPartitioner';
import {
  captureLibraryAccess,
  verifyLibraryAccess,
} from '../library/libraryShareService';
import {AllowlistService} from '../../auth/allowlistService';
import {metadataRouter} from '../../trpc/routers/metadata';
import {authRouter} from '../../trpc/routers/auth';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import type {SecurityContext} from '../../auth/types';

const mockLibGet = vi.fn();
const mockAllowlistDocGet = vi.fn();
const mockAllowlistDocSet = vi.fn();
const mockAllowlistDocDelete = vi.fn();

vi.mock('../firebaseAdmin', () => ({
  getAdminApp: () => ({}),
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  },
  formatFirestoreAdminError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getAdminDb: () => ({
    doc: vi.fn(() => ({
      get: mockAllowlistDocGet,
      set: mockAllowlistDocSet,
    })),
    collection: vi.fn((colPath: string) => {
      if (colPath === 'libraries') {
        return {
          doc: vi.fn((id: string) => ({
            id,
            get: () => mockLibGet(id),
          })),
        };
      }
      if (colPath === 'appSettings/allowlist/users') {
        return {
          doc: vi.fn(() => ({
            get: mockAllowlistDocGet,
            set: mockAllowlistDocSet,
            delete: mockAllowlistDocDelete,
          })),
        };
      }
      return {
        doc: vi.fn(() => ({
          get: vi.fn(),
          set: vi.fn(),
        })),
      };
    }),
  }),
}));

describe('BookPartitioner & Multi-User Privilege Boundaries (SEC-01, SEC-04, SEC-05, SEC-08, SEC-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AllowlistService.clearCache();
  });

  describe('Caller-Scoped Reading Status & Attribution Protection (SEC-01)', () => {
    it('prevents an Editor from spoofing addedBy/addedAt or setting another user reading status on create', () => {
      const {cleanCore} = BookPartitioner.partitionCreatePayload(
        {
          title: 'The Left Hand of Darkness',
          author: 'Ursula K. Le Guin',
          addedBy: 'spoofed-owner-uid',
          addedAt: '1999-01-01T00:00:00Z',
          userStatuses: {
            editor_uid: 'reading',
            victim_owner_uid: 'abandoned',
          },
          'userStatuses.victim_owner_uid': 'abandoned',
          isAdmin: true,
        },
        'book_123',
        'editor_uid',
        'MOCK_TS',
      );

      expect(cleanCore.addedBy).toBe('editor_uid');
      expect(cleanCore.addedAt).toBe('MOCK_TS');
      expect(cleanCore.userStatuses).toEqual({editor_uid: 'reading'});
      expect(cleanCore['userStatuses.victim_owner_uid']).toBeUndefined();
      expect(cleanCore.isAdmin).toBeUndefined();
    });

    it('prevents an Editor from overwriting another user reading status or immutable fields on update', () => {
      const {coreUpdates} = BookPartitioner.partitionUpdatePayload(
        {
          title: 'Updated Title',
          addedBy: 'hijacked_uid',
          addedAt: '2000-01-01',
          userStatuses: {
            victim_uid: 'abandoned',
            editor_uid: 'completed',
          },
          'userStatuses.victim_uid': 'abandoned',
        },
        'MOCK_TS',
        {callerUserId: 'editor_uid'},
      );

      expect(coreUpdates.title).toBe('Updated Title');
      expect(coreUpdates.addedBy).toBeUndefined();
      expect(coreUpdates.addedAt).toBeUndefined();
      expect(coreUpdates.userStatuses).toBeUndefined();
      expect(coreUpdates['userStatuses.victim_uid']).toBeUndefined();
      expect(coreUpdates['userStatuses.editor_uid']).toBe('completed');
    });

    it('drops status updates completely if an Editor only targets another user UID', () => {
      const {coreUpdates} = BookPartitioner.partitionUpdatePayload(
        {
          userStatuses: {
            victim_uid: 'abandoned',
          },
        },
        'MOCK_TS',
        {callerUserId: 'editor_uid'},
      );

      expect(coreUpdates.userStatuses).toBeUndefined();
      expect(coreUpdates['userStatuses.victim_uid']).toBeUndefined();
      expect(coreUpdates['userStatuses.editor_uid']).toBeUndefined();
    });
  });

  describe('Request-Isolated Library Access Resolution (SEC-04)', () => {
    it('isolates concurrent captureLibraryAccess calls without cross-request role bleeding', async () => {
      mockLibGet.mockImplementation(async (libId: string) => {
        if (libId === 'lib_owner') {
          await new Promise(r => setTimeout(r, 15));
          return {
            exists: true,
            data: () => ({
              name: 'Owner Library',
              ownerId: 'u_shared',
              access: {},
            }),
          };
        }
        await new Promise(r => setTimeout(r, 5));
        return {
          exists: true,
          data: () => ({
            name: 'Viewer Library',
            ownerId: 'someone_else',
            access: {'shared@example.com': 'viewer'},
          }),
        };
      });

      const [resOwner, resViewer] = await Promise.all([
        captureLibraryAccess(() =>
          verifyLibraryAccess(
            'u_shared',
            'shared@example.com',
            'lib_owner',
            'viewer',
          ),
        ),
        captureLibraryAccess(() =>
          verifyLibraryAccess(
            'u_shared',
            'shared@example.com',
            'lib_viewer',
            'viewer',
          ),
        ),
      ]);

      expect(resOwner.captured?.role).toBe('owner');
      expect(resOwner.captured?.libraryData?.name).toBe('Owner Library');
      expect(resViewer.captured?.role).toBe('viewer');
      expect(resViewer.captured?.libraryData?.name).toBe('Viewer Library');
    });
  });

  describe('Admin-Only Server Telemetry & Provider Quota Endpoints (SEC-08)', () => {
    it('rejects non-admin allowlisted users on metadata.debugTelemetry and metadata.providerCapacities', async () => {
      const regularCaller = metadataRouter.createCaller({
        user: {uid: 'u_reg', email: 'reader@example.com'},
        isAppAllowed: true,
        isAdmin: false,
      } as SecurityContext);

      await expect(regularCaller.debugTelemetry()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(regularCaller.providerCapacities()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('permits system admins to query metadata.debugTelemetry and metadata.providerCapacities', async () => {
      const adminCaller = metadataRouter.createCaller({
        user: {uid: 'u_adm', email: SUPERADMIN_EMAIL},
        isAppAllowed: true,
        isAdmin: true,
      } as SecurityContext);

      const telemetry = await adminCaller.debugTelemetry();
      expect(telemetry).toHaveProperty('entries');
      expect(telemetry).toHaveProperty('providers');
    });
  });

  describe('Allowlist Role Escalation & Superadmin Lockout Prevention (SEC-03, SEC-12)', () => {
    it('returns false without querying Firestore when email contains path traversal', async () => {
      const perms = await AllowlistService.getPermissions(
        '../../admin@example.com',
      );
      expect(perms).toEqual({
        isAppAllowed: false,
        isAdmin: false,
        hasAiPlan: false,
      });
      expect(mockAllowlistDocGet).not.toHaveBeenCalled();
    });

    it('rejects invalid roles in AllowlistService.addUser and authRouter.addAllowlistUser', async () => {
      await expect(
        AllowlistService.addUser('user@example.com', 'superadmin'),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      const adminCaller = authRouter.createCaller({
        user: {uid: 'u_adm', email: SUPERADMIN_EMAIL},
        isAppAllowed: true,
        isAdmin: true,
      } as SecurityContext);

      await expect(
        adminCaller.addAllowlistUser({
          email: 'user@example.com',
          role: 'owner' as unknown as 'user',
        }),
      ).rejects.toThrow();
    });

    it('prevents removing SUPERADMIN_EMAIL or self-removal by acting admin', async () => {
      await expect(
        AllowlistService.removeUser(
          SUPERADMIN_EMAIL,
          'other_admin@example.com',
        ),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      await expect(
        AllowlistService.removeUser('admin2@example.com', 'admin2@example.com'),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });
});
