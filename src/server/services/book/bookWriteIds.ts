import {TRPCError} from '@trpc/server';
import {safeBookOrStateIdSchema} from '../../../schemas/book';
import {safeIdSchema} from '../../../schemas/common';
import {bookDocConverter, bookDetailsDocConverter} from './bookPartitioner';
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

  let resolvedBookId = cleanBookId;
  let bookData: Record<string, unknown> | undefined;

  if (!bookIdRaw.startsWith('isbn:')) {
    const bookRef = booksCol.doc(cleanBookId);
    if (typeof bookRef?.get === 'function') {
      try {
        const snap = await bookRef.get();
        if (snap?.exists) {
          const raw = (snap.data() || {}) as Record<string, unknown>;
          try {
            bookData = bookDocConverter.fromFirestore(
              cleanBookId,
              raw,
              `/libraries/${libraryId}/books/${cleanBookId}`,
            );
          } catch (convErr) {
            console.warn(
              `[BookWriteService] Converter fallback while building readingState snapshot for /libraries/${libraryId}/books/${cleanBookId}:`,
              convErr,
            );
            bookData = {...raw, id: cleanBookId};
          }
        }
      } catch {
        // Non-fatal in test mocks where bookRef.get is unconfigured
      }
    }
  }

  // If bookIdRaw was `isbn:<cleanIsbn>` and not found by direct doc ID, resolve by `cleanIsbn`.
  if (
    !bookData &&
    isbnFromId &&
    typeof (booksCol as {where?: unknown})?.where === 'function'
  ) {
    try {
      const isbnSnap = await booksCol
        .where('cleanIsbn', '==', isbnFromId)
        .limit(1)
        .get();
      const matchedDoc = isbnSnap?.docs?.[0];
      if (matchedDoc?.exists) {
        resolvedBookId = matchedDoc.id;
        const raw = (matchedDoc.data() || {}) as Record<string, unknown>;
        try {
          bookData = bookDocConverter.fromFirestore(
            resolvedBookId,
            raw,
            `/libraries/${libraryId}/books/${resolvedBookId}`,
          );
        } catch {
          bookData = {...raw, id: resolvedBookId};
        }
      }
    } catch {
      // Non-fatal if query is unconfigured in mocks
    }
  }

  if (bookData) {
    const meta = bookData.bookDetailsMetadata as
      | {
          hasSynopsis?: boolean;
          hasAuthorBio?: boolean;
          hasClusterCoordinates?: boolean;
        }
      | undefined;
    if (
      meta &&
      (meta.hasSynopsis || meta.hasAuthorBio || meta.hasClusterCoordinates)
    ) {
      try {
        const detailRef = db
          .collection('libraries')
          .doc(libraryId)
          .collection('bookDetails')
          .doc(resolvedBookId);
        if (typeof detailRef?.get === 'function') {
          const detailSnap = await detailRef.get();
          if (detailSnap?.exists) {
            const detailRaw = (detailSnap.data() || {}) as Record<
              string,
              unknown
            >;
            try {
              const parsedDetail = bookDetailsDocConverter.fromFirestore(
                resolvedBookId,
                detailRaw,
                `/libraries/${libraryId}/bookDetails/${resolvedBookId}`,
              );
              bookData = {...bookData, ...parsedDetail};
            } catch {
              bookData = {...bookData, ...detailRaw};
            }
          }
        }
      } catch {
        // Non-fatal if bookDetails cannot be fetched
      }
    }
    return bookData;
  }

  // Fallback to caller's existing `/users/{userId}/readingStates/{stateKey}` bookSnapshot
  if (userId) {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol && typeof readingStatesCol.doc === 'function') {
      const candidateKey = computeReadingStateKey({
        cleanIsbn: isbnFromId,
        bookId: cleanBookId,
      });
      try {
        const stateRef = readingStatesCol.doc(candidateKey);
        if (typeof stateRef?.get === 'function') {
          const stateSnap = await stateRef.get();
          if (stateSnap?.exists) {
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
      } catch {
        // Non-fatal if readingStates lookup fails
      }
    }
  }

  return undefined;
}
