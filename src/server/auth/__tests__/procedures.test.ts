import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  libraryProcedure,
} from '../procedures';
import {PermissionService} from '../permissions';
import {TRPCError} from '@trpc/server';
import type {SecurityContext} from '../types';

vi.mock('../permissions', () => ({
  PermissionService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

describe('tRPC Auth Procedures', () => {
  const testRouter = router({
    publicHello: publicProcedure.query(() => 'hello public'),
    protectedData: protectedProcedure.query(
      ({ctx}) => `hello ${ctx.user.email}`,
    ),
    adminOnly: adminProcedure.query(() => 'admin secret'),
    libraryEdit: libraryProcedure('editor')
      .input((val: unknown) => val as {libraryId: string})
      .mutation(({ctx}) => `edited library ${ctx.libraryId}`),
  });

  const caller = (ctx: Partial<SecurityContext>) =>
    testRouter.createCaller(ctx as SecurityContext);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('publicProcedure', () => {
    it('allows unauthenticated access', async () => {
      const api = caller({user: null, isAppAllowed: false, isAdmin: false});
      const res = await api.publicHello();
      expect(res).toBe('hello public');
    });
  });

  describe('protectedProcedure', () => {
    it('throws UNAUTHORIZED if caller is not logged in', async () => {
      const api = caller({user: null, isAppAllowed: false, isAdmin: false});
      await expect(api.protectedData()).rejects.toThrow(TRPCError);
      await expect(api.protectedData()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('throws FORBIDDEN if user is not on allowlist', async () => {
      const api = caller({
        user: {uid: '123', email: 'guest@example.com', authType: 'jwt'},
        isAppAllowed: false,
        isAdmin: false,
      });
      await expect(api.protectedData()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('succeeds for authenticated and allowlisted user', async () => {
      const api = caller({
        user: {uid: '123', email: 'user@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });
      const res = await api.protectedData();
      expect(res).toBe('hello user@example.com');
    });
  });

  describe('adminProcedure', () => {
    it('throws FORBIDDEN if user is not an administrator', async () => {
      const api = caller({
        user: {uid: '123', email: 'user@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });
      await expect(api.adminOnly()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('succeeds if user is an administrator', async () => {
      const api = caller({
        user: {uid: 'admin_1', email: 'admin@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: true,
      });
      const res = await api.adminOnly();
      expect(res).toBe('admin secret');
    });
  });

  describe('libraryProcedure', () => {
    it('verifies library access and attaches libraryId to context', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce(
        true,
      );

      const api = caller({
        user: {uid: 'user_1', email: 'editor@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });

      const res = await api.libraryEdit({libraryId: 'lib_777'});
      expect(res).toBe('edited library lib_777');
      expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
        {uid: 'user_1', email: 'editor@example.com', authType: 'jwt'},
        'lib_777',
        'editor',
      );
    });

    it('rejects if permission check fails', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockRejectedValueOnce(
        new TRPCError({code: 'FORBIDDEN', message: 'Not permitted'}),
      );

      const api = caller({
        user: {uid: 'user_1', email: 'viewer@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });

      await expect(
        api.libraryEdit({libraryId: 'lib_777'}),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
