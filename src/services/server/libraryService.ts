import {getAdminDb} from './firebaseAdmin';
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
        | 'owner'
        | 'editor'
        | 'viewer';
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
   * Lists all libraries accessible to the caller.
   */
  static async getUserLibraries(
    userId: string,
    userEmail?: string,
  ): Promise<{libraries: LibraryApiRecord[]}> {
    const db = getAdminDb();
    const librariesRef = db.collection('libraries');

    const snap = await librariesRef.get();
    const result: LibraryApiRecord[] = [];

    snap.forEach(docSnap => {
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

    return {libraries: result};
  }

  /**
   * Retrieves books within a specific library, supporting filters and pagination.
   */
  static async getFilteredBooks(
    userId: string,
    userEmail: string | undefined,
    input: BookListInput,
  ) {
    const {libraryId, filters, limit = 50, cursor} = input;

    // Verify read permission
    await this.verifyLibraryAccess(userId, userEmail, libraryId, 'viewer');

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

      const genreVal = b.genre || b.genres;
      const hasGenre = !!(
        genreVal &&
        (Array.isArray(genreVal)
          ? genreVal.length > 0
          : String(genreVal).trim().length > 0)
      );

      const hasSynopsis = !!(
        b.synopsis &&
        typeof b.synopsis === 'string' &&
        b.synopsis.trim().length > 0
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
        if (missingKind === 'genre' && hasGenre) return;
        if (missingKind === 'synopsis' && hasSynopsis) return;
        if (missingKind === 'coverImage' && hasCoverImage) return;
      }

      allBooks.push({
        id: bookId,
        title: b.title || 'Untitled Book',
        author: b.author || 'Unknown Author',
        isbn: b.isbn || undefined,
        synopsis: b.synopsis || undefined,
        genre: Array.isArray(genreVal)
          ? genreVal.join(', ')
          : genreVal || undefined,
        coverImage:
          b.coverUrlRaw || b.coverUrl || b.imageUrl || b.thumbnail || undefined,
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
  }
}
