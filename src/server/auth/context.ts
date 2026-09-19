import type express from 'express';
import {ApiKeyVerifier} from './apiKeyVerifier';
import {TokenVerifier} from './tokenVerifier';
import {AllowlistService} from './allowlistService';
import type {AuthUser, SecurityContext} from './types';

/**
 * Creates the unified SecurityContext for any incoming HTTP request (tRPC or Express).
 * Determines caller identity via API key or Firebase JWT, and resolves allowlist permissions.
 */
export async function createSecurityContext({
  req,
  res,
}: {
  req: express.Request;
  res: express.Response;
}): Promise<SecurityContext> {
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers.authorization;

  let user: AuthUser | null = null;
  let isAppAllowed = false;
  let isAdmin = false;

  // 1. Check for API key first (via x-api-key or Bearer lib_live_...)
  const rawApiKey = ApiKeyVerifier.extractKeyFromHeaders(
    apiKeyHeader,
    authHeader,
  );
  if (rawApiKey) {
    user = await ApiKeyVerifier.verify(rawApiKey);
  } else {
    // 2. Otherwise check for Bearer JWT token
    const jwtToken = TokenVerifier.extractTokenFromHeader(authHeader);
    if (jwtToken) {
      user = await TokenVerifier.verify(jwtToken);
    }
  }

  // 3. Resolve permissions for authenticated caller
  if (user && user.email) {
    const perms = await AllowlistService.getPermissions(user.email);
    isAppAllowed = perms.isAppAllowed;
    isAdmin = perms.isAdmin;
  }

  return {
    req,
    res,
    user,
    isAppAllowed,
    isAdmin,
  };
}
