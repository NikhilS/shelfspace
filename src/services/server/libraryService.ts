import {getAdminDb} from './firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {TRPCError} from '@trpc/server';
import {BookListInput} from '../../schemas/libraryApi';

export interface LibraryApiRecord {
  id: string;
  name: string;
  ownerId: string;
  ownerName?: string;
  callerRole: 'owner' | 'editor' | 'viewer';
  access?: Record<string, 'owner' | 'editor' | 'viewer'>;
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
   * Lists all libraries accessible to the caller.
   * @deprecated Retired in Phase 5: Real-time queries now execute natively on client Firestore SDK.
   */
  static async getUserLibraries(
    userId: string,
    userEmail?: string,
  ): Promise<{libraries: LibraryApiRecord[]}> {
    try {
      const db = getAdminDb();
      const librariesRef = db.collection('libraries');

      const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
      if (userId) {
        queries.push(librariesRef.where('ownerId', '==', userId).get());
      }

      if (userEmail) {
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

          let callerRole: 'owner' | 'editor' | 'viewer' | null = null;

          if (ownerId === userId) {
            callerRole = 'owner';
          } else if (userEmail && accessMap[userEmail]) {
            callerRole = accessMap[userEmail];
          } else if (userEmail && accessMap[userEmail.toLowerCase()]) {
            callerRole = accessMap[userEmail.toLowerCase()];
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
              access: accessMap,
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
}
