import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
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
import {LibraryMetadataCache} from './libraryMetadataCache';
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

export function computeCollaboratorEmails(
  accessMap?: Record<string, string>,
): string[] {
  if (!accessMap || typeof accessMap !== 'object') {
    return [];
  }
  const seen = new Set<string>();
  for (const rawEmail of Object.keys(accessMap)) {
    const clean = rawEmail.trim().toLowerCase();
    if (clean.length > 0 && clean.length <= 254) {
      seen.add(clean);
    }
  }
  return Array.from(seen).slice(0, 200);
}

const DEPRECATED_LIBRARY_DOC_KEYS = [
  'sharedWith',
  'customGenres',
  'description',
  'collaborators',
  'members',
  'memberIds',
  'bookIds',
] as const;

const inFlightLibrarySelfHeals = new Set<string>();

/**
 * Builds a `FieldValue.delete()` patch for any deprecated pre-migration library keys
 * (such as `sharedWith` left on disk by earlier catalog index backfills) present on `raw`.
 */
export function collectDeprecatedLibraryFieldDeletes(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const deletes: Record<string, unknown> = {};
  for (const key of DEPRECATED_LIBRARY_DOC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      deletes[key] = FieldValue.delete();
    }
  }
  return deletes;
}

/**
 * Parses a `/libraries/{docId}` snapshot read from Firestore. If any deprecated
 * pre-migration library keys (e.g., `sharedWith`) remain on disk or `collaboratorEmails`
 * is missing entries present in `access`, normalizes the snapshot before strict
 * `libraryDocConverter.fromFirestore` validation and asynchronously self-heals Firestore.
 */
export function parseAndSelfHealLibrarySnapshot(
  docId: string,
  raw: Record<string, unknown>,
  fallbackOwnerId = 'unknown_owner',
  docRef?: FirebaseFirestore.DocumentReference,
): StoredLibraryDoc {
  const healPatch = collectDeprecatedLibraryFieldDeletes(raw);
  const deprecatedKeys = Object.keys(healPatch);

  const rawAccess =
    raw.access && typeof raw.access === 'object' && !Array.isArray(raw.access)
      ? (raw.access as Record<string, string>)
      : undefined;
  const expectedCollaborators = computeCollaboratorEmails(rawAccess);
  const existingCollaborators = Array.isArray(raw.collaboratorEmails)
    ? raw.collaboratorEmails
        .filter((e): e is string => typeof e === 'string')
        .map(e => e.trim().toLowerCase())
    : undefined;
  const needsCollaboratorBackfill =
    expectedCollaborators.length > 0 &&
    (!existingCollaborators ||
      expectedCollaborators.some(
        email => !existingCollaborators.includes(email),
      ));

  let cleanedRaw = raw;
  if (deprecatedKeys.length > 0 || needsCollaboratorBackfill) {
    cleanedRaw = {...raw};
    for (const key of deprecatedKeys) {
      delete cleanedRaw[key];
    }
    if (needsCollaboratorBackfill) {
      cleanedRaw.collaboratorEmails = expectedCollaborators;
      healPatch.collaboratorEmails = expectedCollaborators;
    }

    if (
      docRef &&
      typeof docRef.update === 'function' &&
      !docId.startsWith('virtual_') &&
      !inFlightLibrarySelfHeals.has(docId)
    ) {
      inFlightLibrarySelfHeals.add(docId);
      validateFirestoreWritePayload(
        storedLibraryDocSchema.partial(),
        healPatch,
        {
          entity: 'StoredLibraryDoc',
          documentPath: `/libraries/${docId}`,
          operation: 'update',
        },
      );
      void docRef
        .update(healPatch)
        .catch(err => {
          console.warn(
            `[LibraryService] Failed to self-heal /libraries/${docId}:`,
            formatFirestoreAdminError(err),
          );
        })
        .finally(() => {
          inFlightLibrarySelfHeals.delete(docId);
        });
    }
  }

  return libraryDocConverter.fromFirestore(docId, cleanedRaw, fallbackOwnerId);
}

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

    const accessMap =
      raw.access && typeof raw.access === 'object'
        ? (raw.access as Record<string, string>)
        : {};

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
      access: accessMap,
    };

    if (Array.isArray(raw.collaboratorEmails)) {
      candidate.collaboratorEmails = raw.collaboratorEmails
        .filter((e): e is string => typeof e === 'string')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && e.length <= 254)
        .slice(0, 200);
    } else {
      delete candidate.collaboratorEmails;
    }

    if (
      typeof raw.activeJobId === 'string' &&
      raw.activeJobId.trim().length > 0
    ) {
      candidate.activeJobId = raw.activeJobId.trim();
    } else if (raw.activeJobId === null) {
      candidate.activeJobId = null;
    } else {
      delete candidate.activeJobId;
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

    const snapshots: FirebaseFirestore.QuerySnapshot[] = [];

    if (activeScopes.includes('all') && isCallerAdmin) {
      snapshots.push(await librariesRef.get());
    } else {
      const wantOwned = activeScopes.includes('owned') && Boolean(userId);
      const trimmedEmail = userEmail?.trim() || '';
      const lowerEmail = trimmedEmail.toLowerCase();
      const wantShared =
        activeScopes.includes('shared') && lowerEmail.length > 0;

      const [ownedSnap, sharedIndexedSnap] = await Promise.all([
        wantOwned
          ? librariesRef.where('ownerId', '==', userId).get()
          : Promise.resolve(undefined),
        wantShared
          ? librariesRef
              .where('collaboratorEmails', 'array-contains', lowerEmail)
              .get()
          : Promise.resolve(undefined),
      ]);

      if (ownedSnap) {
        snapshots.push(ownedSnap);
      }
      if (sharedIndexedSnap) {
        snapshots.push(sharedIndexedSnap);
      }
    }

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
        const storedLib = parseAndSelfHealLibrarySnapshot(
          docSnap.id,
          rawData,
          userId,
          docSnap.ref,
        );
        LibraryMetadataCache.set(docSnap.id, storedLib);
        const ownerId = storedLib.ownerId;
        const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
          storedLib.access || {};

        let callerRole: 'owner' | 'editor' | 'viewer' | 'admin' | null = null;
        let ownershipType: 'owned' | 'shared' | 'global_admin' = 'owned';

        const matchedSharedRole = (() => {
          if (!userEmail) {
            return undefined;
          }
          if (accessMap[userEmail]) {
            return accessMap[userEmail];
          }
          if (normalizedEmail && accessMap[normalizedEmail]) {
            return accessMap[normalizedEmail];
          }
          if (normalizedEmail) {
            for (const [rawKey, roleVal] of Object.entries(accessMap)) {
              if (rawKey.trim().toLowerCase() === normalizedEmail) {
                return roleVal;
              }
            }
          }
          return undefined;
        })();

        if (ownerId === userId) {
          callerRole = 'owner';
          ownershipType = 'owned';
        } else if (matchedSharedRole) {
          callerRole = matchedSharedRole;
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
  let fetchedFromFirestore = false;
  let fetchedRef: FirebaseFirestore.DocumentReference | undefined;

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

    const cachedLib = LibraryMetadataCache.get(libraryId);
    if (cachedLib) {
      data = cachedLib;
    } else {
      const db = getAdminDb();
      const libRef = db.collection('libraries').doc(libraryId);
      const libSnap = await libRef.get();
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
        data = libSnap.data() || {};
        fetchedFromFirestore = true;
        fetchedRef = libRef;
      }
    }
  }

  const storedLib = parseAndSelfHealLibrarySnapshot(
    libraryId,
    data,
    userId,
    fetchedRef,
  );
  if (fetchedFromFirestore && !libraryId.startsWith('virtual_')) {
    LibraryMetadataCache.set(libraryId, storedLib);
  }
  const ownerId = storedLib.ownerId || userId;
  const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
    storedLib.access || {};

  const callerRole: 'owner' | 'editor' | 'viewer' | null =
    options?.callerRole ??
    (libraryId === `virtual_${userId}`
      ? 'owner'
      : evaluateRoleFromLibraryData(userId, userEmail, storedLib));

  return {
    ...storedLib,
    id: libraryId,
    name: storedLib.name,
    ownerId,
    ownerName: storedLib.ownerName || '',
    access: accessMap,
    isVirtual: Boolean(storedLib.isVirtual || libraryId.startsWith('virtual_')),
    callerRole,
    isOwner: callerRole === 'owner',
    canEdit: callerRole === 'owner' || callerRole === 'editor',
    createdAt: storedLib.createdAt || new Date().toISOString(),
    updatedAt: storedLib.updatedAt,
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
  const collaboratorEmails = computeCollaboratorEmails(access);
  const payload = {
    name: input.name.trim(),
    ownerId: userId,
    ownerName: userName || userEmail || 'Anonymous',
    access,
    collaboratorEmails,
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
    LibraryMetadataCache.set(createdId, {
      id: createdId,
      ...payload,
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
    updatePayload.collaboratorEmails =
      computeCollaboratorEmails(normalizedAccess);

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
    LibraryMetadataCache.invalidate(libraryId);
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
 * Deletes a library and all contained books, details, reviews, allowedDuplicates, jobs, and tombstones.
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
    const detailsCol = libRef.collection('bookDetails');

    const [booksSnap, dupSnap, detailsSnap, jobsSnap, tombstonesSnap] =
      await Promise.all([
        libRef.collection('books').select().get(),
        libRef.collection('allowedDuplicates').select().get(),
        detailsCol.select().get(),
        libRef.collection('jobs').select().get(),
        libRef.collection('tombstones').select().get(),
      ]);

    // Pre-fetch reviews subcollections in bounded concurrency chunks of 25
    const REVIEW_FETCH_CONCURRENCY = 25;
    const reviewSnaps = new Array<FirebaseFirestore.QuerySnapshot | undefined>(
      booksSnap.docs.length,
    );
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
        slice.map(bookDoc => bookDoc.ref.collection('reviews').select().get()),
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

    for (const detailDoc of detailsSnap.docs) {
      if (!deletedDetailIds.has(detailDoc.id)) {
        batch.delete(detailDoc.ref);
        count++;
        await commitIfFull();
      }
    }

    for (const dupDoc of dupSnap.docs) {
      batch.delete(dupDoc.ref);
      count++;
      await commitIfFull();
    }

    for (const jobDoc of jobsSnap.docs) {
      batch.delete(jobDoc.ref);
      count++;
      await commitIfFull();
    }

    for (const tombstoneDoc of tombstonesSnap.docs) {
      batch.delete(tombstoneDoc.ref);
      count++;
      await commitIfFull();
    }

    batch.delete(libRef);
    count++;

    await batch.commit();
    LibraryMetadataCache.invalidate(libraryId);
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
