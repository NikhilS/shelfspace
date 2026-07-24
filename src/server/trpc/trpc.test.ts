import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  createContext,
  verifyLibraryWriteAccess,
  verifyLibraryReadAccess,
  ContextUser,
} from './trpc';
import {ApiKeyService} from '../../services/server/apiKeyService';
import {LibraryService} from '../../services/server/libraryService';
import admin from 'firebase-admin';

vi.mock('../../services/server/apiKeyService');
vi.mock('../../services/server/libraryService');

vi.mock('firebase-admin', () => ({
  default: {
    auth: vi.fn(() => ({
      verifyIdToken: vi.fn(),
    })),
  },
}));

describe('TRPC Context & Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createContext', () => {
    it('authenticates request via x-api-key header when valid', async () => {
      const mockReq = {
        headers: {
          'x-api-key': 'lib_live_valid123',
        },
      } as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['req'];

      const mockRes = {} as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['res'];

      vi.mocked(ApiKeyService.validateApiKey).mockResolvedValueOnce({
        uid: 'api_user_1',
        email: 'api@example.com',
        apiKeyId: 'hash1',
      });

      const ctx = await createContext({req: mockReq, res: mockRes});

      expect(ctx.user).toEqual({
        uid: 'api_user_1',
        email: 'api@example.com',
        authType: 'api_key',
        apiKeyId: 'hash1',
      });
      expect(ctx.isAppAllowed).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('authenticates request via Bearer lib_live_ in authorization header', async () => {
      const mockReq = {
        headers: {
          authorization: 'Bearer lib_live_secretkey456',
        },
      } as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['req'];

      const mockRes = {} as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['res'];

      vi.mocked(ApiKeyService.validateApiKey).mockResolvedValueOnce({
        uid: 'bearer_user_2',
        email: 'bearer@example.com',
        apiKeyId: 'hash2',
      });

      const ctx = await createContext({req: mockReq, res: mockRes});

      expect(ctx.user?.uid).toBe('bearer_user_2');
      expect(ctx.user?.authType).toBe('api_key');
      expect(ctx.isAppAllowed).toBe(true);
    });

    it('authenticates request via Bearer Firebase JWT token', async () => {
      const mockReq = {
        headers: {
          authorization: 'Bearer valid_firebase_jwt_token',
        },
      } as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['req'];

      const mockRes = {} as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['res'];

      vi.mocked(ApiKeyService.validateApiKey).mockResolvedValueOnce(null);

      const mockVerifyIdToken = vi.fn().mockResolvedValueOnce({
        uid: 'jwt_user_3',
        email: 'jwt@example.com',
      });
      vi.mocked(admin.auth).mockReturnValueOnce({
        verifyIdToken: mockVerifyIdToken,
      } as unknown as ReturnType<typeof admin.auth>);

      const ctx = await createContext({req: mockReq, res: mockRes});

      expect(ctx.user).toEqual({
        uid: 'jwt_user_3',
        email: 'jwt@example.com',
        authType: 'jwt',
      });
      expect(ctx.isAppAllowed).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('handles unauthenticated or invalid token requests cleanly', async () => {
      const mockReq = {
        headers: {},
      } as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['req'];

      const mockRes = {} as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['res'];

      const ctx = await createContext({req: mockReq, res: mockRes});

      expect(ctx.user).toBeNull();
      expect(ctx.isAppAllowed).toBe(false);
      expect(ctx.isAdmin).toBe(false);
    });

    it('handles invalid/expired JWT without throwing unhandled exception', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockReq = {
        headers: {
          authorization: 'Bearer invalid_or_expired_jwt',
        },
      } as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['req'];

      const mockRes = {} as unknown as import('@trpc/server/adapters/express').CreateExpressContextOptions['res'];

      vi.mocked(admin.auth).mockReturnValueOnce({
        verifyIdToken: vi.fn().mockRejectedValueOnce(new Error('Firebase ID Token expired')),
      } as unknown as ReturnType<typeof admin.auth>);

      const ctx = await createContext({req: mockReq, res: mockRes});

      expect(ctx.user).toBeNull();
      expect(ctx.isAppAllowed).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error verifying JWT token in TRPC context',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('verifyLibraryWriteAccess & verifyLibraryReadAccess', () => {
    it('verifyLibraryWriteAccess throws UNAUTHORIZED if user is null', async () => {
      await expect(verifyLibraryWriteAccess('lib1', null)).rejects.toThrow('Not authenticated');
    });

    it('verifyLibraryWriteAccess delegates required role editor to LibraryService', async () => {
      const user: ContextUser = {
        uid: 'u1',
        email: 'test@example.com',
        authType: 'jwt',
      };

      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

      const result = await verifyLibraryWriteAccess('lib1', user);

      expect(result).toBe(true);
      expect(LibraryService.verifyLibraryAccess).toHaveBeenCalledWith(
        'u1',
        'test@example.com',
        'lib1',
        'editor',
      );
    });

    it('verifyLibraryReadAccess throws UNAUTHORIZED if user is null', async () => {
      await expect(verifyLibraryReadAccess('lib1', null)).rejects.toThrow('Not authenticated');
    });

    it('verifyLibraryReadAccess delegates required role viewer to LibraryService', async () => {
      const user: ContextUser = {
        uid: 'u2',
        email: 'viewer@example.com',
        authType: 'api_key',
      };

      vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

      const result = await verifyLibraryReadAccess('lib2', user);

      expect(result).toBe(true);
      expect(LibraryService.verifyLibraryAccess).toHaveBeenCalledWith(
        'u2',
        'viewer@example.com',
        'lib2',
        'viewer',
      );
    });
  });
});
