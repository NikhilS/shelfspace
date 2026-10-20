import {initTRPC, TRPCError} from '@trpc/server';
import type {
  SecurityContext,
  LibraryRole,
  AuthUser,
  CachedLibraryAccess,
} from './types';
import {PermissionService} from './permissions';
import {captureLibraryAccess} from '../services/library/libraryShareService';
import {safeIdSchema} from '../../schemas/common';

export const t = initTRPC.context<SecurityContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Middleware: Requires an authenticated identity (Firebase JWT),
 * but does NOT require the user to be on the app allowlist yet.
 * Used for waitlist status checks and submitting waitlist requests.
 */
const enforceIsAuthenticated = t.middleware(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid Bearer token.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Middleware: Requires an authenticated identity AND app allowlist authorization.
 */
const enforceUserIsAuthed = t.middleware(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid Bearer token.',
    });
  }

  if (!ctx.isAppAllowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Forbidden: User is not authorized on the access allowlist.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Middleware: Requires the authenticated caller to be an administrator.
 */
const enforceUserIsAdmin = enforceUserIsAuthed.unstable_pipe(({ctx, next}) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Forbidden: Administrative privileges required.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
      isAdmin: true,
    },
  });
});

export const authenticatedProcedure = t.procedure.use(enforceIsAuthenticated);
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
export const adminProcedure = t.procedure.use(enforceUserIsAdmin);

/**
 * Creates a procedure that enforces library-level access control (viewer, editor, or owner).
 * Uses request-isolated AsyncLocalStorage capture to populate libraryData and callerRole
 * without any cross-request mutable global state.
 */
export function libraryProcedure(requiredRole: LibraryRole = 'viewer') {
  return protectedProcedure.use(async ({ctx, getRawInput, next}) => {
    const rawInput = (await getRawInput()) as
      {libraryId?: unknown} | undefined | null;
    const rawLibraryId = rawInput?.libraryId;

    const parsedId = safeIdSchema.safeParse(rawLibraryId);
    if (!parsedId.success) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          typeof rawLibraryId === 'string' && rawLibraryId.trim().length > 0
            ? 'Invalid libraryId format in request input.'
            : 'Missing required libraryId in request input.',
      });
    }
    const libraryId = parsedId.data;

    const cache =
      ctx.libraryAccessCache ?? new Map<string, CachedLibraryAccess>();
    let cached = cache.get(libraryId);

    let resultRole: LibraryRole;
    if (
      cached &&
      PermissionService.hasSufficientRole(cached.role, requiredRole)
    ) {
      resultRole = cached.role;
    } else {
      const {result: accessResult, captured} = await captureLibraryAccess(() =>
        PermissionService.verifyLibraryAccess(
          ctx.user,
          libraryId,
          requiredRole,
        ),
      );
      resultRole =
        typeof accessResult === 'object' && accessResult !== null
          ? accessResult.role
          : requiredRole;

      cached = {
        role: captured?.role ?? resultRole,
        libraryData: captured?.libraryData,
      };
      cache.set(libraryId, cached);
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user as AuthUser,
        libraryId,
        callerRole: cached.role,
        libraryData: cached.libraryData,
        libraryAccessCache: cache,
      },
    });
  });
}
