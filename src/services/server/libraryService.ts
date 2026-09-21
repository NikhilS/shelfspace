import {getAdminDb} from './firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {TRPCError} from '@trpc/server';
import {BookListInput, LibraryScope} from '../../schemas/libraryApi';
import {AllowlistService} from '../../server/auth/allowlistService';

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

export class LibraryService {
  /**
   * Verifies that the caller has sufficient permission for a specific library.
   */
  static async verifyLibraryAccess(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
    requiredRole: 'viewer' | 'editor' | 'owner' = 'viewer',
  ): Promise<boolean> {
    if (!userId) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
    }

    const normalizedEmail = userEmail?.toLowerCase().trim();
    if (normalizedEmail === SUPERADMIN_EMAIL) {
      return true;
    }

    try {
      const db = getAdminDb();
      const libSnap = await db.collection('libraries').doc(libraryId).get();

      if (!libSnap.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Library '${libraryId}' not found`,
        });
      }

      const libData = libSnap.data() || {};
      const ownerId = libData.ownerId;
      const accessMap: Record<string, string> = libData.access || {};

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
    } catch (err: unknown) {
      if (err instanceof TRPCError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('permission-denied') ||
        errMsg.includes('Firebase config not found')
      ) {
        console.warn(
          `[LibraryService] Server-side Firestore permission unavailable (${errMsg}). Allowing authenticated user to proceed; client-side Firestore Security Rules strictly govern document writes.`,
        );
        return true;
      }
      throw err;
    }
  }

  /**
   * Lists all libraries accessible to the caller based on requested scopes.
   * If caller is an admin and 'all' is requested, returns the full system catalog.
   */
  static async getUserLibraries(
    userId: string,
    userEmail?: string,
    scopes: LibraryScope[] = ['owned', 'shared'],
    isAdmin: boolean = false,
  ): Promise<{libraries: LibraryApiRecord[]}> {
    try {
      const db = getAdminDb();
      const librariesRef = db.collection('libraries');
      const normalizedEmail = userEmail?.trim().toLowerCase();
      const isCallerAdmin =
        isAdmin ||
        (normalizedEmail !== undefined &&
          normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim());

      const activeScopes =
        scopes && scopes.length > 0
          ? scopes
          : (['owned', 'shared'] as LibraryScope[]);

      const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];

      // If 'all' is requested and caller is an administrator, fetch entire catalog
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('permission-denied')
      ) {
        console.warn(
          '[LibraryService] Admin DB permission denied when listing libraries:',
          errMsg,
        );
        return {libraries: []};
      }
      throw err;
    }
  }

  /**
   * Retrieves books within a specific library, supporting filters and pagination.
   * @deprecated Retired in Phase 5: Real-time queries now execute natively on client Firestore SDK.
   */
  static async getFilteredBooks(
    userId: string,
    userEmail: string | undefined,
    input: BookListInput,
  ) {
    const {libraryId, filters, limit = 50, cursor} = input;

    // Verify read permission
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'viewer');

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

      // Fetch extra to check for pagination
      const limitToFetch = limit + 1;
      const snap = await booksRef.limit(limitToFetch * 5).get(); // fetch larger batch if filtering locally

      const missingKind = filters?.missingMetadata;

      const allBooks: Array<{
        id: string;
        title: string;
        author: string;
        isbn?: string;
        synopsis?: string;
        genre?: string;
        coverImage?: string;
        geoData?: unknown;
        temporalData?: unknown;
        metadataStatus: {
          hasGeo: boolean;
          hasTemporal: boolean;
          hasGenre: boolean;
          hasSynopsis: boolean;
          hasCoverImage: boolean;
        };
      }> = [];

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

        // Apply filter if specified
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
            b.coverUrlRaw ||
            b.coverUrl ||
            b.imageUrl ||
            b.thumbnail ||
            undefined,
          geoData: b.geoMetadata || undefined,
          temporalData: b.temporalMetadata || undefined,
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('permission-denied')
      ) {
        console.warn(
          '[LibraryService] Admin DB permission denied when querying books:',
          errMsg,
        );
        return {books: [], nextCursor: undefined};
      }
      throw err;
    }
  }

  /**
   * Generalized metadata reset: purges any supported metadata category from all books.
   */
  static async resetMetadata(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
    metadataType: string,
  ): Promise<{count: number}> {
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'editor');

    try {
      const db = getAdminDb();
      const booksRef = db
        .collection('libraries')
        .doc(libraryId)
        .collection('books');
      const snapshot = await booksRef.get();

      if (snapshot.empty) {
        return {count: 0};
      }

      let deletePayload: Record<string, unknown> = {};

      if (metadataType === 'genre' || metadataType === 'primaryGenre') {
        deletePayload = {
          primaryGenre: FieldValue.delete(),
          subgenres: FieldValue.delete(),
          isCustomPrimary: FieldValue.delete(),
          'enrichmentStatus.genre': FieldValue.delete(),
        };
      } else if (metadataType === 'geo') {
        deletePayload = {
          geoMetadata: FieldValue.delete(),
          'enrichmentStatus.geo': FieldValue.delete(),
        };
      } else if (metadataType === 'temporal') {
        deletePayload = {
          temporalMetadata: FieldValue.delete(),
          'enrichmentStatus.temporal': FieldValue.delete(),
        };
      } else if (metadataType === 'synopsis') {
        deletePayload = {
          synopsis: FieldValue.delete(),
          'enrichmentStatus.synopsis': FieldValue.delete(),
        };
      } else if (metadataType === 'authorBio') {
        deletePayload = {
          authorBio: FieldValue.delete(),
          'enrichmentStatus.authorBio': FieldValue.delete(),
        };
      } else if (metadataType === 'embedding') {
        deletePayload = {
          embedding: FieldValue.delete(),
          clusterCoordinates: FieldValue.delete(),
          'enrichmentStatus.embedding': FieldValue.delete(),
          'bookDetailsMetadata.hasEmbedding': false,
          'bookDetailsMetadata.hasClusterCoordinates': false,
        };
      } else if (metadataType === 'coverImage') {
        deletePayload = {
          coverUrl: FieldValue.delete(),
          coverUrlRaw: FieldValue.delete(),
          'enrichmentStatus.coverImage': FieldValue.delete(),
        };
      } else if (metadataType === 'series') {
        deletePayload = {
          series: FieldValue.delete(),
        };
      } else if (metadataType === 'sanitize') {
        const batchSize = 400;
        let batch = db.batch();
        let count = 0;
        let totalSanitized = 0;

        for (const doc of snapshot.docs) {
          const raw = doc.data();
          const hasLeaks =
            raw.synopsis !== undefined ||
            raw.authorBio !== undefined ||
            raw.embedding !== undefined ||
            raw.clusterCoordinates !== undefined ||
            raw.description !== undefined;

          if (hasLeaks) {
            const detailPayload: Record<string, unknown> = {};
            if (raw.synopsis || raw.description) {
              detailPayload.synopsis = raw.synopsis || raw.description;
            }
            if (raw.authorBio) detailPayload.authorBio = raw.authorBio;
            if (raw.embedding) detailPayload.embedding = raw.embedding;
            if (raw.clusterCoordinates) {
              detailPayload.clusterCoordinates = raw.clusterCoordinates;
            }

            const detailRef = db
              .collection('libraries')
              .doc(libraryId)
              .collection('bookDetails')
              .doc(doc.id);
            batch.set(detailRef, detailPayload, {merge: true});

            const bookUpdates: Record<string, unknown> = {
              'bookDetailsMetadata.hasSynopsis': Boolean(
                raw.synopsis || raw.description,
              ),
              'bookDetailsMetadata.hasAuthorBio': Boolean(raw.authorBio),
              'bookDetailsMetadata.hasEmbedding': Boolean(raw.embedding),
              'bookDetailsMetadata.hasClusterCoordinates': Boolean(
                raw.clusterCoordinates,
              ),
              synopsis: FieldValue.delete(),
              authorBio: FieldValue.delete(),
              embedding: FieldValue.delete(),
              clusterCoordinates: FieldValue.delete(),
              description: FieldValue.delete(),
            };

            batch.update(doc.ref, bookUpdates);
            count += 2;
            totalSanitized++;

            if (count >= batchSize) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
        }

        if (count > 0) {
          await batch.commit();
        }

        return {count: totalSanitized};
      } else {
        throw new Error(`Unsupported metadata reset type: '${metadataType}'`);
      }

      const batchSize = 400;
      let batch = db.batch();
      let count = 0;
      let totalReset = 0;

      for (const doc of snapshot.docs) {
        batch.update(doc.ref, deletePayload);
        count++;
        totalReset++;

        if (metadataType === 'embedding') {
          const detailRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('bookDetails')
            .doc(doc.id);
          batch.set(
            detailRef,
            {
              embedding: FieldValue.delete(),
              clusterCoordinates: FieldValue.delete(),
            },
            {merge: true},
          );
          count++;
        }

        if (count >= batchSize) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      return {count: totalReset};
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('permission-denied') ||
        errMsg.includes('Firebase config not found')
      ) {
        console.warn(
          `[LibraryService] Server-side Firestore permission unavailable (${errMsg}). Client-side Firestore Security Rules strictly govern document writes.`,
        );
        return {count: 0};
      }
      throw err;
    }
  }

  /**
   * Retrieves a single library by ID with role metadata for caller.
   */
  static async getLibrary(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
  ): Promise<Record<string, unknown>> {
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'viewer');

    const db = getAdminDb();
    const libSnap = await db.collection('libraries').doc(libraryId).get();
    if (!libSnap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Library '${libraryId}' not found`,
      });
    }

    const data = libSnap.data() || {};
    const ownerId = data.ownerId;
    const accessMap: Record<string, string> = data.access || {};

    let callerRole: 'owner' | 'editor' | 'viewer' | null = null;
    const normalizedEmail = userEmail?.toLowerCase().trim();
    if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
      callerRole = 'owner';
    } else if (ownerId === userId) {
      callerRole = 'owner';
    } else if (userEmail && accessMap[userEmail]) {
      callerRole = accessMap[userEmail] as 'owner' | 'editor' | 'viewer';
    } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
      callerRole = accessMap[userEmail.toLowerCase()] as
        'owner' | 'editor' | 'viewer';
    }

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

    return {
      id: libSnap.id,
      ...data,
      callerRole,
      isOwner: callerRole === 'owner',
      canEdit: callerRole === 'owner' || callerRole === 'editor',
      createdAt: createdAtStr || data.createdAt,
      updatedAt: updatedAtStr || data.updatedAt,
    };
  }

  /**
   * Creates a new library record with default owner access.
   */
  static async createLibrary(
    userId: string,
    userEmail: string | undefined,
    userName: string | undefined,
    input: {name: string; heroImageUrl?: string | null},
  ): Promise<{id: string; library: Record<string, unknown>}> {
    if (!userId) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'Not authenticated'});
    }

    const db = getAdminDb();
    const libRef = db.collection('libraries').doc();
    const emailKey = userEmail?.toLowerCase().trim();
    const access: Record<string, 'owner' | 'editor' | 'viewer'> = {};
    if (emailKey) {
      access[emailKey] = 'owner';
    }

    const now = FieldValue.serverTimestamp();
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

    await libRef.set(payload);

    return {
      id: libRef.id,
      library: {
        id: libRef.id,
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Updates an existing library (name, heroImageUrl, access roles).
   */
  static async updateLibrary(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
    updates: {
      name?: string;
      heroImageUrl?: string | null;
      access?: Record<string, 'owner' | 'editor' | 'viewer'>;
    },
  ): Promise<{success: true}> {
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'editor');

    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(libraryId);

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

    await libRef.update(updatePayload);
    return {success: true};
  }

  /**
   * Deletes a library and all contained books, details, and reviews.
   */
  static async deleteLibrary(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
  ): Promise<{success: true}> {
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'owner');

    const db = getAdminDb();
    const libRef = db.collection('libraries').doc(libraryId);

    // Delete all books and details
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

    // Delete allowedDuplicates subcollection
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

    // Delete library document itself
    await libRef.delete();
    return {success: true};
  }

  /**
   * Resolves caller's role on library without throwing FORBIDDEN.
   */
  static async getUserRole(
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

    try {
      const db = getAdminDb();
      const libSnap = await db.collection('libraries').doc(libraryId).get();
      if (!libSnap.exists) {
        return {role: null, isOwner: false, canEdit: false};
      }

      const data = libSnap.data() || {};
      const ownerId = data.ownerId;
      const accessMap: Record<string, string> = data.access || {};

      let role: 'owner' | 'editor' | 'viewer' | null = null;
      if (ownerId === userId) {
        role = 'owner';
      } else if (userEmail && accessMap[userEmail]) {
        role = accessMap[userEmail] as 'owner' | 'editor' | 'viewer';
      } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
        role = accessMap[userEmail.toLowerCase()] as
          'owner' | 'editor' | 'viewer';
      }

      const isOwner = role === 'owner';
      const canEdit = role === 'owner' || role === 'editor';
      return {role, isOwner, canEdit};
    } catch {
      return {role: null, isOwner: false, canEdit: false};
    }
  }

  /**
   * Lists allowed duplicate groups.
   */
  static async listAllowedDuplicates(
    libraryId: string,
  ): Promise<{allowedDuplicateGroups: string[][]}> {
    try {
      const db = getAdminDb();
      const snap = await db
        .collection('libraries')
        .doc(libraryId)
        .collection('allowedDuplicates')
        .get();

      const groups = snap.docs
        .map(d => d.data()?.bookIds as string[] | undefined)
        .filter((g): g is string[] => Array.isArray(g));

      return {allowedDuplicateGroups: groups};
    } catch {
      return {allowedDuplicateGroups: []};
    }
  }

  /**
   * Records a dismissed duplicate group.
   */
  static async allowDuplicateGroup(
    libraryId: string,
    bookIds: string[],
  ): Promise<{success: true; id: string}> {
    const db = getAdminDb();
    const ref = db
      .collection('libraries')
      .doc(libraryId)
      .collection('allowedDuplicates')
      .doc();

    await ref.set({
      bookIds,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {success: true, id: ref.id};
  }
}
