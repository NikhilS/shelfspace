import type express from 'express';
import {TokenVerifier} from './tokenVerifier';
import {AllowlistService} from './allowlistService';
import type {AuthUser, SecurityContext} from './types';

/**
 * Creates the unified SecurityContext for any incoming tRPC request.
 * Determines caller identity via Firebase ID Token (JWT) and resolves allowlist permissions.
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
  };
}
