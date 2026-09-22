import {initTRPC, TRPCError} from '@trpc/server';
import type {
  SecurityContext,
  LibraryRole,
  AuthUser,
  OpenApiMeta,
} from './types';
import {PermissionService} from './permissions';

const t = initTRPC.context<SecurityContext>().meta<OpenApiMeta>().create();

export const router = t.router;
export const middleware = t.middleware;

/**
 * Public procedure - no authentication required.
 */
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure - requires authenticated caller (Firebase JWT or API key),
 * regardless of whether they are on the active allowlist yet.
 */
export const authenticatedProcedure = t.procedure.use(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
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
 * Protected procedure - requires authenticated caller on the active allowlist.
 */
export const protectedProcedure = t.procedure.use(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  }
  if (!ctx.isAppAllowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User not on allowlist',
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
      isAppAllowed: true as const,
    },
  });
});

/**
 * Admin procedure - requires authenticated caller who is also an administrator.
 */
export const adminProcedure = protectedProcedure.use(({ctx, next}) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Administrative access required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      isAdmin: true as const,
    },
  });
});

/**
 * Library RBAC Procedure Factory:
 * Automatically validates caller membership & role before executing procedure.
 */
export function libraryProcedure(requiredRole: LibraryRole = 'viewer') {
  return protectedProcedure.use(async ({ctx, next, getRawInput}) => {
    let raw: unknown;
    try {
      raw = await getRawInput();
    } catch {
      raw = undefined;
    }

    const input = raw as {libraryId?: string} | undefined;
    if (!input?.libraryId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'libraryId required for library access validation',
      });
    }

    await PermissionService.verifyLibraryAccess(
      ctx.user,
      input.libraryId,
      requiredRole,
    );

    return next({
      ctx: {
        ...ctx,
        libraryId: input.libraryId,
      },
    });
  });
}

export {t};
