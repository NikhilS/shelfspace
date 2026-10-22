import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  createContext,
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from './trpc';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {TRPCError} from '@trpc/server';

const mockVerifyIdToken = vi.fn();
const mockGetAllowlistDoc = vi.fn();

vi.mock('firebase-admin', () => {
  return {
    default: {
      apps: [{}],
      initializeApp: vi.fn(),
      auth: () => ({
        verifyIdToken: mockVerifyIdToken,
      }),
    },
  };
});

vi.mock('../services/firebaseAdmin', () => {
  return {
    getAdminApp: () => ({}),
    getAdminDb: () => ({
      collection: () => ({
        doc: () => ({
          get: mockGetAllowlistDoc,
        }),
      }),
      doc: () => ({
        get: mockGetAllowlistDoc,
      }),
    }),
  };
});

// Create a dummy test router to test middlewares
const testRouter = router({
  publicTest: publicProcedure.query(() => 'public ok'),
  protectedTest: protectedProcedure.query(({ctx}) => `hello ${ctx.user.email}`),
  adminTest: adminProcedure.query(({ctx}) => `admin ${ctx.user.email}`),
});

describe('tRPC Context & Middlewares (JWT Authentication)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type CreateContextOpts = Parameters<typeof createContext>[0];
  type CallerCtx = Parameters<typeof testRouter.createCaller>[0];

  describe('createContext - JWT Token Auth', () => {
    it('returns null user when no authorization headers are present', async () => {
      const ctx = await createContext({
        req: {headers: {}},
        res: {},
      } as unknown as CreateContextOpts);

      expect(ctx.user).toBeNull();
      expect(ctx.isAppAllowed).toBe(false);
      expect(ctx.isAdmin).toBe(false);
    });

    it('authenticates valid JWT and grants admin to SUPERADMIN_EMAIL', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'super_uid',
        email: SUPERADMIN_EMAIL,
      });

      const ctx = await createContext({
        req: {headers: {authorization: 'Bearer valid_jwt_token'}},
        res: {},
      } as unknown as CreateContextOpts);

      expect(ctx.user).toEqual({
        uid: 'super_uid',
        email: SUPERADMIN_EMAIL,
      });
      expect(ctx.isAppAllowed).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('authenticates valid JWT and checks Firestore allowlist for regular users', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'user_123',
        email: 'reader@example.com',
      });
      mockGetAllowlistDoc.mockResolvedValueOnce({
        exists: true,
        data: () => ({role: 'user'}),
      });

      const ctx = await createContext({
        req: {headers: {authorization: 'Bearer regular_jwt'}},
        res: {},
      } as unknown as CreateContextOpts);

      expect(ctx.user?.uid).toBe('user_123');
      expect(ctx.isAppAllowed).toBe(true);
      expect(ctx.isAdmin).toBe(false);
    });

    it('denies app access if JWT user is not on the allowlist', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'stranger_999',
        email: 'stranger@example.com',
      });
      mockGetAllowlistDoc.mockResolvedValueOnce({
        exists: false,
      });

      const ctx = await createContext({
        req: {headers: {authorization: 'Bearer stranger_jwt'}},
        res: {},
      } as unknown as CreateContextOpts);

      expect(ctx.user?.uid).toBe('stranger_999');
      expect(ctx.isAppAllowed).toBe(false);
      expect(ctx.isAdmin).toBe(false);
    });
  });

  describe('Procedure Middlewares', () => {
    it('allows publicProcedure for unauthenticated callers', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: null,
        isAppAllowed: false,
        isAdmin: false,
      });

      const res = await caller.publicTest();
      expect(res).toBe('public ok');
    });

    it('throws UNAUTHORIZED on protectedProcedure when user is null', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: null,
        isAppAllowed: false,
        isAdmin: false,
      });

      await expect(caller.protectedTest()).rejects.toThrowError(
        new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Provide a valid Bearer token.',
        }),
      );
    });

    it('throws FORBIDDEN on protectedProcedure when user is not on allowlist', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: {uid: 'u1', email: 'unallowed@example.com'},
        isAppAllowed: false,
        isAdmin: false,
      });

      await expect(caller.protectedTest()).rejects.toThrowError(
        new TRPCError({
          code: 'FORBIDDEN',
          message: 'Forbidden: User is not authorized on the access allowlist.',
        }),
      );
    });

    it('succeeds on protectedProcedure for allowlisted user', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: {uid: 'u1', email: 'allowed@example.com'},
        isAppAllowed: true,
        isAdmin: false,
      });

      const res = await caller.protectedTest();
      expect(res).toBe('hello allowed@example.com');
    });

    it('throws FORBIDDEN on adminProcedure for non-admin user', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: {uid: 'u1', email: 'allowed@example.com'},
        isAppAllowed: true,
        isAdmin: false,
      });

      await expect(caller.adminTest()).rejects.toThrowError(
        new TRPCError({
          code: 'FORBIDDEN',
          message: 'Forbidden: Administrative privileges required.',
        }),
      );
    });

    it('succeeds on adminProcedure for admin user', async () => {
      const caller = testRouter.createCaller({
        req: {} as unknown as CallerCtx['req'],
        res: {} as unknown as CallerCtx['res'],
        user: {uid: 'admin1', email: SUPERADMIN_EMAIL},
        isAppAllowed: true,
        isAdmin: true,
      });

      const res = await caller.adminTest();
      expect(res).toBe(`admin ${SUPERADMIN_EMAIL}`);
    });
  });
});
