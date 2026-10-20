import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import {TRPCError} from '@trpc/server';
import {LibraryScope} from '../../../schemas/libraryApi';
import {AllowlistService} from '../../auth/allowlistService';
import {WaitlistService} from '../../auth/waitlistService';
import type {Library} from '../../../types';
import {LibraryService} from './index';
import {evaluateRoleFromLibraryData} from './libraryShareService';
import {normalizeFirestoreTimestamp} from '../book/bookPartitioner';

export interface LibraryApiRecord {
  id: string;
  name: string;
  ownerId: string;
  ownerName?: string;
  callerRole: 'owner' | 'editor' | 'viewer' | 'admin';
  ownershipType?: 'owned' | 'shared' | 'global_admin';
  access?: Record<string, 'owner' | 'editor' | 'viewer'>;
  heroImageUrl?: string | null;
  bookCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Lists all libraries accessible to the caller based on requested scopes.
 * If caller is an admin and 'all' is requested, returns the full system catalog.
 */
export async function getUserLibraries(
  userId: string,
  userEmail?: string,
  scopes: LibraryScope[] = ['owned', 'shared'],
  isAdmin: boolean = false,
): Promise<{libraries: LibraryApiRecord[]}> {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  const isCallerAdmin =
    isAdmin ||
    (normalizedEmail !== undefined &&
      normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim());

  const activeScopes =
    scopes && scopes.length > 0
      ? scopes
      : (['owned', 'shared'] as LibraryScope[]);

  try {
    const db = getAdminDb();
    const librariesRef = db.collection('libraries');

    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];

    if (activeScopes.includes('all') && isCallerAdmin) {
      queries.push(librariesRef.get());
    } else {
      if (activeScopes.includes('owned') && userId) {
        queries.push(librariesRef.where('ownerId', '==', userId).get());
      }

      if (activeScopes.includes('shared') && userEmail) {
        const email = userEmail.trim();
        const lowerEmail = email.toLowerCase();
        queries.push(
          librariesRef
            .where(`access.${email}`, 'in', ['owner', 'editor', 'viewer'])
            .get(),
        );
        if (lowerEmail !== email) {
          queries.push(
            librariesRef
              .where(`access.${lowerEmail}`, 'in', [
                'owner',
                'editor',
                'viewer',
              ])
              .get(),
          );
        }
      }
    }

    const snapshots = await Promise.all(queries);
    const seenIds = new Set<string>();
    const result: LibraryApiRecord[] = [];

    for (const snap of snapshots) {
      snap.forEach(docSnap => {
        if (seenIds.has(docSnap.id)) return;
        seenIds.add(docSnap.id);

        const data = docSnap.data();
        if (data.isVirtual === true || docSnap.id.startsWith('virtual_')) {
          return;
        }
        const ownerId = data.ownerId;
        const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
          data.access || {};

        let callerRole: 'owner' | 'editor' | 'viewer' | 'admin' | null = null;
        let ownershipType: 'owned' | 'shared' | 'global_admin' = 'owned';

        if (ownerId === userId) {
          callerRole = 'owner';
          ownershipType = 'owned';
        } else if (
          userEmail &&
          (accessMap[userEmail] ||
            (normalizedEmail && accessMap[normalizedEmail]))
        ) {
          callerRole =
            accessMap[userEmail] ||
            (normalizedEmail ? accessMap[normalizedEmail] : 'viewer');
          ownershipType = 'shared';
        } else if (isCallerAdmin) {
          callerRole = 'admin';
          ownershipType = 'global_admin';
        }

        if (callerRole) {
          result.push({
            id: docSnap.id,
            name: data.name || 'Untitled Library',
            ownerId: ownerId || userId,
            ownerName: data.ownerName || undefined,
            callerRole,
            ownershipType,
            access: accessMap,
            heroImageUrl: data.heroImageUrl || undefined,
            bookCount:
              typeof data.bookCount === 'number' ? data.bookCount : undefined,
            createdAt: normalizeFirestoreTimestamp(data.createdAt),
            updatedAt: normalizeFirestoreTimestamp(data.updatedAt),
          });
        }
      });
    }

    return {libraries: result};
  } catch (err: unknown) {
    if (err instanceof TRPCError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error listing libraries:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to retrieve libraries: ${errMsg}`,
    });
  }
}

/**
 * Retrieves a single library by ID with role metadata for caller.
 * Reuses prefetched library data from libraryProcedure context when available.
 */
export async function getLibrary(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  options?: {
    skipAccessCheck?: boolean;
    prefetchedData?: Record<string, unknown>;
    callerRole?: 'owner' | 'editor' | 'viewer' | null;
  },
): Promise<Library> {
  let data: Record<string, unknown>;

  if (options?.prefetchedData) {
    data = options.prefetchedData;
  } else {
    if (!options?.skipAccessCheck) {
      await LibraryService.verifyLibraryAccess(
        userId,
        userEmail,
        libraryId,
        'viewer',
      );
    }

    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(libraryId).get();
    if (!libSnap.exists) {
      if (libraryId === `virtual_${userId}`) {
        data = {
          name: 'Personal Reading Shelf',
          ownerId: userId,
          ownerName: userEmail || 'Reader',
          isVirtual: true,
          bookCount: 0,
        };
      } else {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${libraryId}' not found`,
        });
      }
    } else {
      data = (libSnap.data() || {}) as Record<string, unknown>;
    }
  }

  const ownerId = (data.ownerId as string | undefined) || userId;
  const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
    (data.access as
      Record<string, 'owner' | 'editor' | 'viewer'> | undefined) || {};

  const callerRole: 'owner' | 'editor' | 'viewer' | null =
    options?.callerRole ??
    (libraryId === `virtual_${userId}`
      ? 'owner'
      : evaluateRoleFromLibraryData(userId, userEmail, data));

  const createdAtStr = normalizeFirestoreTimestamp(data.createdAt);
  const updatedAtStr = normalizeFirestoreTimestamp(data.updatedAt);

  return {
    ...(data as unknown as Library),
    id: libraryId,
    name:
      (data.name as string) ||
      (libraryId.startsWith('virtual_')
        ? 'Personal Reading Shelf'
        : 'Untitled Library'),
    ownerId,
    ownerName: (data.ownerName as string) || '',
    access: accessMap,
    isVirtual: Boolean(data.isVirtual || libraryId.startsWith('virtual_')),
    callerRole,
    isOwner: callerRole === 'owner',
    canEdit: callerRole === 'owner' || callerRole === 'editor',
    createdAt:
      createdAtStr || (data.createdAt as string) || new Date().toISOString(),
    updatedAt: updatedAtStr || (data.updatedAt as string | undefined),
  };
}

/**
 * Creates a new library record with default owner access.
 */
export async function createLibrary(
  userId: string,
  userEmail: string | undefined,
  userName: string | undefined,
  input: {name: string; heroImageUrl?: string | null},
): Promise<{id: string; library: Library}> {
  if (!userId) {
    throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
  }

  const emailKey = userEmail?.toLowerCase().trim();
  const access: Record<string, 'owner' | 'editor' | 'viewer'> = {};
  if (emailKey) {
    access[emailKey] = 'owner';
  }

  const now = new Date().toISOString();
  const payload = {
    name: input.name.trim(),
    ownerId: userId,
    ownerName: userName || userEmail || 'Anonymous',
    access,
    heroImageUrl: input.heroImageUrl || null,
    bookCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc();
    const createdId = libRef.id;
    await libRef.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      id: createdId,
      library: {
        id: createdId,
        ...payload,
      },
    };
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error creating library:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to create library: ${errMsg}`,
    });
  }
}

/**
 * Updates an existing library (name, heroImageUrl, access roles).
 * Modifying `access` requires 'owner' permission and registers unapproved invitees on the waitlist.
 */
export async function updateLibrary(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  updates: {
    name?: string;
    heroImageUrl?: string | null;
    access?: Record<string, 'owner' | 'editor' | 'viewer'>;
  },
  options?: {
    skipAccessCheck?: boolean;
    callerRole?: 'owner' | 'editor' | 'viewer' | null;
  },
): Promise<{success: true}> {
  const requiresOwner = updates.access !== undefined;

  if (requiresOwner && options?.callerRole && options.callerRole !== 'owner') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the library owner can modify collaborator access',
    });
  }

  if (!options?.skipAccessCheck || (requiresOwner && !options?.callerRole)) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      requiresOwner ? 'owner' : 'editor',
    );
  }

  const updatePayload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (updates.name !== undefined) {
    updatePayload.name = updates.name.trim();
  }
  if (updates.heroImageUrl !== undefined) {
    updatePayload.heroImageUrl = updates.heroImageUrl;
  }
  if (updates.access !== undefined) {
    const normalizedAccess: Record<string, 'owner' | 'editor' | 'viewer'> = {};
    for (const [rawEmail, role] of Object.entries(updates.access)) {
      const cleanEmail = rawEmail.trim().toLowerCase();
      if (cleanEmail) {
        normalizedAccess[cleanEmail] = role;
      }
    }
    const callerEmail = userEmail?.trim().toLowerCase();
    if (callerEmail && normalizedAccess[callerEmail] !== 'owner') {
      // Ensure owner cannot demote or lock themselves out via full map update
      normalizedAccess[callerEmail] = 'owner';
    }
    updatePayload.access = normalizedAccess;

    for (const [email, role] of Object.entries(normalizedAccess)) {
      if (role === 'owner') continue;
      try {
        const perms = await AllowlistService.getPermissions(email);
        if (!perms.isAppAllowed) {
          await WaitlistService.ensureInvitedEntry({
            email,
            invitedByEmail: callerEmail,
            libraryName: updates.name,
          });
        }
      } catch (e) {
        console.warn('Failed to register invited user on waitlist:', e);
      }
    }
  }

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(libraryId);
    await libRef.update(updatePayload);
    return {success: true};
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error updating library:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update library: ${errMsg}`,
    });
  }
}

/**
 * Deletes a library and all contained books, details, reviews, and allowedDuplicates.
 */
export async function deleteLibrary(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  options?: {skipAccessCheck?: boolean},
): Promise<{success: true}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'owner',
    );
  }

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(libraryId);

    const booksSnap = await libRef.collection('books').get();
    const batchSize = 400;
    let batch = db.batch();
    let count = 0;

    for (const bookDoc of booksSnap.docs) {
      batch.delete(bookDoc.ref);
      batch.delete(libRef.collection('bookDetails').doc(bookDoc.id));
      count += 2;

      // Cascade delete reviews subcollection for each book
      try {
        if (typeof bookDoc.ref?.collection === 'function') {
          const reviewsSnap = await bookDoc.ref.collection('reviews').get();
          reviewsSnap.forEach(reviewDoc => {
            batch.delete(reviewDoc.ref);
            count++;
          });
        }
      } catch {
        // Non-fatal if reviews subcollection is empty or mocked
      }

      if (count >= batchSize) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    const dupSnap = await libRef.collection('allowedDuplicates').get();
    for (const dupDoc of dupSnap.docs) {
      batch.delete(dupDoc.ref);
      count++;
      if (count >= batchSize) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    await libRef.delete();
    return {success: true};
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error deleting library:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to delete library: ${errMsg}`,
    });
  }
}
