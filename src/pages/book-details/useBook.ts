import {useState, useEffect, useMemo} from 'react';
import {
  doc,
  collection,
  query,
  onSnapshot,
  orderBy,
  writeBatch,
  increment,
  getDocs,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
import {useAuth} from '../../contexts/AuthContext';

export interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: FirestoreDate;
}

export function useBook(
  libraryId: string | undefined,
  bookId: string | undefined,
) {
  const {user} = useAuth();
  const [bookBase, setBookBase] = useState<Book | null>(null);
  const [bookDetails, setBookDetails] = useState<BookDetailsPayload | null>(
    null,
  );
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const book = useMemo(() => {
    if (!bookBase) return null;
    return {...bookBase, ...bookDetails};
  }, [bookBase, bookDetails]);

  useEffect(() => {
    if (!libraryId || !user) return;

    const unsubscribe = onSnapshot(
      doc(db, 'libraries', libraryId),
      libDoc => {
        if (libDoc.exists()) {
          const data = libDoc.data();
          setCanEdit(
            data.ownerId === user.uid ||
              (data.sharedWith && data.sharedWith.includes(user.email || '')),
          );
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}`,
        );
      },
    );

    return () => unsubscribe();
  }, [libraryId, user]);

  useEffect(() => {
    if (!libraryId || !bookId) return;

    setIsLoading(true);

    const unsubscribeBook = onSnapshot(
      doc(db, 'libraries', libraryId, 'books', bookId),
      docSnap => {
        if (docSnap.exists()) {
          setBookBase({id: docSnap.id, ...docSnap.data()} as Book);
          setIsLoading(false);
        } else {
          setBookBase(null);
          setIsLoading(false);
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books/${bookId}`,
        );
        setIsLoading(false);
      },
    );

    const unsubscribeDetails = onSnapshot(
      doc(db, 'libraries', libraryId, 'bookDetails', bookId),
      docSnap => {
        if (docSnap.exists()) {
          setBookDetails(docSnap.data() as BookDetailsPayload);
        } else {
          setBookDetails(null);
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/bookDetails/${bookId}`,
        );
      },
    );

    const reviewsRef = collection(
      db,
      'libraries',
      libraryId,
      'books',
      bookId,
      'reviews',
    );
    const q = query(reviewsRef, orderBy('createdAt', 'desc'));
    const unsubscribeReviews = onSnapshot(
      q,
      snapshot => {
        const revs: Review[] = [];
        snapshot.forEach(doc => {
          revs.push({id: doc.id, ...doc.data()} as Review);
        });
        setReviews(revs);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books/${bookId}/reviews`,
        );
      },
    );

    return () => {
      unsubscribeBook();
      unsubscribeDetails();
      unsubscribeReviews();
    };
  }, [libraryId, bookId]);

  const deleteBook = async () => {
    if (!libraryId || !bookId) return;

    const batch = writeBatch(db);
    batch.delete(doc(db, 'libraries', libraryId, 'books', bookId));
    batch.delete(doc(db, 'libraries', libraryId, 'bookDetails', bookId));
    batch.update(doc(db, 'libraries', libraryId), {
      bookCount: increment(-1),
    });

    // Cleanup reviews (small scale deletion)
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
      handleFirestoreError(
        e,
        OperationType.GET,
        `libraries/${libraryId}/books/${bookId}/reviews`,
      );
    }

    try {
      await batch.commit();
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.DELETE,
        `libraries/${libraryId}/books/${bookId}`,
      );
    }
  };

  return {
    book,
    bookBase,
    bookDetails,
    setBookBase,
    setBookDetails,
    reviews,
    setReviews,
    isLoading,
    canEdit,
    deleteBook,
  };
}
