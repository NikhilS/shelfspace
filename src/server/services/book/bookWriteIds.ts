import {TRPCError} from '@trpc/server';
import {safeBookOrStateIdSchema} from '../../../schemas/book';
import {safeIdSchema} from '../../../schemas/common';
import {bookDocConverter} from './bookPartitioner';
import {
  computeReadingStateKey,
  getReadingStatesCollection,
  normalizeReadingStateDoc,
  parseBookOrStateIdentifier,
} from './readingStateLedger';

export function assertSafeDocId(id: string, label: string): string {
  const parsed = safeIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid ${label}: ${parsed.error.issues[0]?.message || 'invalid identifier'}`,
    });
  }
  return parsed.data;
}

export function assertSafeBookOrStateId(id: string, label: string): string {
  const parsed = safeBookOrStateIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid ${label}: ${parsed.error.issues[0]?.message || 'invalid identifier'}`,
    });
  }
  return parsed.data;
}

export async function fetchExistingBookDataForSnapshot(
  db: FirebaseFirestore.Firestore,
  libraryId: string,
  bookIdRaw: string,
  userId?: string,
): Promise<Record<string, unknown> | undefined> {
  const {cleanBookId, isbnFromId} = parseBookOrStateIdentifier(bookIdRaw);
  const booksCol = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');

  const isExtPrefixed = bookIdRaw.startsWith('ext:');

  if (!isExtPrefixed) {
    const snap = await booksCol.doc(cleanBookId).get();
    if (snap.exists) {
      const raw = (snap.data() || {}) as Record<string, unknown>;
      return bookDocConverter.fromFirestore(
        cleanBookId,
        raw,
        `/libraries/${libraryId}/books/${cleanBookId}`,
      );
    }
  }

  if (isbnFromId) {
    const isbnSnap = await booksCol
      .where('cleanIsbn', '==', isbnFromId)
      .limit(1)
      .get();
    const matchedDoc = isbnSnap.docs[0];
    if (matchedDoc?.exists) {
      const raw = (matchedDoc.data() || {}) as Record<string, unknown>;
      return bookDocConverter.fromFirestore(
        matchedDoc.id,
        raw,
        `/libraries/${libraryId}/books/${matchedDoc.id}`,
      );
    }
  }

  if (userId) {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol) {
      const candidateKeys: string[] = [];
      if (!isExtPrefixed) {
        candidateKeys.push(
          computeReadingStateKey({
            libraryId,
            cleanIsbn: isbnFromId,
            bookId: cleanBookId,
          }),
        );
      }
      if (isbnFromId) {
        const extKey = `ext:${isbnFromId}`;
        if (!candidateKeys.includes(extKey)) {
          candidateKeys.push(extKey);
        }
      }

      for (const candidateKey of candidateKeys) {
        const stateSnap = await readingStatesCol.doc(candidateKey).get();
        if (stateSnap.exists) {
          const parsedState = normalizeReadingStateDoc(
            stateSnap.id || candidateKey,
            stateSnap.data() || {},
            userId,
          );
          if (parsedState.bookSnapshot) {
            return {
              ...parsedState.bookSnapshot,
              id:
                parsedState.bookId ||
                parsedState.bookSnapshot.bookId ||
                cleanBookId,
              ...(parsedState.bookSnapshot.isbn || parsedState.cleanIsbn
                ? {
                    isbn:
                      parsedState.bookSnapshot.isbn || parsedState.cleanIsbn,
                  }
                : {}),
              ...(parsedState.cleanIsbn || parsedState.bookSnapshot.cleanIsbn
                ? {
                    cleanIsbn:
                      parsedState.cleanIsbn ||
                      parsedState.bookSnapshot.cleanIsbn,
                  }
                : {}),
            };
          }
        }
      }
    }
  }

  return undefined;
}
