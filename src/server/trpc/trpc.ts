import {initTRPC, TRPCError} from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
import admin from 'firebase-admin';
import {ApiKeyService} from '../../services/server/apiKeyService';
import {LibraryService} from '../../services/server/libraryService';
import {getAdminDb} from '../../services/server/firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../constants/auth';

export interface ContextUser {
  uid: string;
  email: string;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
}

export {SUPERADMIN_EMAIL};

interface CachedUserPerms {
  perms: {isAppAllowed: boolean; isAdmin: boolean};
  expiresAt: number;
}
const userPermsCache = new Map<string, CachedUserPerms>();
const PERMS_CACHE_TTL_MS = 1000 * 60 * 3; // 3 minutes

export async function checkUserPermissions(
  email: string,
): Promise<{isAppAllowed: boolean; isAdmin: boolean}> {
  const normalizedEmail = email.toLowerCase().trim();
  if (normalizedEmail === SUPERADMIN_EMAIL) {
    return {isAppAllowed: true, isAdmin: true};
  }

  const now = Date.now();
  const cached = userPermsCache.get(normalizedEmail);
  if (cached && cached.expiresAt > now) {
    return cached.perms;
  }

  try {
    let db:
      | FirebaseFirestore.Firestore
      | {doc: (path: string) => {get: () => Promise<unknown>}};
    try {
      db = getAdminDb();
    } catch {
      db = admin.firestore();
    }
    const adminDoc = await (
      db.doc(`appSettings/allowlist/users/${normalizedEmail}`) as unknown as {
        get: () => Promise<FirebaseFirestore.DocumentSnapshot>;
      }
    ).get();

    let result = {isAppAllowed: false, isAdmin: false};
    if (adminDoc.exists) {
      const data = adminDoc.data();
      result = {
        isAppAllowed: true,
        isAdmin: data?.role === 'admin',
      };
    }

    // Cache the result
    userPermsCache.set(normalizedEmail, {
      perms: result,
      expiresAt: now + PERMS_CACHE_TTL_MS,
    });
    return result;
  } catch (err) {
    console.error(
      'Error verifying allowlist in TRPC context for email:',
      normalizedEmail,
      err,
    );
  }

  return {isAppAllowed: false, isAdmin: false};
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
      const perms = await checkUserPermissions(validatedKey.email);
      isAppAllowed = perms.isAppAllowed;
      isAdmin = perms.isAdmin;
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
        const perms = await checkUserPermissions(decoded.email);
        isAppAllowed = perms.isAppAllowed;
        isAdmin = perms.isAdmin;
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
