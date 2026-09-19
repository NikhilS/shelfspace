import {getAdminDb} from './firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import type {
  BookCreateInput,
  BookUpdateInput,
  BookDeleteInput,
  BookBatchUpsertInput,
} from '../../schemas/book';

const HEAVY_FIELDS = new Set([
  'synopsis',
  'authorBio',
  'embedding',
  'clusterCoordinates',
  'description',
]);

export class BookService {
  /**
   * Creates a single book and stores heavy metadata (synopsis, embeddings) in bookDetails.
   * Atomically increments parent library volume counter.
   */
  static async createBook(
    userId: string,
    input: BookCreateInput,
  ): Promise<{success: true; id: string; book: Record<string, unknown>}> {
    const {libraryId} = input;
    const db = getAdminDb();
    const booksCollection = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books');
    const bookId = input.bookId || input.id || booksCollection.doc().id;

    const bookRef = booksCollection.doc(bookId);
    const detailRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(bookId);
    const libraryRef = db.collection('libraries').doc(libraryId);

    // Partition heavy vs core fields
    const rawInput = {...input};
    delete rawInput.libraryId;
    delete rawInput.bookId;
    delete rawInput.id;

    const heavyData: Record<string, unknown> = {
      ...(input.heavyDetails || {}),
    };

    if (input.synopsis !== undefined && input.synopsis !== null) {
      heavyData.synopsis = input.synopsis;
    }
    if (input.authorBio !== undefined && input.authorBio !== null) {
      heavyData.authorBio = input.authorBio;
    }
    if (input.embedding !== undefined && input.embedding !== null) {
      heavyData.embedding = input.embedding;
    }
    if (
      input.clusterCoordinates !== undefined &&
      input.clusterCoordinates !== null
    ) {
      heavyData.clusterCoordinates = input.clusterCoordinates;
    }

    // Clean undefined/null heavy fields
    const cleanHeavy = Object.fromEntries(
      Object.entries(heavyData).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      ),
    );

    // Compute bookDetailsMetadata
    const bookDetailsMetadata = {
      ...(input.bookDetailsMetadata || {}),
      hasSynopsis: Boolean(cleanHeavy.synopsis),
      hasAuthorBio: Boolean(cleanHeavy.authorBio),
      hasEmbedding: Boolean(
        Array.isArray(cleanHeavy.embedding) && cleanHeavy.embedding.length > 0,
      ),
      hasClusterCoordinates: Boolean(cleanHeavy.clusterCoordinates),
    };

    // Construct core payload
    const coreData: Record<string, unknown> = {
      ...rawInput,
      id: bookId,
      title: input.title,
      author: input.author || 'Unknown Author',
      format: input.format || 'physical',
      addedBy: userId || rawInput.addedBy || null,
      addedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      bookDetailsMetadata,
    };

    if (input.status && userId) {
      coreData.userStatuses = {
        ...((input.userStatuses as Record<string, unknown>) || {}),
        [userId]: input.status,
      };
      delete coreData.status;
    }

    // Remove heavy fields from core document
    HEAVY_FIELDS.forEach(f => {
      delete coreData[f];
    });
    delete coreData.heavyDetails;

    // Remove undefined values
    const cleanCore = Object.fromEntries(
      Object.entries(coreData).filter(([, v]) => v !== undefined),
    );

    const batch = db.batch();
    batch.set(bookRef, cleanCore);

    if (Object.keys(cleanHeavy).length > 0) {
      batch.set(detailRef, {
        ...cleanHeavy,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    batch.update(libraryRef, {
      bookCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[BookService.createBook] Error committing create for book '${bookId}':`,
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create book: ${errMsg}`,
      });
    }

    return {
      success: true,
      id: bookId,
      book: {
        ...cleanCore,
        id: bookId,
        ...(Object.keys(cleanHeavy).length > 0
          ? {heavyDetails: cleanHeavy}
          : {}),
      },
    };
  }

  /**
   * Updates an existing book and propagates heavy updates to bookDetails.
   */
  static async updateBook(
    userId: string,
    input: BookUpdateInput,
  ): Promise<{success: true; id: string}> {
    const {libraryId, bookId, updates} = input;
    const db = getAdminDb();
    const bookRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId);
    const detailRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(bookId);
    const libraryRef = db.collection('libraries').doc(libraryId);

    const coreUpdates: Record<string, unknown> = {};
    const heavyUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      if (HEAVY_FIELDS.has(key)) {
        heavyUpdates[key] = value;
      } else if (key === 'heavyDetails' && typeof value === 'object' && value) {
        Object.assign(heavyUpdates, value);
      } else {
        coreUpdates[key] = value;
      }
    }

    // Maintain bookDetailsMetadata if heavy fields are touched
    if (Object.keys(heavyUpdates).length > 0) {
      if (heavyUpdates.synopsis !== undefined) {
        coreUpdates['bookDetailsMetadata.hasSynopsis'] = Boolean(
          heavyUpdates.synopsis,
        );
      }
      if (heavyUpdates.authorBio !== undefined) {
        coreUpdates['bookDetailsMetadata.hasAuthorBio'] = Boolean(
          heavyUpdates.authorBio,
        );
      }
      if (heavyUpdates.embedding !== undefined) {
        coreUpdates['bookDetailsMetadata.hasEmbedding'] = Boolean(
          Array.isArray(heavyUpdates.embedding) &&
          heavyUpdates.embedding.length > 0,
        );
      }
      if (heavyUpdates.clusterCoordinates !== undefined) {
        coreUpdates['bookDetailsMetadata.hasClusterCoordinates'] = Boolean(
          heavyUpdates.clusterCoordinates,
        );
      }
    }

    coreUpdates.updatedAt = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.update(bookRef, coreUpdates);

    if (Object.keys(heavyUpdates).length > 0) {
      batch.set(
        detailRef,
        {
          ...heavyUpdates,
          updatedAt: FieldValue.serverTimestamp(),
        },
        {merge: true},
      );
    }

    batch.update(libraryRef, {
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[BookService.updateBook] Error updating book '${bookId}':`,
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to update book: ${errMsg}`,
      });
    }

    return {success: true, id: bookId};
  }

  /**
   * Atomically deletes a book, its heavy metadata sub-record, associated reviews,
   * and decrements the library bookCount.
   */
  static async deleteBook(
    userId: string,
    input: BookDeleteInput,
  ): Promise<{success: true; id: string}> {
    const {libraryId, bookId} = input;
    const db = getAdminDb();
    const bookRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId);
    const detailRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(bookId);
    const libraryRef = db.collection('libraries').doc(libraryId);

    const batch = db.batch();
    batch.delete(bookRef);
    batch.delete(detailRef);

    // Cascade delete reviews subcollection
    try {
      const reviewsSnap = await db
        .collection('libraries')
        .doc(libraryId)
        .collection('books')
        .doc(bookId)
        .collection('reviews')
        .get();

      reviewsSnap.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
    } catch (e) {
      console.warn(
        `[BookService.deleteBook] Could not load reviews for cascade delete on book '${bookId}':`,
        e,
      );
    }

    batch.update(libraryRef, {
      bookCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[BookService.deleteBook] Error deleting book '${bookId}':`,
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to delete book: ${errMsg}`,
      });
    }

    return {success: true, id: bookId};
  }

  /**
   * Executes atomic batch mutations (create, update, delete) in chunks of up to 400 operations,
   * safely keeping track of parent library volume counter deltas.
   */
  static async batchUpsert(
    userId: string,
    input: BookBatchUpsertInput,
  ): Promise<{
    success: true;
    count: number;
    added: number;
    updated: number;
    deleted: number;
  }> {
    const {libraryId} = input;
    const db = getAdminDb();
    const libraryRef = db.collection('libraries').doc(libraryId);

    type NormalizedOp = {
      type: 'create' | 'update' | 'delete' | 'set';
      bookId: string;
      coreData?: Record<string, unknown>;
      heavyData?: Record<string, unknown>;
      merge?: boolean;
    };

    const ops: NormalizedOp[] = [];

    if (input.operations && input.operations.length > 0) {
      for (const op of input.operations) {
        const bookId =
          op.bookId ||
          (op.data?.id as string) ||
          db.collection('libraries').doc(libraryId).collection('books').doc()
            .id;
        ops.push({
          type: op.type,
          bookId,
          coreData: op.data,
          heavyData: op.heavyData,
          merge: op.merge,
        });
      }
    } else if (input.books && input.books.length > 0) {
      for (const b of input.books) {
        const bookId =
          b.id ||
          b.bookId ||
          db.collection('libraries').doc(libraryId).collection('books').doc()
            .id;
        const action = b.action || b.operation || (b.id ? 'upsert' : 'create');

        if (action === 'delete') {
          ops.push({type: 'delete', bookId});
        } else if (action === 'update') {
          const raw = {...b};
          delete raw.action;
          delete raw.operation;
          delete raw.id;
          delete raw.bookId;
          ops.push({type: 'update', bookId, coreData: raw});
        } else {
          // create or upsert
          const raw = {...b};
          delete raw.action;
          delete raw.operation;
          delete raw.id;
          delete raw.bookId;

          const heavyData: Record<string, unknown> = {
            ...(b.heavyDetails || {}),
          };
          if (b.synopsis) heavyData.synopsis = b.synopsis;
          if (b.authorBio) heavyData.authorBio = b.authorBio;
          if (b.embedding) heavyData.embedding = b.embedding;
          if (b.clusterCoordinates)
            heavyData.clusterCoordinates = b.clusterCoordinates;

          HEAVY_FIELDS.forEach(f => delete raw[f]);
          delete raw.heavyDetails;

          ops.push({
            type: action === 'upsert' ? 'set' : 'create',
            bookId,
            coreData: raw,
            heavyData:
              Object.keys(heavyData).length > 0 ? heavyData : undefined,
            merge: action === 'upsert',
          });
        }
      }
    }

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    const BATCH_LIMIT = 400;
    let currentBatch = db.batch();
    let currentBatchOps = 0;

    for (const op of ops) {
      const bookRef = db
        .collection('libraries')
        .doc(libraryId)
        .collection('books')
        .doc(op.bookId);
      const detailRef = db
        .collection('libraries')
        .doc(libraryId)
        .collection('bookDetails')
        .doc(op.bookId);

      if (op.type === 'delete') {
        currentBatch.delete(bookRef);
        currentBatch.delete(detailRef);
        currentBatchOps += 2;
        deletedCount++;
      } else if (op.type === 'create' || (op.type === 'set' && !op.merge)) {
        const cleanCore = Object.fromEntries(
          Object.entries(op.coreData || {}).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        );
        cleanCore.id = op.bookId;
        cleanCore.addedBy = cleanCore.addedBy || userId || null;
        cleanCore.addedAt = cleanCore.addedAt || FieldValue.serverTimestamp();
        cleanCore.updatedAt = FieldValue.serverTimestamp();

        currentBatch.set(bookRef, cleanCore);
        currentBatchOps++;
        addedCount++;

        if (op.heavyData && Object.keys(op.heavyData).length > 0) {
          const cleanHeavy = Object.fromEntries(
            Object.entries(op.heavyData).filter(
              ([, v]) => v !== undefined && v !== null,
            ),
          );
          currentBatch.set(detailRef, {
            ...cleanHeavy,
            updatedAt: FieldValue.serverTimestamp(),
          });
          currentBatchOps++;
        }
      } else {
        // update or set with merge
        const cleanUpdates = Object.fromEntries(
          Object.entries(op.coreData || {}).filter(([, v]) => v !== undefined),
        );
        cleanUpdates.updatedAt = FieldValue.serverTimestamp();

        if (op.merge) {
          currentBatch.set(bookRef, cleanUpdates, {merge: true});
        } else {
          currentBatch.update(bookRef, cleanUpdates);
        }
        currentBatchOps++;
        updatedCount++;

        if (op.heavyData && Object.keys(op.heavyData).length > 0) {
          const cleanHeavy = Object.fromEntries(
            Object.entries(op.heavyData).filter(([, v]) => v !== undefined),
          );
          currentBatch.set(
            detailRef,
            {
              ...cleanHeavy,
              updatedAt: FieldValue.serverTimestamp(),
            },
            {merge: true},
          );
          currentBatchOps++;
        }
      }

      if (currentBatchOps >= BATCH_LIMIT) {
        await currentBatch.commit();
        currentBatch = db.batch();
        currentBatchOps = 0;
      }
    }

    const netCountDelta = addedCount - deletedCount;
    if (netCountDelta !== 0 || ops.length > 0) {
      const libUpdatePayload: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (netCountDelta !== 0) {
        libUpdatePayload.bookCount = FieldValue.increment(netCountDelta);
      }
      currentBatch.update(libraryRef, libUpdatePayload);
      currentBatchOps++;
    }

    if (currentBatchOps > 0) {
      await currentBatch.commit();
    }

    return {
      success: true,
      count: ops.length,
      added: addedCount,
      updated: updatedCount,
      deleted: deletedCount,
    };
  }

  /**
   * Retrieves a single book by ID, optionally merging partitioned heavy metadata.
   */
  static async getBook(
    userId: string,
    libraryId: string,
    bookId: string,
  ): Promise<Record<string, unknown>> {
    const db = getAdminDb();
    const bookSnap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId)
      .get();

    if (!bookSnap.exists) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Book '${bookId}' not found in library '${libraryId}'`,
      });
    }

    const bookData = bookSnap.data() || {};
    let heavyData: Record<string, unknown> = {};

    try {
      const detailSnap = await db
        .collection('libraries')
        .doc(libraryId)
        .collection('bookDetails')
        .doc(bookId)
        .get();
      if (detailSnap.exists) {
        heavyData = detailSnap.data() || {};
      }
    } catch {
      // Non-critical if bookDetails subcollection doesn't exist
    }

    return {
      id: bookSnap.id,
      ...bookData,
      ...(heavyData.synopsis ? {synopsis: heavyData.synopsis} : {}),
      ...(heavyData.authorBio ? {authorBio: heavyData.authorBio} : {}),
      ...(heavyData.embedding ? {embedding: heavyData.embedding} : {}),
      ...(heavyData.clusterCoordinates
        ? {clusterCoordinates: heavyData.clusterCoordinates}
        : {}),
    };
  }

  /**
   * Lists books in a library, applying optional filters and pagination.
   */
  static async listBooks(
    userId: string,
    libraryId: string,
    options?: {
      filters?: {
        missingMetadata?: string;
        primaryGenre?: string;
        status?: string;
      };
      limit?: number;
      cursor?: string;
    },
  ): Promise<{books: Record<string, unknown>[]; nextCursor?: string}> {
    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books');

    try {
      query = query.orderBy('addedAt', 'desc');
    } catch {
      // In tests or if index not configured
    }

    const limitCount = options?.limit ?? 1000;
    query = query.limit(limitCount);

    const snapshot = await query.get();
    let books = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      const bookData: Record<string, unknown> = {
        id: doc.id,
        ...data,
        primaryGenre: data.primaryGenre || undefined,
        subgenres: Array.isArray(data.subgenres) ? data.subgenres : [],
        isCustomPrimary: Boolean(data.isCustomPrimary),
      };

      if (
        bookData.temporalMetadata &&
        typeof bookData.temporalMetadata === 'object'
      ) {
        const temporal = {
          ...(bookData.temporalMetadata as Record<string, unknown>),
        };
        if (
          temporal.startYear !== undefined &&
          temporal.endYear === undefined
        ) {
          temporal.endYear = temporal.startYear;
        }
        const start = temporal.startYear as number | undefined;
        const end = temporal.endYear as number | undefined;
        if (
          (start !== undefined && (start < -10000 || start > 2100)) ||
          (end !== undefined && (end < -10000 || end > 2100))
        ) {
          delete bookData.temporalMetadata;
        } else {
          bookData.temporalMetadata = temporal;
        }
      }

      return bookData;
    });

    if (options?.filters?.missingMetadata) {
      const missing = options.filters.missingMetadata;
      books = books.filter(b => {
        if (missing === 'geo') return !b.geoMetadata;
        if (missing === 'temporal') return !b.temporalMetadata;
        if (missing === 'genre' || missing === 'primaryGenre')
          return !b.primaryGenre;
        if (missing === 'synopsis')
          return (
            !b.synopsis &&
            !(b.bookDetailsMetadata as Record<string, boolean> | undefined)
              ?.hasSynopsis
          );
        if (missing === 'coverImage') return !b.coverUrl;
        return true;
      });
    }

    return {
      books,
      nextCursor:
        snapshot.docs.length >= limitCount
          ? snapshot.docs[snapshot.docs.length - 1]?.id
          : undefined,
    };
  }

  /**
   * Lists reviews for a specific book.
   */
  static async listReviews(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
    bookId: string,
  ): Promise<{
    reviews: Array<{
      id: string;
      userId: string;
      userName: string;
      rating: number;
      text: string;
      createdAt?: string;
    }>;
  }> {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
    const db = getAdminDb();
    const reviewsSnap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId)
      .collection('reviews')
      .orderBy('createdAt', 'desc')
      .get();

    const reviews = reviewsSnap.docs.map(doc => {
      const d = doc.data();
      let createdAtStr: string | undefined;
      if (d.createdAt?.toDate) {
        createdAtStr = d.createdAt.toDate().toISOString();
      } else if (typeof d.createdAt === 'string') {
        createdAtStr = d.createdAt;
      }
      return {
        id: doc.id,
        userId: d.userId,
        userName: d.userName || 'Anonymous',
        rating: typeof d.rating === 'number' ? d.rating : 0,
        text: d.text || '',
        createdAt: createdAtStr,
      };
    });

    return {reviews};
  }

  /**
   * Adds a review for a specific book.
   */
  static async addReview(
    userId: string,
    userEmail: string | undefined,
    userName: string | undefined,
    libraryId: string,
    bookId: string,
    input: {rating: number; text: string},
  ): Promise<{success: true; id: string}> {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
    const db = getAdminDb();
    const reviewRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId)
      .collection('reviews')
      .doc();

    const reviewDoc = {
      userId,
      userName: userName || userEmail || 'Anonymous',
      rating: input.rating,
      text: input.text.trim(),
      createdAt: FieldValue.serverTimestamp(),
    };

    await reviewRef.set(reviewDoc);
    return {success: true, id: reviewRef.id};
  }

  /**
   * Batches book details retrieval for constellation and graph views.
   */
  static async getBookDetailsChunk(
    userId: string,
    userEmail: string | undefined,
    libraryId: string,
    bookIds: string[],
  ): Promise<{details: Record<string, Record<string, unknown>>}> {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
    const db = getAdminDb();
    const detailsCollection = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails');

    const snaps = await Promise.all(
      bookIds.map(id => detailsCollection.doc(id).get()),
    );

    const details: Record<string, Record<string, unknown>> = {};
    snaps.forEach(snap => {
      if (snap.exists) {
        details[snap.id] = snap.data() || {};
      }
    });

    return {details};
  }
}
