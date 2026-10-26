import {getAdminDb} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {LibraryService} from '../library';
import {storedReviewDocSchema} from '../../../schemas/book';
import {
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import type {
  BookReviewRecord,
  ReadingStatusValue,
  StoredReviewDoc,
} from '../../../types';
import {normalizeFirestoreTimestamp} from './bookPartitioner';
import {
  buildReadingStateUpsertPayload,
  getReadingStatesCollection,
} from './readingStateLedger';
import {fetchExistingBookDataForSnapshot} from './bookWriteService';

export interface StoredReviewWritePayload extends Omit<
  StoredReviewDoc,
  'id' | 'createdAt' | 'updatedAt'
> {
  createdAt: unknown;
  updatedAt: unknown;
}

const storedReviewWriteSchema = storedReviewDocSchema.omit({id: true});

export const reviewDocConverter = {
  toFirestoreWrite(input: {
    userId: string;
    userName: string;
    rating: number;
    text: string;
  }): StoredReviewWritePayload {
    const payload: StoredReviewWritePayload = {
      userId: input.userId,
      userName: input.userName,
      rating: input.rating,
      text: input.text.trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(storedReviewWriteSchema, payload, {
      entity: 'StoredReviewDoc',
      documentPath: `reviews/${input.userId}`,
      operation: 'upsert',
    });
    return payload;
  },

  fromFirestore(docId: string, raw: Record<string, unknown>): BookReviewRecord {
    const createdAt = normalizeFirestoreTimestamp(raw.createdAt);
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: docId,
      userId: typeof raw.userId === 'string' ? raw.userId : docId,
      userName:
        typeof raw.userName === 'string' && raw.userName
          ? raw.userName
          : 'Anonymous',
      rating: typeof raw.rating === 'number' ? raw.rating : 0,
      text: typeof raw.text === 'string' ? raw.text : '',
    };
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
    return validateFirestoreReadPayload(storedReviewDocSchema, candidate, {
      entity: 'StoredReviewDoc',
      documentPath: `reviews/${docId}`,
      operation: 'read',
    });
  },
};

/**
 * Lists reviews for a specific book.
 */
export async function listReviews(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  bookId: string,
  options?: {skipAccessCheck?: boolean},
): Promise<{reviews: BookReviewRecord[]}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
  }

  const db = getAdminDb();
  const reviewsSnap = await db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId)
    .collection('reviews')
    .orderBy('createdAt', 'desc')
    .get();

  const reviews: BookReviewRecord[] = reviewsSnap.docs.map(doc =>
    reviewDocConverter.fromFirestore(
      doc.id,
      (doc.data() || {}) as Record<string, unknown>,
    ),
  );

  return {reviews};
}

/**
 * Adds or updates the caller's review for a specific book using deterministic review ID (`userId`),
 * and syncs `rating` and `reviewText` into `/users/{userId}/readingStates/{stateKey}`.
 */
export async function addReview(
  userId: string,
  userEmail: string | undefined,
  userName: string | undefined,
  libraryId: string,
  bookId: string,
  input: {rating: number; text: string},
  options?: {skipAccessCheck?: boolean; status?: string},
): Promise<{success: true; id: string}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
  }

  const db = getAdminDb();
  const bookRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId);

  const bookData = await fetchExistingBookDataForSnapshot(
    db,
    libraryId,
    bookId,
  );

  const reviewsCol = bookRef.collection('reviews');
  const reviewRef = reviewsCol.doc(userId) || reviewsCol.doc();

  const reviewDoc = reviewDocConverter.toFirestoreWrite({
    userId,
    userName: userName || userEmail || 'Anonymous',
    rating: input.rating,
    text: input.text,
  });

  const batch = db.batch();
  batch.set(reviewRef, reviewDoc, {merge: true});

  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (readingStatesCol) {
    const {stateKey, payload} = buildReadingStateUpsertPayload({
      userId,
      bookId,
      libraryId,
      isbn: typeof bookData?.isbn === 'string' ? bookData.isbn : undefined,
      cleanIsbn:
        typeof bookData?.cleanIsbn === 'string'
          ? bookData.cleanIsbn
          : undefined,
      status: options?.status as ReadingStatusValue | undefined,
      rating: input.rating,
      reviewText: input.text.trim(),
      bookData,
    });
    batch.set(readingStatesCol.doc(stateKey), payload, {merge: true});
  }

  await batch.commit();

  return {success: true, id: reviewRef.id || userId};
}
