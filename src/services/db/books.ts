import {
  collection,
  query,
  getCountFromServer,
  doc,
  writeBatch,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';

/**
 * Atomically purges a book and its corresponding sub-records,
 * decrementing the associated library's volume counter.
 */
export async function deleteBookAtomic(libraryId: string, bookId: string) {
  const batch = writeBatch(db);

  // Core book reference
  const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
  batch.delete(bookRef);

  // Associated heavy details reference
  const detailRef = doc(db, 'libraries', libraryId, 'bookDetails', bookId);
  batch.delete(detailRef);

  // Decrement aggregate count
  const libraryRef = doc(db, 'libraries', libraryId);
  batch.update(libraryRef, {
    bookCount: increment(-1),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Performs a highly-efficient server-side count query to reconcile
 * the physical number of books currently cataloged in the library.
 */
export async function reconcileBookCount(libraryId: string): Promise<number> {
  const booksRef = collection(db, 'libraries', libraryId, 'books');
  const q = query(booksRef);
  try {
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.GET,
      `libraries/${libraryId}/books`,
    );
    throw error;
  }
}
