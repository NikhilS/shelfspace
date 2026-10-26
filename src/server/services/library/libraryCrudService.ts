import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue, FieldPath} from 'firebase-admin/firestore';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import {TRPCError} from '@trpc/server';
import {
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  LibraryScope,
  storedLibraryDocSchema,
  type StoredLibraryDoc,
} from '../../../schemas/libraryApi';
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

const IGNORED_LEGACY_LIBRARY_FIELDS = new Set(['sharedWith']);

export const libraryDocConverter = {
  fromFirestore(
    docId: string,
    raw: Record<string, unknown>,
    fallbackOwnerId = 'unknown_owner',
  ): StoredLibraryDoc {
    const isVirtual = Boolean(raw.isVirtual || docId.startsWith('virtual_'));
    const createdAt = normalizeFirestoreTimestamp(raw.createdAt);
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const resolvedOwnerId =
      typeof raw.ownerId === 'string' && raw.ownerId.trim().length > 0
        ? raw.ownerId
        : fallbackOwnerId || 'unknown_owner';

    const candidate: Record<string, unknown> = {
      ...raw,
      id: docId,
      name:
        typeof raw.name === 'string' && raw.name.trim().length > 0
          ? raw.name
          : isVirtual
            ? 'Personal Reading Shelf'
            : 'Untitled Library',
      ownerId: resolvedOwnerId,
      access:
        raw.access && typeof raw.access === 'object'
          ? (raw.access as Record<string, 'owner' | 'editor' | 'viewer'>)
          : {},
    };

    for (const legacyKey of IGNORED_LEGACY_LIBRARY_FIELDS) {
      delete candidate[legacyKey];
    }

    if (typeof raw.ownerName === 'string' && raw.ownerName) {
      candidate.ownerName = raw.ownerName;
    } else {
      delete candidate.ownerName;
    }
    if (typeof raw.heroImageUrl === 'string' || raw.heroImageUrl === null) {
      candidate.heroImageUrl = raw.heroImageUrl;
    } else {
      delete candidate.heroImageUrl;
    }
    if (typeof raw.bookCount === 'number') {
      candidate.bookCount = raw.bookCount;
    } else {
      delete candidate.bookCount;
    }
    if (raw.isVirtual !== undefined) {
      candidate.isVirtual = Boolean(raw.isVirtual);
    } else {
      delete candidate.isVirtual;
    }
    if (createdAt !== undefined) {
      candidate.createdAt = createdAt;
    } else {
      delete candidate.createdAt;
    }
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }

    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }

    return validateFirestoreReadPayload(storedLibraryDocSchema, candidate, {
      entity: 'StoredLibraryDoc',
      documentPath: `/libraries/${docId}`,
      operation: 'read',
    });
  },
};

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

    const queries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];

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
            .where(new FieldPath('access', email), 'in', [
              'owner',
              'editor',
              'viewer',
            ])
            .get(),
        );
        if (lowerEmail !== email) {
          queries.push(
            librariesRef
              .where(new FieldPath('access', lowerEmail), 'in', [
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
        if (seenIds.has(docSnap.id)) {
          return;
        }
        seenIds.add(docSnap.id);

        const rawData = (docSnap.data() || {}) as Record<string, unknown>;
        if (rawData.isVirtual === true || docSnap.id.startsWith('virtual_')) {
          return;
        }
        const storedLib = libraryDocConverter.fromFirestore(
          docSnap.id,
          rawData,
          userId,
        );
        const ownerId = storedLib.ownerId;
        const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
          storedLib.access || {};

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
            name: storedLib.name || 'Untitled Library',
            ownerId: ownerId || userId,
            ownerName: storedLib.ownerName || undefined,
            callerRole,
            ownershipType,
            access: accessMap,
            heroImageUrl: storedLib.heroImageUrl || undefined,
            bookCount: storedLib.bookCount,
            createdAt: storedLib.createdAt,
            updatedAt: storedLib.updatedAt,
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

  const storedLib = libraryDocConverter.fromFirestore(libraryId, data, userId);
  const ownerId = storedLib.ownerId || userId;
  const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
    storedLib.access || {};

  const callerRole: 'owner' | 'editor' | 'viewer' | null =
    options?.callerRole ??
    (libraryId === `virtual_${userId}`
      ? 'owner'
      : evaluateRoleFromLibraryData(userId, userEmail, data));

  return {
    ...(data as unknown as Library),
    id: libraryId,
    name: storedLib.name,
    ownerId,
    ownerName: storedLib.ownerName || '',
    access: accessMap,
    isVirtual: Boolean(storedLib.isVirtual || libraryId.startsWith('virtual_')),
    callerRole,
    isOwner: callerRole === 'owner',
    canEdit: callerRole === 'owner' || callerRole === 'editor',
    createdAt:
      storedLib.createdAt ||
      (data.createdAt as string) ||
      new Date().toISOString(),
    updatedAt: storedLib.updatedAt || (data.updatedAt as string | undefined),
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
    const firestorePayload = {
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(storedLibraryDocSchema, firestorePayload, {
      entity: 'StoredLibraryDoc',
      documentPath: `/libraries/${createdId}`,
      operation: 'create',
    });
    await libRef.set(firestorePayload);

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

    const nonOwnerEmails = Object.entries(normalizedAccess)
      .filter(([, role]) => role !== 'owner')
      .map(([email]) => email);

    if (nonOwnerEmails.length > 0) {
      try {
        const permsMap =
          await AllowlistService.getPermissionsBulk(nonOwnerEmails);
        const unapprovedInvitees = nonOwnerEmails
          .filter(email => !permsMap.get(email)?.isAppAllowed)
          .map(email => ({
            email,
            invitedByEmail: callerEmail,
            libraryName: updates.name,
          }));
        if (unapprovedInvitees.length > 0) {
          await WaitlistService.ensureInvitedEntriesBulk(unapprovedInvitees);
        }
      } catch (e) {
        console.warn('Failed to register invited users on waitlist:', e);
      }
    }
  }

  try {
    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(libraryId);
    validateFirestoreWritePayload(
      storedLibraryDocSchema.partial(),
      updatePayload,
      {
        entity: 'StoredLibraryDoc',
        documentPath: `/libraries/${libraryId}`,
        operation: 'update',
      },
    );
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

    const fetchCollectionRefs = async (
      colRef: FirebaseFirestore.CollectionReference,
    ): Promise<FirebaseFirestore.QuerySnapshot> => {
      const selectable = colRef as unknown as {
        select?: () => {get: () => Promise<FirebaseFirestore.QuerySnapshot>};
      };
      if (typeof selectable?.select === 'function') {
        return selectable.select().get();
      }
      return colRef.get();
    };

    const detailsCol = libRef.collection('bookDetails');
    const canListDetails =
      typeof (detailsCol as unknown as {get?: unknown})?.get === 'function' ||
      typeof (detailsCol as unknown as {select?: unknown})?.select ===
        'function';

    const [booksSnap, dupSnap, detailsSnap] = await Promise.all([
      fetchCollectionRefs(libRef.collection('books')),
      fetchCollectionRefs(libRef.collection('allowedDuplicates')),
      canListDetails
        ? fetchCollectionRefs(detailsCol).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

    // Pre-fetch reviews subcollections in bounded concurrency chunks of 25
    const REVIEW_FETCH_CONCURRENCY = 25;
    const reviewSnaps: Array<FirebaseFirestore.QuerySnapshot | undefined> =
      new Array(booksSnap.docs.length);
    for (
      let start = 0;
      start < booksSnap.docs.length;
      start += REVIEW_FETCH_CONCURRENCY
    ) {
      const slice = booksSnap.docs.slice(
        start,
        start + REVIEW_FETCH_CONCURRENCY,
      );
      const chunkResults = await Promise.all(
        slice.map(async bookDoc => {
          try {
            if (typeof bookDoc.ref?.collection === 'function') {
              return await fetchCollectionRefs(
                bookDoc.ref.collection('reviews'),
              );
            }
          } catch {
            // Non-fatal if reviews subcollection is empty or mocked
          }
          return undefined;
        }),
      );
      for (let offset = 0; offset < chunkResults.length; offset++) {
        reviewSnaps[start + offset] = chunkResults[offset];
      }
    }

    const batchSize = 400;
    let batch = db.batch();
    let count = 0;

    const commitIfFull = async () => {
      if (count >= batchSize) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    };

    const deletedDetailIds = new Set<string>();

    for (let i = 0; i < booksSnap.docs.length; i++) {
      const bookDoc = booksSnap.docs[i];
      batch.delete(bookDoc.ref);
      batch.delete(detailsCol.doc(bookDoc.id));
      deletedDetailIds.add(bookDoc.id);
      count += 2;
      await commitIfFull();

      const reviewsSnap = reviewSnaps[i];
      if (reviewsSnap) {
        const revRefs: FirebaseFirestore.DocumentReference[] = [];
        reviewsSnap.forEach(reviewDoc => {
          revRefs.push(reviewDoc.ref);
        });
        for (const revRef of revRefs) {
          batch.delete(revRef);
          count++;
          await commitIfFull();
        }
      }
    }

    if (detailsSnap?.docs) {
      for (const detailDoc of detailsSnap.docs) {
        if (!deletedDetailIds.has(detailDoc.id)) {
          batch.delete(detailDoc.ref);
          count++;
          await commitIfFull();
        }
      }
    }

    for (const dupDoc of dupSnap.docs) {
      batch.delete(dupDoc.ref);
      count++;
      await commitIfFull();
    }

    batch.delete(libRef);
    count++;

    await batch.commit();
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
