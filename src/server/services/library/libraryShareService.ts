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
import {
  SchemaValidationError,
  safeIdSchema,
  validateAndNormalizeEmail,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';
import {
  collectDeprecatedLibraryFieldDeletes,
  computeCollaboratorEmails,
  parseAndSelfHealLibrarySnapshot,
} from './libraryCrudService';
import {LibraryMetadataCache} from './libraryMetadataCache';

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
  if (normalizedEmail) {
    if (accessMap[normalizedEmail]) {
      return accessMap[normalizedEmail] as LibraryRole;
    }
    for (const [rawKey, roleVal] of Object.entries(accessMap)) {
      if (rawKey.trim().toLowerCase() === normalizedEmail && roleVal) {
        return roleVal as LibraryRole;
      }
    }
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
      if (libSnap.exists) {
        virtualData = parseAndSelfHealLibrarySnapshot(
          cleanLibraryId,
          libSnap.data() || virtualData,
          userId,
          libRef,
        );
      } else {
        const virtualSetPayload = {
          ...virtualData,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        validateFirestoreWritePayload(
          storedLibraryDocSchema,
          virtualSetPayload,
          {
            entity: 'StoredLibraryDoc',
            documentPath: `/libraries/${cleanLibraryId}`,
            operation: 'upsert',
          },
        );
        await libRef.set(virtualSetPayload, {merge: true});
      }
    } catch (err: unknown) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      const errMsg = formatFirestoreAdminError(err);
      console.error(
        '[LibraryService] Error initializing virtual shelf:',
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to initialize virtual shelf: ${errMsg}`,
      });
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

  let libData: Record<string, unknown> | undefined =
    LibraryMetadataCache.get(cleanLibraryId);
  if (!libData) {
    try {
      const db = getAdminDb();
      const libRef = db.collection('libraries').doc(cleanLibraryId);
      const libSnap = await libRef.get();

      if (!libSnap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${cleanLibraryId}' not found`,
        });
      }

      const parsedLib = parseAndSelfHealLibrarySnapshot(
        cleanLibraryId,
        libSnap.data() || {},
        userId,
        libRef,
      );
      LibraryMetadataCache.set(cleanLibraryId, parsedLib);
      libData = parsedLib;
    } catch (err: unknown) {
      if (err instanceof TRPCError || err instanceof SchemaValidationError) {
        throw err;
      }
      const errMsg = formatFirestoreAdminError(err);
      console.error('[LibraryService] Error verifying library access:', errMsg);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to verify library access: ${errMsg}`,
      });
    }
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

    await db.runTransaction(async tx => {
      const snap = await tx.get(libRef);
      if (!snap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${cleanLibraryId}' not found`,
        });
      }
      const rawSnapData = (snap.data() || {}) as Record<string, unknown>;
      const data = parseAndSelfHealLibrarySnapshot(
        cleanLibraryId,
        rawSnapData,
        userId,
      );
      libraryName = data.name || 'Shared Library';
      const rawAccess = data.access || {};

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
      const updatePayload = {
        ...collectDeprecatedLibraryFieldDeletes(rawSnapData),
        access: nextAccess,
        collaboratorEmails: computeCollaboratorEmails(nextAccess),
        updatedAt: FieldValue.serverTimestamp(),
      };
      validateFirestoreWritePayload(
        storedLibraryDocSchema.partial(),
        updatePayload,
        {
          entity: 'StoredLibraryDoc',
          documentPath: `/libraries/${cleanLibraryId}`,
          operation: 'update',
        },
      );
      tx.update(libRef, updatePayload);
    });
    LibraryMetadataCache.invalidate(cleanLibraryId);
  } catch (err: unknown) {
    if (err instanceof TRPCError || err instanceof SchemaValidationError) {
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

    await db.runTransaction(async tx => {
      const snap = await tx.get(libRef);
      if (!snap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${cleanLibraryId}' not found`,
        });
      }
      const rawSnapData = (snap.data() || {}) as Record<string, unknown>;
      const data = parseAndSelfHealLibrarySnapshot(
        cleanLibraryId,
        rawSnapData,
        userId,
      );
      const rawAccess = data.access || {};

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
      const updatePayload = {
        ...collectDeprecatedLibraryFieldDeletes(rawSnapData),
        access: nextAccess,
        collaboratorEmails: computeCollaboratorEmails(nextAccess),
        updatedAt: FieldValue.serverTimestamp(),
      };
      validateFirestoreWritePayload(
        storedLibraryDocSchema.partial(),
        updatePayload,
        {
          entity: 'StoredLibraryDoc',
          documentPath: `/libraries/${cleanLibraryId}`,
          operation: 'update',
        },
      );
      tx.update(libRef, updatePayload);
    });
    LibraryMetadataCache.invalidate(cleanLibraryId);

    return {
      success: true,
      email: normalizedTarget,
    };
  } catch (err: unknown) {
    if (err instanceof TRPCError || err instanceof SchemaValidationError) {
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
  let rawData: Record<string, unknown>;
  let fetchedRef: FirebaseFirestore.DocumentReference | undefined;
  if (options?.prefetchedData) {
    rawData = options.prefetchedData;
  } else {
    if (!options?.skipAccessCheck) {
      await verifyLibraryAccess(userId, userEmail, cleanLibraryId, 'viewer');
    }
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(cleanLibraryId);
    const snap = await libRef.get();
    if (!snap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Library '${cleanLibraryId}' not found`,
      });
    }
    rawData = snap.data() || {};
    fetchedRef = libRef;
  }

  const storedLib = parseAndSelfHealLibrarySnapshot(
    cleanLibraryId,
    rawData,
    userId,
    fetchedRef,
  );
  const accessMap = storedLib.access || {};
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
    const allowlistStatus: 'approved' | 'pending_approval' = isAppAllowed
      ? 'approved'
      : 'pending_approval';
    return {
      email,
      role,
      allowlistStatus,
    };
  });

  return {collaborators};
}
