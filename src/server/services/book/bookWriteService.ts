import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import type {
  BookCreateInput,
  BookUpdateInput,
  BookDeleteInput,
  BookBatchUpsertInput,
} from '../../../schemas/book';
import type {Book, BookDetailsPayload, UserStatuses} from '../../../types';

export const HEAVY_FIELDS = new Set([
  'synopsis',
  'authorBio',
  'embedding',
  'clusterCoordinates',
  'description',
]);

/**
 * Creates a single book and stores heavy metadata (synopsis, embeddings) in bookDetails.
 * Atomically increments parent library volume counter.
 */
export async function createBook(
  userId: string,
  input: BookCreateInput,
): Promise<{success: true; id: string; book?: Book}> {
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
  const rawInput: Record<string, unknown> = {...input};
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
  ) as BookDetailsPayload;

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
    addedBy: userId || (rawInput.addedBy as string | null | undefined) || null,
    addedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    bookDetailsMetadata,
  };

  if (input.status && userId) {
    coreData.userStatuses = {
      ...((input.userStatuses as UserStatuses | undefined) || {}),
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
    const errMsg = formatFirestoreAdminError(err);
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
      ...(cleanCore as unknown as Book),
      id: bookId,
      ...(Object.keys(cleanHeavy).length > 0 ? {heavyDetails: cleanHeavy} : {}),
    },
  };
}

/**
 * Updates an existing book and propagates heavy updates to bookDetails.
 */
export async function updateBook(
  _userId: string,
  input: BookUpdateInput,
): Promise<{success: true; id?: string}> {
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
    const errMsg = formatFirestoreAdminError(err);
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
export async function deleteBook(
  _userId: string,
  input: BookDeleteInput,
): Promise<{success: true; id?: string}> {
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
    const errMsg = formatFirestoreAdminError(err);
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
export async function batchUpsert(
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
        db.collection('libraries').doc(libraryId).collection('books').doc().id;
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
        db.collection('libraries').doc(libraryId).collection('books').doc().id;
      const action = b.action || b.operation || (b.id ? 'upsert' : 'create');

      if (action === 'delete') {
        ops.push({type: 'delete', bookId});
      } else if (action === 'update') {
        const raw: Record<string, unknown> = {...b};
        delete raw.action;
        delete raw.operation;
        delete raw.id;
        delete raw.bookId;
        ops.push({type: 'update', bookId, coreData: raw});
      } else {
        // create or upsert
        const raw: Record<string, unknown> = {...b};
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
          heavyData: Object.keys(heavyData).length > 0 ? heavyData : undefined,
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
