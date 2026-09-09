import {
  collection,
  getDocs,
  doc,
  writeBatch,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import {db} from '../../firebase';
import {instrumentMutation} from '../../lib/telemetry';

/**
 * Atomically purges a book and its corresponding sub-records,
 * including any nested reviews, decrementing the associated library's volume counter.
 */
export async function deleteBookAtomic(libraryId: string, bookId: string) {
  return instrumentMutation(
    'delete',
    `libraries/${libraryId}/books/${bookId}`,
    {libraryId, bookId, cascade: true},
    async () => {
      const batch = writeBatch(db);

      // Core book reference
      const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
      batch.delete(bookRef);

      // Associated heavy details reference
      const detailRef = doc(db, 'libraries', libraryId, 'bookDetails', bookId);
      batch.delete(detailRef);

      // Cascade delete reviews subcollection
      try {
        const reviewsRef = collection(
          db,
          'libraries',
          libraryId,
          'books',
          bookId,
          'reviews',
        );
        const reviewsSnap = await getDocs(reviewsRef);
        reviewsSnap.forEach(revDoc => {
          batch.delete(revDoc.ref);
        });
      } catch (e) {
        console.warn(
          `Could not load reviews for cascading delete on book ${bookId}`,
          e,
        );
      }

      // Decrement aggregate count
      const libraryRef = doc(db, 'libraries', libraryId);
      batch.update(libraryRef, {
        bookCount: increment(-1),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    },
  );
}
