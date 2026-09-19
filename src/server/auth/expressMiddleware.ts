import type express from 'express';
import {createSecurityContext} from './context';
import {PermissionService} from './permissions';
import type {AuthenticatedApiRequest, LibraryRole} from './types';

export interface AuthMiddlewareOptions {
  requireAllowlist?: boolean;
}

/**
 * Express middleware for authenticating API requests (via x-api-key or Bearer JWT).
 * Populates req.user, req.isAppAllowed, req.isAdmin on success.
 */
export function authenticateApiRequest(
  options: AuthMiddlewareOptions = {requireAllowlist: true},
) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    // Skip health check endpoints
    if (req.path === '/health' || req.originalUrl.includes('/api/health')) {
      next();
      return;
    }

    try {
      const secContext = await createSecurityContext({req, res});

      if (!secContext.user) {
        res.status(401).json({
          error: 'Unauthorized: Missing or invalid API key or Bearer token',
        });
        return;
      }

      if (options.requireAllowlist && !secContext.isAppAllowed) {
        res.status(403).json({
          error: 'Forbidden: User is not authorized on the access allowlist',
        });
        return;
      }

      // Attach typed authentication context to Express request
      const authedReq = req as AuthenticatedApiRequest;
      authedReq.user = secContext.user;
      authedReq.isAppAllowed = secContext.isAppAllowed;
      authedReq.isAdmin = secContext.isAdmin;

      next();
    } catch (err) {
      console.error('[authenticateApiRequest] Unexpected error:', err);
      res.status(500).json({
        error: 'Internal server error during authentication',
      });
    }
  };
}

/**
 * Express middleware requiring the caller to be an administrator.
 */
export function requireAdminMiddleware() {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void => {
    const authedReq = req as AuthenticatedApiRequest;
    if (!authedReq.user) {
      res.status(401).json({error: 'Unauthorized'});
      return;
    }
    if (!authedReq.isAdmin) {
      res
        .status(403)
        .json({error: 'Forbidden: Administrative access required'});
      return;
    }
    next();
  };
}

/**
 * Express middleware requiring specific role access to a library.
 * Reads libraryId from req.params.libraryId.
 */
export function requireLibraryRoleMiddleware(
  requiredRole: LibraryRole = 'viewer',
) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    const authedReq = req as AuthenticatedApiRequest;
    const libraryId = req.params.libraryId;

    if (!libraryId) {
      res.status(400).json({error: 'Missing required libraryId parameter'});
      return;
    }

    try {
      await PermissionService.verifyLibraryAccess(
        authedReq.user,
        libraryId,
        requiredRole,
      );
      next();
    } catch (err: unknown) {
      const error = err as {code?: string; message?: string};
      const statusCode =
        error?.code === 'NOT_FOUND'
          ? 404
          : error?.code === 'FORBIDDEN'
            ? 403
            : error?.code === 'UNAUTHORIZED'
              ? 401
              : 500;
      res.status(statusCode).json({
        error: error?.message || 'Access denied to library',
      });
    }
  };
}
