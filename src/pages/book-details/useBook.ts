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
  updateDoc,
  serverTimestamp,
  addDoc,
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
              (user.email &&
                data.access &&
                data.access[user.email.toLowerCase()] &&
                (data.access[user.email.toLowerCase()] === 'owner' ||
                  data.access[user.email.toLowerCase()] === 'editor')),
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
      throw e;
    }
  };

  const updateReadingStatus = async (
    status: 'unset' | 'reading' | 'finished' | 'abandoned',
  ) => {
    if (!libraryId || !bookId || !user || !book) return;

    try {
      await updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), {
        [`userStatuses.${user.uid}`]: status,
        addedBy: book.addedBy || user.uid,
        addedAt: book.addedAt || serverTimestamp(),
      });
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.UPDATE,
        `libraries/${libraryId}/books/${bookId}`,
      );
      throw e;
    }
  };

  const addReview = async (rating: number, text: string) => {
    if (!libraryId || !bookId || !user)
      throw new Error('Missing review context');
    try {
      await addDoc(
        collection(db, 'libraries', libraryId, 'books', bookId, 'reviews'),
        {
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown User',
          rating,
          text,
          createdAt: serverTimestamp(),
        },
      );
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.CREATE,
        `libraries/${libraryId}/books/${bookId}/reviews`,
      );
      throw e;
    }
  };

  const updateBook = async (cleanForm: Partial<Book & BookDetailsPayload>) => {
    if (!libraryId || !bookId || !book) return;
    try {
      await updateDoc(
        doc(db, 'libraries', libraryId, 'books', bookId),
        cleanForm,
      );
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.UPDATE,
        `libraries/${libraryId}/books/${bookId}`,
      );
      throw e;
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
    updateReadingStatus,
    addReview,
    updateBook,
  };
}
