import type express from 'express';
import {TokenVerifier} from './tokenVerifier';
import {AllowlistService} from './allowlistService';
import type {AuthUser, RequestScopedLoaders, SecurityContext} from './types';

function createRequestScopedLoaders(): RequestScopedLoaders {
  const userLibrariesByKey = new Map<
    string,
    Promise<{
      libraries: Awaited<
        ReturnType<RequestScopedLoaders['getUserLibraries']>
      >['libraries'];
    }>
  >();
  const readingStatesByUid = new Map<
    string,
    ReturnType<RequestScopedLoaders['getUserReadingStatesMap']>
  >();

  return {
    getUserLibraries(userId, userEmail, isAdmin = false) {
      const cacheKey = `${userId}::${(userEmail || '').trim().toLowerCase()}::${isAdmin ? '1' : '0'}`;
      const existing = userLibrariesByKey.get(cacheKey);
      if (existing) {
        return existing;
      }
      const promise = import('../services/library').then(({LibraryService}) =>
        LibraryService.getUserLibraries(
          userId,
          userEmail,
          ['owned', 'shared'],
          isAdmin,
        ),
      );
      userLibrariesByKey.set(cacheKey, promise);
      return promise;
    },

    getUserReadingStatesMap(userId) {
      const existing = readingStatesByUid.get(userId);
      if (existing) {
        return existing;
      }
      const promise = import('../services/book').then(
        ({loadUserReadingStatesMap}) => loadUserReadingStatesMap(userId),
      );
      readingStatesByUid.set(userId, promise);
      return promise;
    },
  };
}

/**
 * Creates the unified SecurityContext for any incoming tRPC request.
 * Determines caller identity via per-request Firebase ID Token (JWT) verification
 * and resolves cached allowlist permissions + request-scoped deduplicated loaders.
 */
export async function createSecurityContext({
  req,
  res,
}: {
  req: express.Request;
  res: express.Response;
}): Promise<SecurityContext> {
  const authHeader = req.headers.authorization;

  let user: AuthUser | null = null;
  let isAppAllowed = false;
  let isAdmin = false;
  let hasAiPlan = false;

  const jwtToken = TokenVerifier.extractTokenFromHeader(authHeader);
  if (jwtToken) {
    user = await TokenVerifier.verify(jwtToken);
  }

  if (user && user.email) {
    const perms = await AllowlistService.getPermissions(user.email);
    isAppAllowed = perms.isAppAllowed;
    isAdmin = perms.isAdmin;
    hasAiPlan = Boolean(perms.hasAiPlan || perms.isAdmin);
  }

  return {
    req,
    res,
    user,
    isAppAllowed,
    isAdmin,
    hasAiPlan,
    libraryAccessCache: new Map(),
    requestLoaders: createRequestScopedLoaders(),
  };
}
