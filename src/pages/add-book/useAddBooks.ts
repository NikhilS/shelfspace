import {useState} from 'react';
import {collection, doc, serverTimestamp, increment} from 'firebase/firestore';
import {db, auth} from '../../firebase';
import {uploadBase64Image} from '../../services/db/storage';
import {BookDetails} from '../../services/bookApi';
import {useAuth} from '../../contexts/AuthContext';
import {logger} from '../../contexts/DebugContext';
import {toast} from 'sonner';

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
): never {
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
    if (books.length === 0) return [];

    setIsAddingAll(true);
    logger.info(`[useAddBooks] Starting addBooks for ${books.length} books`);

    const toastId = toast.loading(
      `Preparing to add ${books.length} book${books.length === 1 ? '' : 's'} to your library...`,
      {
        description: 'Starting background sync...',
      },
    );

    try {
      // 1. Give each new book an ID first so we can map results back correctly
      const booksWithIds = books.map(b => ({
        id: doc(collection(db, 'libraries', libraryId, 'books')).id,
        ...b,
      }));

      // 2. Fetch all initial metadata from the unified layer
      const enrichedDataMap: Record<string, unknown> = {};
      try {
        logger.info(
          `[useAddBooks] Requesting server-side enrich-create for ${booksWithIds.length} books...`,
        );
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(
          `/api/libraries/${libraryId}/metadata/enrich-create`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
            body: JSON.stringify({books: booksWithIds}),
          },
        );

        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.results) {
            data.results.forEach((r: {id: string; [key: string]: unknown}) => {
              enrichedDataMap[r.id] = r;
            });
          }
        }
      } catch (err) {
        logger.error(`[useAddBooks] Failed to fetch enrich-create: ${err}`);
      }

      const {ClientBulkWriter} = await import('../../lib/clientBulkWriter');
      const writer = new ClientBulkWriter(db, 50); // Safe batchSize

      let addedCount = 0;

      for (let i = 0; i < booksWithIds.length; i++) {
        const book = booksWithIds[i];
        const added = i;
        const remaining = booksWithIds.length - i;

        toast.loading(`Processing "${book.title || 'Untitled Book'}"...`, {
          id: toastId,
          description: `Added: ${added} | Remaining: ${remaining} (Working...)`,
        });

        const cleanBook = Object.fromEntries(
          Object.entries(book).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        ) as Record<string, string | string[] | undefined>;

        const bookId = book.id;
        const newDocRef = doc(db, 'libraries', libraryId, 'books', bookId);

        if (typeof cleanBook.title === 'string')
          cleanBook.title = cleanBook.title.slice(0, 500);
        if (typeof cleanBook.author === 'string')
          cleanBook.author = cleanBook.author.slice(0, 500);

        if (
          cleanBook.coverUrl &&
          typeof cleanBook.coverUrl === 'string' &&
          cleanBook.coverUrl.startsWith('data:')
        ) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover.png`;
          cleanBook.coverUrl = await uploadBase64Image(
            cleanBook.coverUrl,
            storagePath,
          );
        }

        if (
          cleanBook.coverUrlRaw &&
          typeof cleanBook.coverUrlRaw === 'string' &&
          cleanBook.coverUrlRaw.startsWith('data:')
        ) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover_raw.png`;
          cleanBook.coverUrlRaw = await uploadBase64Image(
            cleanBook.coverUrlRaw,
            storagePath,
          );
        }

        const enrichedForBook = enrichedDataMap[bookId] || {};

        const {
          synopsis = enrichedForBook.synopsis || undefined,
          authorBio = enrichedForBook.authorBio || undefined,
          embedding = enrichedForBook.embeddings || undefined,
          clusterCoordinates,
          ...lightweightData
        } = cleanBook;

        writer.set(newDocRef, {
          ...lightweightData,
          addedBy: user.uid,
          addedAt: serverTimestamp(),
          format: lightweightData.format || 'physical',
        });

        const finalEmbedding = embedding;

        const heavyData = {
          synopsis,
          authorBio,
          embedding: finalEmbedding,
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
          writer.set(detailRef, cleanHeavy);
        }
        addedCount++;
      }

      const libRef = doc(db, 'libraries', libraryId);
      writer.update(libRef, {
        bookCount: increment(addedCount),
        updatedAt: serverTimestamp(),
      });

      toast.loading(
        `Committing ${books.length} book${books.length === 1 ? '' : 's'}...`,
        {
          id: toastId,
          description: 'Writing securely to cloud...',
        },
      );

      logger.info(
        `[useAddBooks] Committing additions for ${addedCount} books via ClientBulkWriter...`,
      );
      await writer.close();
      logger.info('[useAddBooks] Batch commit successful.');

      const successTitle =
        books.length === 1
          ? `Successfully added "${books[0].title}"!`
          : `Successfully added ${books.length} books!`;
      const successDesc =
        books.length === 1
          ? 'Your book is now on your shelves.'
          : `Added: ${books.length} | Remaining: 0 (Done)`;

      toast.success(successTitle, {
        id: toastId,
        description: successDesc,
      });

      logger.info(`[useAddBooks] Successfully added ${books.length} books.`);
      return books;
    } catch (err) {
      logger.error(
        `[useAddBooks] Failed to add books: ${err instanceof Error ? err.message : String(err)}`,
      );
      toast.error('Failed to add books', {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `libraries/${libraryId}/books`,
      );
    } finally {
      setIsAddingAll(false);
    }
  };

  return {addBooks, isAddingAll};
}
