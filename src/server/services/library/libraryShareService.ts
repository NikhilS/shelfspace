import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import {TRPCError} from '@trpc/server';

/**
 * Verifies that the caller has sufficient permission for a specific library.
 */
export async function verifyLibraryAccess(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  requiredRole: 'viewer' | 'editor' | 'owner' = 'viewer',
): Promise<boolean> {
  if (!userId) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }

  const normalizedEmail = userEmail?.toLowerCase().trim();
  if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
    return true;
  }

  let libData: Record<string, unknown> | undefined;
  try {
    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(libraryId).get();

    if (!libSnap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Library '${libraryId}' not found`,
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

  const ownerId = libData.ownerId as string | undefined;
  const accessMap: Record<string, string> =
    (libData.access as Record<string, string> | undefined) || {};

  let userRole: 'owner' | 'editor' | 'viewer' | null = null;

  if (ownerId === userId) {
    userRole = 'owner';
  } else if (userEmail && accessMap[userEmail]) {
    userRole = accessMap[userEmail] as 'owner' | 'editor' | 'viewer';
  } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
    userRole = accessMap[userEmail.toLowerCase()] as
      'owner' | 'editor' | 'viewer';
  }

  if (!userRole) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Access denied: You do not have permission to access library '${libraryId}'`,
    });
  }

  const roleHierarchy = {owner: 3, editor: 2, viewer: 1};
  if (roleHierarchy[userRole] < roleHierarchy[requiredRole]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Forbidden: Required role '${requiredRole}', but caller has '${userRole}'`,
    });
  }

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
  role: 'owner' | 'editor' | 'viewer' | null;
  isOwner: boolean;
  canEdit: boolean;
}> {
  if (!userId) {
    return {role: null, isOwner: false, canEdit: false};
  }

  const normalizedEmail = userEmail?.toLowerCase().trim();
  if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
    return {role: 'owner', isOwner: true, canEdit: true};
  }

  let libData: Record<string, unknown> | undefined;
  try {
    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(libraryId).get();
    if (!libSnap.exists) {
      return {role: null, isOwner: false, canEdit: false};
    }

    libData = (libSnap.data() || {}) as Record<string, unknown>;
  } catch {
    return {role: null, isOwner: false, canEdit: false};
  }

  const ownerId = libData.ownerId as string | undefined;
  const accessMap: Record<string, string> =
    (libData.access as Record<string, string> | undefined) || {};

  let role: 'owner' | 'editor' | 'viewer' | null = null;
  if (ownerId === userId) {
    role = 'owner';
  } else if (userEmail && accessMap[userEmail]) {
    role = accessMap[userEmail] as 'owner' | 'editor' | 'viewer';
  } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
    role = accessMap[userEmail.toLowerCase()] as 'owner' | 'editor' | 'viewer';
  }

  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  return {role, isOwner, canEdit};
}
