import {useState} from 'react';
import {
  collection,
  writeBatch,
  doc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import {db, auth} from '../../firebase';
import {BookDetails} from '../../services/bookApi';
import {useAuth} from '../../contexts/AuthContext';
import {logger} from '../../contexts/DebugContext';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function useAddBooks(libraryId?: string) {
  const {user} = useAuth();
  const [isAddingAll, setIsAddingAll] = useState(false);

  const addBooks = async (books: BookDetails[]) => {
    if (!libraryId || !user) {
      console.error('Library ID or User missing', {libraryId, user: !!user});
      throw new Error('Access denied or library not found');
    }
    if (books.length === 0) return;

    setIsAddingAll(true);
    logger.info(`[useAddBooks] Starting addBooks for ${books.length} books`);

    try {
      const BATCH_SIZE = 200;
      const chunks: BookDetails[][] = [];
      for (let i = 0; i < books.length; i += BATCH_SIZE) {
        chunks.push(books.slice(i, i + BATCH_SIZE));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        let currentBatchCount = 0;

        for (const book of chunk) {
          const cleanBook = Object.fromEntries(
            Object.entries(book).filter(
              ([, v]) => v !== undefined && v !== null && v !== '',
            ),
          ) as Record<string, string | string[] | undefined>;

          if (typeof cleanBook.title === 'string')
            cleanBook.title = cleanBook.title.slice(0, 500);
          if (typeof cleanBook.author === 'string')
            cleanBook.author = cleanBook.author.slice(0, 500);

          const newDocRef = doc(
            collection(db, 'libraries', libraryId, 'books'),
          );

          const {
            synopsis,
            authorBio,
            embedding,
            clusterCoordinates,
            ...lightweightData
          } = cleanBook;

          batch.set(newDocRef, {
            ...lightweightData,
            addedBy: user.uid,
            addedAt: serverTimestamp(),
            format: lightweightData.format || 'physical',
          });

          const heavyData = {
            synopsis,
            authorBio,
            embedding,
            clusterCoordinates,
          };
          const cleanHeavy = Object.fromEntries(
            Object.entries(heavyData).filter(([, v]) => v !== undefined),
          );

          if (Object.keys(cleanHeavy).length > 0) {
            const detailRef = doc(
              db,
              'libraries',
              libraryId,
              'bookDetails',
              newDocRef.id,
            );
            batch.set(detailRef, cleanHeavy);
          }
          currentBatchCount++;
        }

        const libRef = doc(db, 'libraries', libraryId);
        batch.update(libRef, {
          bookCount: increment(currentBatchCount),
          updatedAt: serverTimestamp(),
        });

        logger.info(
          `[useAddBooks] Committing batch of ${currentBatchCount}...`,
        );
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `libraries/${libraryId}/books`,
          );
        }
        logger.info('[useAddBooks] Batch commit successful.');
      }

      logger.info(`[useAddBooks] Successfully added ${books.length} books.`);
      return books;
    } catch (err) {
      logger.error(
        `[useAddBooks] Failed to add books: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    } finally {
      setIsAddingAll(false);
    }
  };

  return {addBooks, isAddingAll};
}
