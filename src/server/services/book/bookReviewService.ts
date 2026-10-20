import {getAdminDb} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {LibraryService} from '../library';
import type {BookReviewRecord} from '../../../types';
import {normalizeFirestoreTimestamp} from './bookPartitioner';

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

  const reviews: BookReviewRecord[] = reviewsSnap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      userId: d.userId,
      userName: d.userName || 'Anonymous',
      rating: typeof d.rating === 'number' ? d.rating : 0,
      text: d.text || '',
      createdAt: normalizeFirestoreTimestamp(d.createdAt),
    };
  });

  return {reviews};
}

/**
 * Adds a review for a specific book.
 */
export async function addReview(
  userId: string,
  userEmail: string | undefined,
  userName: string | undefined,
  libraryId: string,
  bookId: string,
  input: {rating: number; text: string},
  options?: {skipAccessCheck?: boolean},
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
  const reviewRef = bookRef.collection('reviews').doc();

  const reviewDoc = {
    userId,
    userName: userName || userEmail || 'Anonymous',
    rating: input.rating,
    text: input.text.trim(),
    createdAt: FieldValue.serverTimestamp(),
  };

  await reviewRef.set(reviewDoc);

  // Denormalize caller's star rating onto the parent book document for O(1) shelf rendering
  try {
    if (typeof (bookRef as {update?: unknown}).update === 'function') {
      await bookRef.update({
        [`userRatings.${userId}`]: input.rating,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal if parent book ref is a minimal test mock without .update()
  }

  return {success: true, id: reviewRef.id};
}
