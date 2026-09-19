import * as trpcExpress from '@trpc/server/adapters/express';
import {
  createSecurityContext,
  PermissionService,
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  libraryProcedure,
  t,
} from '../auth';
import type {AuthUser, SecurityContext} from '../auth';

// Backward compatibility alias for ContextUser
export type ContextUser = AuthUser;

// Backward compatibility alias for Context
export type Context = SecurityContext;

/**
 * Creates tRPC context by delegating to the unified SecurityContext builder.
 */
export const createContext = async ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions): Promise<SecurityContext> => {
  return createSecurityContext({req, res});
};

export {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  libraryProcedure,
  t,
};

/**
 * Backward compatibility helper for checking library write access securely server-side.
 */
export async function verifyLibraryWriteAccess(
  libraryId: string,
  user: ContextUser | null,
): Promise<boolean> {
  return PermissionService.verifyLibraryWriteAccess(libraryId, user);
}

/**
 * Backward compatibility helper for checking library read access securely server-side.
 */
export async function verifyLibraryReadAccess(
  libraryId: string,
  user: ContextUser | null,
): Promise<boolean> {
  return PermissionService.verifyLibraryReadAccess(libraryId, user);
}
