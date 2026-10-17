import {getAdminDb} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {LibraryService} from '../library';
import type {BookReviewRecord} from '../../../types';

/**
 * Lists reviews for a specific book.
 */
export async function listReviews(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  bookId: string,
): Promise<{reviews: BookReviewRecord[]}> {
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

  const reviews: BookReviewRecord[] = reviewsSnap.docs.map(doc => {
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
export async function addReview(
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
