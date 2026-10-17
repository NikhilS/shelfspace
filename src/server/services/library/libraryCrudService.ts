import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import {TRPCError} from '@trpc/server';
import {BookListInput, LibraryScope} from '../../../schemas/libraryApi';
import {AllowlistService} from '../../auth/allowlistService';
import type {
  Library,
  FilteredBookRecord,
  BookGeoMetadata,
  BookTemporalMetadata,
} from '../../../types';
import {LibraryService} from './index';

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
          let createdAtStr: string | undefined;
          let updatedAtStr: string | undefined;

          if (data.createdAt?.toDate) {
            createdAtStr = data.createdAt.toDate().toISOString();
          } else if (typeof data.createdAt === 'string') {
            createdAtStr = data.createdAt;
          }

          if (data.updatedAt?.toDate) {
            updatedAtStr = data.updatedAt.toDate().toISOString();
          } else if (typeof data.updatedAt === 'string') {
            updatedAtStr = data.updatedAt;
          }

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
            createdAt: createdAtStr,
            updatedAt: updatedAtStr,
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
 * Retrieves books within a specific library, supporting filters and pagination.
 */
export async function getFilteredBooks(
  userId: string,
  userEmail: string | undefined,
  input: BookListInput,
): Promise<{books: FilteredBookRecord[]; nextCursor?: string}> {
  const {libraryId, filters, limit = 50, cursor} = input;

  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'viewer',
  );

  try {
    const db = getAdminDb();
    let booksRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .orderBy('addedAt', 'desc');

    if (cursor) {
      const cursorSnap = await db
        .collection('libraries')
        .doc(libraryId)
        .collection('books')
        .doc(cursor)
        .get();
      if (cursorSnap.exists) {
        booksRef = booksRef.startAfter(cursorSnap);
      }
    }

    const limitToFetch = limit + 1;
    const snap = await booksRef.limit(limitToFetch * 5).get();

    const missingKind = filters?.missingMetadata;

    const allBooks: FilteredBookRecord[] = [];

    snap.forEach(docSnap => {
      const b = docSnap.data();
      const bookId = docSnap.id;

      const hasGeo = !!(
        b.geoMetadata?.locations &&
        Array.isArray(b.geoMetadata.locations) &&
        b.geoMetadata.locations.length > 0
      );

      const hasTemporal = !!(
        b.temporalMetadata &&
        (b.temporalMetadata.startYear !== undefined ||
          b.temporalMetadata.eraName ||
          b.temporalMetadata.rationale)
      );

      const hasGenre = !!(
        b.primaryGenre && String(b.primaryGenre).trim().length > 0
      );

      const hasSynopsis = !!(
        b.bookDetailsMetadata?.hasSynopsis ||
        (b.synopsis &&
          typeof b.synopsis === 'string' &&
          b.synopsis.trim().length > 0)
      );

      const hasCoverImage = !!(
        b.coverUrlRaw ||
        b.coverUrl ||
        b.imageUrl ||
        b.thumbnail
      );

      if (missingKind) {
        if (missingKind === 'geo' && hasGeo) return;
        if (missingKind === 'temporal' && hasTemporal) return;
        if (
          (missingKind === 'genre' || missingKind === 'primaryGenre') &&
          hasGenre
        )
          return;
        if (missingKind === 'synopsis' && hasSynopsis) return;
        if (missingKind === 'coverImage' && hasCoverImage) return;
      }

      allBooks.push({
        id: bookId,
        title: b.title || 'Untitled Book',
        author: b.author || 'Unknown Author',
        isbn: b.isbn || undefined,
        synopsis: b.synopsis || undefined,
        primaryGenre: b.primaryGenre || undefined,
        subgenres: b.subgenres || [],
        isCustomPrimary: b.isCustomPrimary,
        genre: b.primaryGenre || undefined,
        coverImage:
          b.coverUrlRaw || b.coverUrl || b.imageUrl || b.thumbnail || undefined,
        geoData: (b.geoMetadata as BookGeoMetadata | undefined) || undefined,
        temporalData:
          (b.temporalMetadata as BookTemporalMetadata | undefined) || undefined,
        metadataStatus: {
          hasGeo,
          hasTemporal,
          hasGenre,
          hasSynopsis,
          hasCoverImage,
        },
      });
    });

    let nextCursor: string | undefined = undefined;
    const slicedBooks = allBooks.slice(0, limit);

    if (allBooks.length > limit) {
      nextCursor = slicedBooks[slicedBooks.length - 1].id;
    }

    return {
      books: slicedBooks,
      nextCursor,
    };
  } catch (err: unknown) {
    if (err instanceof TRPCError) throw err;
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error querying filtered books:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to retrieve books: ${errMsg}`,
    });
  }
}

/**
 * Retrieves a single library by ID with role metadata for caller.
 */
export async function getLibrary(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
): Promise<Library> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'viewer',
  );

  const db = getAdminDb();
  const libSnap = await db.collection('libraries').doc(libraryId).get();
  if (!libSnap.exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Library '${libraryId}' not found`,
    });
  }

  const data = (libSnap.data() || {}) as Record<string, unknown>;

  const ownerId = (data.ownerId as string | undefined) || userId;
  const accessMap: Record<string, 'owner' | 'editor' | 'viewer'> =
    (data.access as
      Record<string, 'owner' | 'editor' | 'viewer'> | undefined) || {};

  let callerRole: 'owner' | 'editor' | 'viewer' | null = null;
  const normalizedEmail = userEmail?.toLowerCase().trim();
  if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
    callerRole = 'owner';
  } else if (ownerId === userId) {
    callerRole = 'owner';
  } else if (userEmail && accessMap[userEmail]) {
    callerRole = accessMap[userEmail];
  } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
    callerRole = accessMap[userEmail.toLowerCase()];
  }

  let createdAtStr: string | undefined;
  let updatedAtStr: string | undefined;

  const createdVal = data.createdAt as
    {toDate?: () => Date} | string | undefined;
  if (createdVal && typeof createdVal === 'object' && createdVal.toDate) {
    createdAtStr = createdVal.toDate().toISOString();
  } else if (typeof createdVal === 'string') {
    createdAtStr = createdVal;
  }

  const updatedVal = data.updatedAt as
    {toDate?: () => Date} | string | undefined;
  if (updatedVal && typeof updatedVal === 'object' && updatedVal.toDate) {
    updatedAtStr = updatedVal.toDate().toISOString();
  } else if (typeof updatedVal === 'string') {
    updatedAtStr = updatedVal;
  }

  return {
    ...(data as unknown as Library),
    id: libraryId,
    name: (data.name as string) || 'Untitled Library',
    ownerId,
    ownerName: (data.ownerName as string) || '',
    access: accessMap,
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
): Promise<{success: true}> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'editor',
  );

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
    updatePayload.access = updates.access;
    for (const email of Object.keys(updates.access)) {
      try {
        await AllowlistService.addUser(email, 'user');
      } catch (e) {
        console.warn('Failed to auto-allowlist shared user:', e);
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
 * Deletes a library and all contained books, details, and reviews.
 */
export async function deleteLibrary(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
): Promise<{success: true}> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'owner',
  );

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
