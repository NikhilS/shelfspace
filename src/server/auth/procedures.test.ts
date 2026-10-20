import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  router,
  publicProcedure,
  authenticatedProcedure,
  protectedProcedure,
  adminProcedure,
  libraryProcedure,
} from './procedures';
import {PermissionService} from './permissions';
import {TRPCError} from '@trpc/server';
import {z} from 'zod';
import type {SecurityContext} from './types';

vi.mock('./permissions');

const testRouter = router({
  pub: publicProcedure.query(() => 'public_ok'),
  authedOnly: authenticatedProcedure.query(({ctx}) => `authed_${ctx.user.uid}`),
  prot: protectedProcedure.query(({ctx}) => `protected_${ctx.user.uid}`),
  adm: adminProcedure.query(({ctx}) => `admin_${ctx.user.email}`),
  libViewer: libraryProcedure('viewer')
    .input(z.object({libraryId: z.string()}))
    .query(({ctx}) => `lib_viewer_${ctx.libraryId}`),
  libOwner: libraryProcedure('owner')
    .input(z.object({libraryId: z.string()}))
    .mutation(({ctx}) => `lib_owner_${ctx.libraryId}`),
});

describe('tRPC Security Procedures', () => {
  const createCaller = (ctx: Partial<SecurityContext>) =>
    testRouter.createCaller({
      req: {} as unknown as SecurityContext['req'],
      res: {} as unknown as SecurityContext['res'],
      user: null,
      isAppAllowed: false,
      isAdmin: false,
      ...ctx,
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows publicProcedure without authentication', async () => {
    const caller = createCaller({});
    expect(await caller.pub()).toBe('public_ok');
  });

  it('enforces authentication on authenticatedProcedure without requiring allowlist', async () => {
    const unauthCaller = createCaller({});
    await expect(unauthCaller.authedOnly()).rejects.toThrow(TRPCError);
    await expect(unauthCaller.authedOnly()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const nonAllowlistedCaller = createCaller({
      user: {uid: 'waitlist_1', email: 'waitlist@example.com'},
      isAppAllowed: false,
    });
    expect(await nonAllowlistedCaller.authedOnly()).toBe('authed_waitlist_1');
  });

  it('enforces authentication and allowlist on protectedProcedure', async () => {
    const unauthCaller = createCaller({});
    await expect(unauthCaller.prot()).rejects.toThrow(TRPCError);

    const unallowedCaller = createCaller({
      user: {uid: 'u1', email: 'guest@example.com'},
      isAppAllowed: false,
    });
    await expect(unallowedCaller.prot()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const allowedCaller = createCaller({
      user: {uid: 'u1', email: 'user@example.com'},
      isAppAllowed: true,
    });
    expect(await allowedCaller.prot()).toBe('protected_u1');
  });

  it('enforces admin role on adminProcedure', async () => {
    const regularCaller = createCaller({
      user: {uid: 'u1', email: 'user@example.com'},
      isAppAllowed: true,
      isAdmin: false,
    });
    await expect(regularCaller.adm()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const adminCaller = createCaller({
      user: {uid: 'u2', email: 'admin@example.com'},
      isAppAllowed: true,
      isAdmin: true,
    });
    expect(await adminCaller.adm()).toBe('admin_admin@example.com');
  });

  it('enforces library role on libraryProcedure', async () => {
    const caller = createCaller({
      user: {uid: 'u1', email: 'user@example.com'},
      isAppAllowed: true,
      isAdmin: false,
    });

    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce(
      true,
    );
    const res = await caller.libViewer({libraryId: 'lib_abc'});
    expect(res).toBe('lib_viewer_lib_abc');
    expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
      {uid: 'u1', email: 'user@example.com'},
      'lib_abc',
      'viewer',
    );
  });
});
