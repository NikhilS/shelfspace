import {initTRPC, TRPCError} from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
import admin from 'firebase-admin';
import {ApiKeyService} from '../../services/server/apiKeyService';
import {LibraryService} from '../../services/server/libraryService';

export interface ContextUser {
  uid: string;
  email: string;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
}

export const createContext = async ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions) => {
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers.authorization;

  let user: ContextUser | null = null;
  let isAppAllowed = false;
  let isAdmin = false;

  // 1. Check for API Key first (either X-API-Key header or Bearer lib_live_...)
  let rawApiKey: string | undefined = apiKeyHeader;
  if (!rawApiKey && authHeader?.startsWith('Bearer lib_live_')) {
    rawApiKey = authHeader.substring(7);
  }

  if (rawApiKey) {
    const validatedKey = await ApiKeyService.validateApiKey(rawApiKey);
    if (validatedKey) {
      user = {
        uid: validatedKey.uid,
        email: validatedKey.email,
        authType: 'api_key',
        apiKeyId: validatedKey.apiKeyId,
      };
      isAppAllowed = true;
      isAdmin = true;
    }
  } else if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = await admin.auth().verifyIdToken(token);
      if (decoded?.email) {
        user = {
          uid: decoded.uid,
          email: decoded.email,
          authType: 'jwt',
        };
        isAppAllowed = true;
        isAdmin = true;
      }
    } catch (e) {
      console.error('Error verifying JWT token in TRPC context', e);
    }
  }

  return {req, res, user, isAppAllowed, isAdmin};
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }
  if (!ctx.isAppAllowed) {
    throw new TRPCError({code: 'FORBIDDEN', message: 'User not on allowlist'});
  }
  return next({ctx: {user: ctx.user}});
});

export const adminProcedure = protectedProcedure.use(({ctx, next}) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({code: 'FORBIDDEN', message: 'Admin access required'});
  }
  return next({ctx: {user: ctx.user}});
});

// Helper for checking library write access securely server-side
export async function verifyLibraryWriteAccess(
  libraryId: string,
  user: ContextUser | null,
) {
  if (!user || !user.uid) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }
  return LibraryService.verifyLibraryAccess(
    user.uid,
    user.email,
    libraryId,
    'editor',
  );
}

// Helper for checking library read access securely server-side
export async function verifyLibraryReadAccess(
  libraryId: string,
  user: ContextUser | null,
) {
  if (!user || !user.uid) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }
  return LibraryService.verifyLibraryAccess(
    user.uid,
    user.email,
    libraryId,
    'viewer',
  );
}
