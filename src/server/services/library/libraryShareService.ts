import {AsyncLocalStorage} from 'node:async_hooks';
import {
  getAdminDb,
  formatFirestoreAdminError,
  FieldValue,
} from '../firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import {TRPCError} from '@trpc/server';
import type {LibraryRole} from '../../auth/types';
import {AllowlistService} from '../../auth/allowlistService';
import {WaitlistService} from '../../auth/waitlistService';
import {safeIdSchema, validateAndNormalizeEmail} from '../../../schemas/common';

export interface ResolvedLibraryAccess {
  role: LibraryRole;
  libraryData?: Record<string, unknown>;
}

const ROLE_HIERARCHY: Record<LibraryRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

// Request-isolated AsyncLocalStorage store so concurrent requests for the same
// userId/libraryId never share or clobber authorization state across await boundaries.
const accessCaptureStorage = new AsyncLocalStorage<{
  access?: ResolvedLibraryAccess;
}>();

/**
 * Executes an async callback within an isolated AsyncLocalStorage frame to capture
 * the resolved library role and document data without any shared module-global state.
 */
export async function captureLibraryAccess<T>(
  fn: () => Promise<T>,
): Promise<{result: T; captured?: ResolvedLibraryAccess}> {
  const store: {access?: ResolvedLibraryAccess} = {};
  const result = await accessCaptureStorage.run(store, fn);
  return {result, captured: store.access};
}

export function getRecentResolvedLibraryAccess():
  ResolvedLibraryAccess | undefined {
  return accessCaptureStorage.getStore()?.access;
}

function assertSafeLibraryId(libraryId: string): string {
  const parsed = safeIdSchema.safeParse(libraryId);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid libraryId: ${parsed.error.issues[0]?.message || 'invalid format'}`,
    });
  }
  return parsed.data;
}

export function evaluateRoleFromLibraryData(
  userId: string,
  userEmail: string | undefined,
  libData: Record<string, unknown>,
): LibraryRole | null {
  const normalizedEmail = userEmail?.toLowerCase().trim();
  if (
    normalizedEmail &&
    normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()
  ) {
    return 'owner';
  }

  const ownerId = libData.ownerId as string | undefined;
  const accessMap: Record<string, string> =
    (libData.access as Record<string, string> | undefined) || {};

  if (ownerId === userId) {
    return 'owner';
  }
  if (userEmail && accessMap[userEmail]) {
    return accessMap[userEmail] as LibraryRole;
  }
  if (normalizedEmail && accessMap[normalizedEmail]) {
    return accessMap[normalizedEmail] as LibraryRole;
  }
  return null;
}

export function isVirtualLibraryId(libraryId: string): boolean {
  return libraryId.startsWith('virtual_');
}

export function getVirtualLibraryId(userId: string): string {
  return `virtual_${userId}`;
}

/**
 * Resolves and verifies that the caller has sufficient permission for a specific library,
 * returning the isolated {role, libraryData} descriptor directly.
 */
export async function resolveLibraryAccess(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  requiredRole: LibraryRole = 'viewer',
): Promise<ResolvedLibraryAccess> {
  if (!userId) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }
  const cleanLibraryId = assertSafeLibraryId(libraryId);

  const normalizedEmail = userEmail?.toLowerCase().trim();
  const isSuperAdmin =
    normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim();

  if (isVirtualLibraryId(cleanLibraryId)) {
    const expectedVirtualId = getVirtualLibraryId(userId);
    if (cleanLibraryId !== expectedVirtualId && !isSuperAdmin) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Access denied: You do not have permission to access virtual shelf '${cleanLibraryId}'`,
      });
    }

    let virtualData: Record<string, unknown> = {
      name: 'Personal Reading Shelf',
      ownerId: cleanLibraryId.slice('virtual_'.length),
      ownerName: userEmail || 'Reader',
      isVirtual: true,
      bookCount: 0,
    };

    try {
      const db = getAdminDb();
      const libRef = db.collection('libraries').doc(cleanLibraryId);
      const libSnap = await libRef.get();
      if (libSnap?.exists) {
        virtualData = (libSnap.data() || virtualData) as Record<
          string,
          unknown
        >;
      } else if (typeof libRef?.set === 'function') {
        await libRef.set(
          {
            ...virtualData,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
      }
    } catch {
      // Non-fatal in unit test mocks that do not stub virtual doc reads
    }

    const resolved: ResolvedLibraryAccess = {
      role: 'owner',
      libraryData: virtualData,
    };
    const store = accessCaptureStorage.getStore();
    if (store) {
      store.access = resolved;
    }
    return resolved;
  }

  if (isSuperAdmin) {
    const resolved: ResolvedLibraryAccess = {role: 'owner'};
    const store = accessCaptureStorage.getStore();
    if (store) {
      store.access = resolved;
    }
    return resolved;
  }

  let libData: Record<string, unknown> | undefined;
  try {
    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(cleanLibraryId).get();

    if (!libSnap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Library '${cleanLibraryId}' not found`,
      });
    }

    libData = libSnap.data() || {};
  } catch (err: unknown) {
    if (err instanceof TRPCError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error verifying library access:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to verify library access: ${errMsg}`,
    });
  }

  let userRole = evaluateRoleFromLibraryData(userId, userEmail, libData);
  if (!userRole && normalizedEmail) {
    try {
      const perms = await AllowlistService.getPermissions(normalizedEmail);
      if (perms?.isAdmin) {
        userRole = 'owner';
      }
    } catch {
      // Non-fatal if allowlist check is unavailable
    }
  }

  if (!userRole) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Access denied: You do not have permission to access library '${cleanLibraryId}'`,
    });
  }

  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[requiredRole]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Forbidden: Required role '${requiredRole}', but caller has '${userRole}'`,
    });
  }

  const resolved: ResolvedLibraryAccess = {
    role: userRole,
    libraryData: libData,
  };
  const store = accessCaptureStorage.getStore();
  if (store) {
    store.access = resolved;
  }

  return resolved;
}

/**
 * Verifies that the caller has sufficient permission for a specific library.
 */
export async function verifyLibraryAccess(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  requiredRole: LibraryRole = 'viewer',
): Promise<boolean> {
  await resolveLibraryAccess(userId, userEmail, libraryId, requiredRole);
  return true;
}

/**
 * Resolves caller's role on library without throwing FORBIDDEN.
 */
export async function getUserRole(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
): Promise<{
  role: LibraryRole | null;
  isOwner: boolean;
  canEdit: boolean;
}> {
  if (!userId) {
    return {role: null, isOwner: false, canEdit: false};
  }
  const parsedId = safeIdSchema.safeParse(libraryId);
  if (!parsedId.success) {
    return {role: null, isOwner: false, canEdit: false};
  }

  const normalizedEmail = userEmail?.toLowerCase().trim();
  const isSuperAdmin =
    normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim();

  if (isVirtualLibraryId(parsedId.data)) {
    if (parsedId.data === getVirtualLibraryId(userId) || isSuperAdmin) {
      return {role: 'owner', isOwner: true, canEdit: true};
    }
    return {role: null, isOwner: false, canEdit: false};
  }

  if (isSuperAdmin) {
    return {role: 'owner', isOwner: true, canEdit: true};
  }

  let libData: Record<string, unknown> | undefined;
  try {
    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(parsedId.data).get();
    if (!libSnap.exists) {
      return {role: null, isOwner: false, canEdit: false};
    }

    libData = (libSnap.data() || {}) as Record<string, unknown>;
  } catch {
    return {role: null, isOwner: false, canEdit: false};
  }

  let role = evaluateRoleFromLibraryData(userId, userEmail, libData);
  if (!role && normalizedEmail) {
    try {
      const perms = await AllowlistService.getPermissions(normalizedEmail);
      if (perms?.isAdmin) {
        role = 'owner';
      }
    } catch {
      // Non-fatal
    }
  }
  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  return {role, isOwner, canEdit};
}

/**
 * Atomically invites or updates a collaborator's role ('editor' | 'viewer') on a library.
 * If the invitee is not on the global allowlist, creates a pending waitlist entry for admin review.
 */
export async function upsertCollaborator(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  targetEmail: string,
  role: 'editor' | 'viewer',
  options?: {skipAccessCheck?: boolean},
): Promise<{
  success: true;
  email: string;
  role: 'editor' | 'viewer';
  allowlistStatus: 'approved' | 'pending_approval';
}> {
  const cleanLibraryId = assertSafeLibraryId(libraryId);
  if (!options?.skipAccessCheck) {
    await verifyLibraryAccess(userId, userEmail, cleanLibraryId, 'owner');
  }

  let normalizedTarget: string;
  try {
    normalizedTarget = validateAndNormalizeEmail(targetEmail);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A valid collaborator email address is required',
    });
  }

  const callerEmail = userEmail?.trim().toLowerCase();
  let libraryName = 'Shared Library';

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(cleanLibraryId);

    const applyUpdate = async (
      getSnap: () => Promise<FirebaseFirestore.DocumentSnapshot>,
      writeAccess: (
        nextAccess: Record<string, LibraryRole>,
      ) => Promise<void> | void,
    ) => {
      const snap = await getSnap();
      if (!snap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${cleanLibraryId}' not found`,
        });
      }
      const data = (snap.data() || {}) as Record<string, unknown>;
      libraryName = (data.name as string) || 'Shared Library';
      const rawAccess =
        (data.access as Record<string, LibraryRole> | undefined) || {};

      const nextAccess: Record<string, LibraryRole> = {};
      for (const [k, v] of Object.entries(rawAccess)) {
        nextAccess[k.trim().toLowerCase()] = v;
      }

      if (
        nextAccess[normalizedTarget] === 'owner' ||
        (data.ownerId === userId && callerEmail === normalizedTarget)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot modify the library owner role',
        });
      }

      nextAccess[normalizedTarget] = role;
      await writeAccess(nextAccess);
    };

    if (
      typeof (db as {runTransaction?: unknown}).runTransaction === 'function'
    ) {
      await db.runTransaction(async tx => {
        await applyUpdate(
          () => tx.get(libRef),
          nextAccess => {
            tx.update(libRef, {
              access: nextAccess,
              updatedAt: FieldValue.serverTimestamp(),
            });
          },
        );
      });
    } else {
      await applyUpdate(
        () => libRef.get(),
        async nextAccess => {
          await libRef.update({
            access: nextAccess,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
      );
    }
  } catch (err: unknown) {
    if (err instanceof TRPCError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error upserting collaborator:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update collaborator: ${errMsg}`,
    });
  }

  let isAppAllowed = false;
  try {
    const perms = await AllowlistService.getPermissions(normalizedTarget);
    isAppAllowed = Boolean(perms?.isAppAllowed);
    if (!isAppAllowed) {
      await WaitlistService.ensureInvitedEntry({
        email: normalizedTarget,
        invitedByEmail: callerEmail,
        libraryName,
      });
    }
  } catch (e) {
    console.warn('[LibraryService] Failed to sync waitlist for invitee:', e);
  }

  return {
    success: true,
    email: normalizedTarget,
    role,
    allowlistStatus: isAppAllowed ? 'approved' : 'pending_approval',
  };
}

/**
 * Atomically removes a collaborator from a library's access map.
 * Prevents removing the library owner.
 */
export async function removeCollaborator(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  targetEmail: string,
  options?: {skipAccessCheck?: boolean},
): Promise<{
  success: true;
  email: string;
}> {
  const cleanLibraryId = assertSafeLibraryId(libraryId);
  if (!options?.skipAccessCheck) {
    await verifyLibraryAccess(userId, userEmail, cleanLibraryId, 'owner');
  }

  let normalizedTarget: string;
  try {
    normalizedTarget = validateAndNormalizeEmail(targetEmail);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A valid collaborator email address is required',
    });
  }
  const callerEmail = userEmail?.trim().toLowerCase();

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(cleanLibraryId);

    const applyRemove = async (
      getSnap: () => Promise<FirebaseFirestore.DocumentSnapshot>,
      writeAccess: (
        nextAccess: Record<string, LibraryRole>,
      ) => Promise<void> | void,
    ) => {
      const snap = await getSnap();
      if (!snap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${cleanLibraryId}' not found`,
        });
      }
      const data = (snap.data() || {}) as Record<string, unknown>;
      const rawAccess =
        (data.access as Record<string, LibraryRole> | undefined) || {};

      const nextAccess: Record<string, LibraryRole> = {};
      for (const [k, v] of Object.entries(rawAccess)) {
        nextAccess[k.trim().toLowerCase()] = v;
      }

      if (
        nextAccess[normalizedTarget] === 'owner' ||
        (data.ownerId === userId && callerEmail === normalizedTarget)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the library owner',
        });
      }

      delete nextAccess[normalizedTarget];
      await writeAccess(nextAccess);
    };

    if (
      typeof (db as {runTransaction?: unknown}).runTransaction === 'function'
    ) {
      await db.runTransaction(async tx => {
        await applyRemove(
          () => tx.get(libRef),
          nextAccess => {
            tx.update(libRef, {
              access: nextAccess,
              updatedAt: FieldValue.serverTimestamp(),
            });
          },
        );
      });
    } else {
      await applyRemove(
        () => libRef.get(),
        async nextAccess => {
          await libRef.update({
            access: nextAccess,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
      );
    }

    return {
      success: true,
      email: normalizedTarget,
    };
  } catch (err: unknown) {
    if (err instanceof TRPCError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error removing collaborator:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to remove collaborator: ${errMsg}`,
    });
  }
}

/**
 * Resolves collaborator list with global allowlist status ('approved' | 'pending_approval').
 */
export async function getCollaboratorStatuses(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  options?: {
    skipAccessCheck?: boolean;
    prefetchedData?: Record<string, unknown>;
  },
): Promise<{
  collaborators: Array<{
    email: string;
    role: LibraryRole;
    allowlistStatus: 'approved' | 'pending_approval';
  }>;
}> {
  const cleanLibraryId = assertSafeLibraryId(libraryId);
  let data: Record<string, unknown>;
  if (options?.prefetchedData) {
    data = options.prefetchedData;
  } else {
    if (!options?.skipAccessCheck) {
      await verifyLibraryAccess(userId, userEmail, cleanLibraryId, 'viewer');
    }
    const db = getAdminDb();
    const snap = await db.collection('libraries').doc(cleanLibraryId).get();
    if (!snap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Library '${cleanLibraryId}' not found`,
      });
    }
    data = (snap.data() || {}) as Record<string, unknown>;
  }

  const accessMap =
    (data.access as Record<string, LibraryRole> | undefined) || {};
  const entries = Object.entries(accessMap);

  const nonOwnerEmails = entries
    .filter(([, role]) => role !== 'owner')
    .map(([rawEmail]) => rawEmail.trim().toLowerCase());

  let permsMap = new Map<string, {isAppAllowed: boolean}>();
  if (nonOwnerEmails.length > 0) {
    try {
      permsMap = await AllowlistService.getPermissionsBulk(nonOwnerEmails);
    } catch {
      permsMap = new Map();
    }
  }

  const collaborators = entries.map(([rawEmail, role]) => {
    const email = rawEmail.trim().toLowerCase();
    const isAppAllowed =
      role === 'owner' || Boolean(permsMap.get(email)?.isAppAllowed);
    return {
      email,
      role,
      allowlistStatus: (isAppAllowed ? 'approved' : 'pending_approval') as
        'approved' | 'pending_approval',
    };
  });

  return {collaborators};
}
