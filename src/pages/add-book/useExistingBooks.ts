import {useState, useEffect} from 'react';
import {
  collection,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {BookDetails} from '../../services/bookApi';
import {useQueryClient} from '@tanstack/react-query';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../../lib/telemetry';
import {Book} from '../../types';

export function useExistingBooks(libraryId?: string) {
  const queryClient = useQueryClient();

  const cachedBooks = libraryId
    ? queryClient.getQueryData<Book[]>(['books', libraryId])
    : undefined;

  const [existingBooks, setExistingBooks] = useState<BookDetails[]>(
    () => (cachedBooks as unknown as BookDetails[]) || [],
  );

  useEffect(() => {
    if (!libraryId) return;

    // Fast-path: Check TanStack Query cache first
    const cached = queryClient.getQueryData<Book[]>(['books', libraryId]);
    if (cached && cached.length > 0) {
      setExistingBooks(cached as unknown as BookDetails[]);
      return;
    }

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unregister = DebugTelemetryEngine.getInstance().registerListener(
      'useExistingBooks',
      `libraries/${libraryId}/books`,
    );

    const unsubscribe = onSnapshot(
      booksRef,
      (snap: QuerySnapshot<DocumentData>) => {
        const fromCache = snap.metadata?.fromCache ?? false;
        const books = snap.docs.map(doc => doc.data() as BookDetails);
        const payloadBytes = calculatePayloadBytes(books);

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Queried existing books for duplicate check (${snap.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}/books`,
            fromCache,
            size: snap.size,
            bytes: payloadBytes,
            docCount: snap.size,
          },
        );

        setExistingBooks(books);
      },
      err => {
        handleFirestoreError(
          err,
          OperationType.LIST,
          `libraries/${libraryId}/books`,
        );
      },
    );

    return () => {
      unregister();
      unsubscribe();
    };
  }, [libraryId, queryClient]);

  return {existingBooks};
}
