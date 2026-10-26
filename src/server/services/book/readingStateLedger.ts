import {FieldValue} from 'firebase-admin/firestore';
import {
  SchemaValidationError,
  safeIdSchema,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  computeReadingStateKey,
  storedUserReadingStateDocSchema,
  userReadingStateBookSnapshotSchema,
} from '../../../schemas/readingState';
import {normalizeIsbnForDedupe} from '../../../lib/duplicateDetection';
import {normalizeFirestoreTimestamp} from './bookPartitioner';
import type {
  Book,
  ReadingStatusValue,
  StoredUserReadingStateDoc,
  UserReadingState,
  UserReadingStateBookSnapshot,
} from '../../../types';

export {computeReadingStateKey};

/**
 * Normalizes a book identifier that may either be a raw Firestore document ID (`abc123`)
 * or a `readingStates` key (`isbn:9780553573398` / `bookid:abc123`).
 */
export function parseBookOrStateIdentifier(rawId: string): {
  cleanBookId: string;
  isbnFromId?: string;
} {
  const trimmed = (rawId || '').trim();
  if (trimmed.startsWith('bookid:')) {
    return {
      cleanBookId: trimmed.slice('bookid:'.length),
    };
  }
  if (trimmed.startsWith('isbn:')) {
    const cleanIsbn = normalizeIsbnForDedupe(trimmed.slice('isbn:'.length));
    return {
      cleanBookId: cleanIsbn ? `isbn_${cleanIsbn}` : 'unknown_book',
      ...(cleanIsbn ? {isbnFromId: cleanIsbn} : {}),
    };
  }
  return {
    cleanBookId: trimmed,
  };
}

function resolveSafeBookId(
  rawBookId: string,
  bookData?: Record<string, unknown>,
): string {
  const dataBookId =
    typeof bookData?.id === 'string'
      ? bookData.id.trim()
      : typeof bookData?.bookId === 'string'
        ? bookData.bookId.trim()
        : '';
  if (dataBookId && safeIdSchema.safeParse(dataBookId).success) {
    return dataBookId;
  }
  const {cleanBookId} = parseBookOrStateIdentifier(rawBookId);
  if (safeIdSchema.safeParse(cleanBookId).success) {
    return cleanBookId;
  }
  return 'unknown_book';
}

/**
 * Strongly typed Firestore write payload for `/users/{userId}/readingStates/{stateKey}`.
 * Extends `StoredUserReadingStateDoc` while allowing `FieldValue.serverTimestamp()` and `FieldValue.delete()`.
 */
export interface StoredUserReadingStateWritePayload extends Omit<
  Partial<StoredUserReadingStateDoc>,
  'updatedAt' | 'readStatusReviewedAt'
> {
  id: string;
  userId: string;
  keyType: 'isbn' | 'bookid';
  bookId: string;
  updatedAt: unknown;
  readStatusReviewedAt?: string | null | unknown;
}

export function getReadingStatesCollection(
  db: FirebaseFirestore.Firestore,
  userId: string,
): FirebaseFirestore.CollectionReference | undefined {
  if (!userId) {
    return undefined;
  }
  try {
    const usersCol = db.collection('users') as
      FirebaseFirestore.CollectionReference | undefined;
    if (!usersCol || typeof usersCol.doc !== 'function') {
      return undefined;
    }
    const userDoc = usersCol.doc(userId);
    if (!userDoc || typeof userDoc.collection !== 'function') {
      return undefined;
    }
    return userDoc.collection('readingStates');
  } catch {
    return undefined;
  }
}

export function buildBookSnapshotFromData(
  bookData: Record<string, unknown>,
  options?: {
    bookId?: string;
    libraryId?: string;
    libraryName?: string;
  },
): UserReadingStateBookSnapshot {
  const title =
    typeof bookData.title === 'string' && bookData.title.trim().length > 0
      ? bookData.title.trim()
      : 'Untitled Book';
  const author =
    typeof bookData.author === 'string' && bookData.author.trim().length > 0
      ? bookData.author.trim()
      : 'Unknown Author';
  const isbn =
    typeof bookData.isbn === 'string' && bookData.isbn.trim().length > 0
      ? bookData.isbn.trim()
      : undefined;
  const cleanIsbn =
    typeof bookData.cleanIsbn === 'string' &&
    bookData.cleanIsbn.trim().length > 0
      ? bookData.cleanIsbn.trim()
      : normalizeIsbnForDedupe(isbn) || undefined;

  const rawBookIdCandidate =
    options?.bookId ||
    (typeof bookData.id === 'string'
      ? bookData.id
      : typeof bookData.bookId === 'string'
        ? bookData.bookId
        : undefined);
  const safeSnapshotBookId = rawBookIdCandidate
    ? resolveSafeBookId(rawBookIdCandidate, bookData)
    : undefined;

  const candidate: UserReadingStateBookSnapshot = {
    title,
    author,
    ...(isbn ? {isbn} : {}),
    ...(cleanIsbn ? {cleanIsbn} : {}),
    ...(typeof bookData.coverUrl === 'string' && bookData.coverUrl
      ? {coverUrl: bookData.coverUrl}
      : {}),
    ...(typeof bookData.publishedDate === 'string' && bookData.publishedDate
      ? {publishedDate: bookData.publishedDate}
      : {}),
    ...(typeof bookData.primaryGenre === 'string' && bookData.primaryGenre
      ? {primaryGenre: bookData.primaryGenre}
      : {}),
    ...(Array.isArray(bookData.subgenres) && bookData.subgenres.length > 0
      ? {subgenres: bookData.subgenres as string[]}
      : {}),
    ...(typeof bookData.series === 'string' && bookData.series
      ? {series: bookData.series}
      : {}),
    ...(bookData.format === 'physical' || bookData.format === 'digital'
      ? {format: bookData.format}
      : {}),
    ...(typeof bookData.synopsis === 'string' && bookData.synopsis
      ? {synopsis: bookData.synopsis}
      : {}),
    ...(typeof bookData.authorBio === 'string' && bookData.authorBio
      ? {authorBio: bookData.authorBio}
      : {}),
    ...(bookData.geoMetadata && typeof bookData.geoMetadata === 'object'
      ? {
          geoMetadata:
            bookData.geoMetadata as UserReadingStateBookSnapshot['geoMetadata'],
        }
      : {}),
    ...(bookData.temporalMetadata &&
    typeof bookData.temporalMetadata === 'object'
      ? {
          temporalMetadata:
            bookData.temporalMetadata as UserReadingStateBookSnapshot['temporalMetadata'],
        }
      : {}),
    ...(bookData.clusterCoordinates &&
    typeof bookData.clusterCoordinates === 'object'
      ? {
          clusterCoordinates:
            bookData.clusterCoordinates as UserReadingStateBookSnapshot['clusterCoordinates'],
        }
      : {}),
    ...(options?.libraryId || typeof bookData.libraryId === 'string'
      ? {libraryId: options?.libraryId || (bookData.libraryId as string)}
      : {}),
    ...(options?.libraryName || typeof bookData.libraryName === 'string'
      ? {libraryName: options?.libraryName || (bookData.libraryName as string)}
      : {}),
    ...(safeSnapshotBookId ? {bookId: safeSnapshotBookId} : {}),
    ...(bookData.ownershipStatus === 'owned' ||
    bookData.ownershipStatus === 'unowned'
      ? {ownershipStatus: bookData.ownershipStatus}
      : {}),
  };

  return validateFirestoreReadPayload(
    userReadingStateBookSnapshotSchema,
    candidate,
    {
      entity: 'UserReadingStateBookSnapshot',
      operation: 'read',
    },
  );
}

export interface BuildReadingStateMutationOptions {
  userId: string;
  bookId: string;
  libraryId?: string;
  libraryName?: string;
  isbn?: string | null;
  cleanIsbn?: string | null;
  status?: ReadingStatusValue;
  rating?: number;
  reviewText?: string;
  reviewedAt?: string | null;
  readStatusReviewedAt?: string | null;
  clearReadStatusReviewedAt?: boolean;
  bookData?: Record<string, unknown>;
}

/**
 * Typed Firestore converter and builder for `/users/{userId}/readingStates/{stateKey}`.
 */
export const readingStateConverter = {
  toUpsertDoc(options: BuildReadingStateMutationOptions): {
    stateKey: string;
    payload: StoredUserReadingStateWritePayload;
  } {
    const {isbnFromId} = parseBookOrStateIdentifier(options.bookId);
    const safeBookId = resolveSafeBookId(options.bookId, options.bookData);
    const normalizedIsbn = normalizeIsbnForDedupe(
      options.cleanIsbn ||
        options.isbn ||
        isbnFromId ||
        (typeof options.bookData?.cleanIsbn === 'string'
          ? options.bookData.cleanIsbn
          : typeof options.bookData?.isbn === 'string'
            ? options.bookData.isbn
            : undefined),
    );
    const stateKey = computeReadingStateKey({
      cleanIsbn: normalizedIsbn,
      bookId: safeBookId,
    });
    const keyType: 'isbn' | 'bookid' =
      normalizedIsbn.length > 0 ? 'isbn' : 'bookid';
    const nowIso = new Date().toISOString();

    const payload: StoredUserReadingStateWritePayload = {
      id: stateKey,
      userId: options.userId,
      keyType,
      ...(normalizedIsbn.length > 0 ? {cleanIsbn: normalizedIsbn} : {}),
      bookId: safeBookId,
      ...(options.libraryId ? {libraryId: options.libraryId} : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (options.status !== undefined) {
      payload.status = options.status;
      if (options.status === 'reading') {
        payload.startedAt = nowIso;
      } else if (
        options.status === 'finished' ||
        options.status === 'completed'
      ) {
        payload.finishedAt = nowIso;
      }
    }

    if (typeof options.rating === 'number' && options.rating >= 1) {
      payload.rating = options.rating;
    }

    if (options.reviewText !== undefined) {
      payload.reviewText = options.reviewText;
      payload.reviewedAt = options.reviewedAt ?? nowIso;
    }

    if (options.clearReadStatusReviewedAt) {
      payload.readStatusReviewedAt =
        typeof (FieldValue as {delete?: () => unknown}).delete === 'function'
          ? FieldValue.delete()
          : null;
    } else if (options.readStatusReviewedAt !== undefined) {
      payload.readStatusReviewedAt = options.readStatusReviewedAt;
    }

    if (options.bookData && Object.keys(options.bookData).length > 0) {
      payload.bookSnapshot = buildBookSnapshotFromData(options.bookData, {
        bookId: safeBookId,
        libraryId: options.libraryId,
        libraryName: options.libraryName,
      });
    }

    validateFirestoreWritePayload(storedUserReadingStateDocSchema, payload, {
      entity: 'StoredUserReadingStateDoc',
      documentPath: `/users/${options.userId}/readingStates/${stateKey}`,
      operation: 'upsert',
    });

    return {stateKey, payload};
  },

  fromFirestore(
    docId: string,
    raw: Record<string, unknown>,
    fallbackUserId = 'unknown_user',
  ): StoredUserReadingStateDoc {
    const status =
      typeof raw.status === 'string'
        ? (raw.status as ReadingStatusValue)
        : undefined;
    const rating =
      typeof raw.rating === 'number' && raw.rating >= 1
        ? raw.rating
        : undefined;
    const reviewText =
      typeof raw.reviewText === 'string' ? raw.reviewText : undefined;
    const reviewedAt = normalizeFirestoreTimestamp(raw.reviewedAt);
    const startedAt = normalizeFirestoreTimestamp(raw.startedAt);
    const finishedAt = normalizeFirestoreTimestamp(raw.finishedAt);
    const readStatusReviewedAt = normalizeFirestoreTimestamp(
      raw.readStatusReviewedAt,
    );
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);

    let normalizedSnapshot: UserReadingStateBookSnapshot | undefined;
    if (raw.bookSnapshot && typeof raw.bookSnapshot === 'object') {
      const snapCopy: Record<string, unknown> = {
        ...(raw.bookSnapshot as Record<string, unknown>),
      };
      for (const k of Object.keys(snapCopy)) {
        if (snapCopy[k] === undefined) {
          delete snapCopy[k];
        }
      }
      normalizedSnapshot = validateFirestoreReadPayload(
        userReadingStateBookSnapshotSchema,
        snapCopy,
        {
          entity: 'UserReadingStateBookSnapshot',
          documentPath: `readingStates/${docId}`,
          operation: 'read',
        },
      );
    }

    const resolvedUserId =
      typeof raw.userId === 'string' && raw.userId.trim().length > 0
        ? raw.userId
        : fallbackUserId;
    const resolvedKeyType: 'isbn' | 'bookid' =
      raw.keyType === 'isbn' || raw.keyType === 'bookid'
        ? raw.keyType
        : docId.startsWith('isbn:')
          ? 'isbn'
          : 'bookid';

    const candidate: Record<string, unknown> = {
      ...raw,
      id: docId,
      userId: resolvedUserId,
      keyType: resolvedKeyType,
    };

    if (typeof raw.cleanIsbn === 'string' && raw.cleanIsbn) {
      candidate.cleanIsbn = raw.cleanIsbn;
    } else {
      delete candidate.cleanIsbn;
    }
    if (typeof raw.bookId === 'string' && raw.bookId) {
      candidate.bookId = raw.bookId;
    } else {
      delete candidate.bookId;
    }
    if (typeof raw.libraryId === 'string' && raw.libraryId) {
      candidate.libraryId = raw.libraryId;
    } else {
      delete candidate.libraryId;
    }
    if (status !== undefined) {
      candidate.status = status;
    } else {
      delete candidate.status;
    }
    if (rating !== undefined) {
      candidate.rating = rating;
    } else {
      delete candidate.rating;
    }
    if (reviewText !== undefined) {
      candidate.reviewText = reviewText;
    } else {
      delete candidate.reviewText;
    }
    if (reviewedAt !== undefined) {
      candidate.reviewedAt = reviewedAt;
    } else if (raw.reviewedAt === null) {
      candidate.reviewedAt = null;
    } else {
      delete candidate.reviewedAt;
    }
    if (startedAt !== undefined) {
      candidate.startedAt = startedAt;
    } else if (raw.startedAt === null) {
      candidate.startedAt = null;
    } else {
      delete candidate.startedAt;
    }
    if (finishedAt !== undefined) {
      candidate.finishedAt = finishedAt;
    } else if (raw.finishedAt === null) {
      candidate.finishedAt = null;
    } else {
      delete candidate.finishedAt;
    }
    if (readStatusReviewedAt !== undefined) {
      candidate.readStatusReviewedAt = readStatusReviewedAt;
    } else if (raw.readStatusReviewedAt === null) {
      candidate.readStatusReviewedAt = null;
    } else {
      delete candidate.readStatusReviewedAt;
    }
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    if (normalizedSnapshot !== undefined) {
      candidate.bookSnapshot = normalizedSnapshot;
    } else {
      delete candidate.bookSnapshot;
    }

    for (const k of Object.keys(candidate)) {
      if (candidate[k] === undefined) {
        delete candidate[k];
      }
    }

    return validateFirestoreReadPayload(
      storedUserReadingStateDocSchema,
      candidate,
      {
        entity: 'StoredUserReadingStateDoc',
        documentPath: `/users/${resolvedUserId}/readingStates/${docId}`,
        operation: 'read',
      },
    );
  },
};

export function buildReadingStateUpsertPayload(
  options: BuildReadingStateMutationOptions,
): {
  stateKey: string;
  payload: StoredUserReadingStateWritePayload;
} {
  return readingStateConverter.toUpsertDoc(options);
}

export function normalizeReadingStateDoc(
  docId: string,
  raw: Record<string, unknown>,
  fallbackUserId = 'unknown_user',
): Partial<UserReadingState> {
  return readingStateConverter.fromFirestore(docId, raw, fallbackUserId);
}

/**
 * Fetches a single reading state document for a book using the strict single-lookup key rule:
 * - If the book has an ISBN, ONLY looks up `isbn:<NORMALIZED_ISBN>`.
 * - If the book does not have an ISBN, ONLY looks up `bookid:<BOOK_ID>`.
 */
export async function fetchUserReadingStateForBook(
  db: FirebaseFirestore.Firestore,
  userId: string,
  book: {id: string; isbn?: string; cleanIsbn?: string},
): Promise<Partial<UserReadingState> | undefined> {
  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (!readingStatesCol || typeof readingStatesCol.doc !== 'function') {
    return undefined;
  }

  const stateKey = computeReadingStateKey({
    isbn: book.isbn,
    cleanIsbn: book.cleanIsbn,
    bookId: book.id,
  });

  try {
    const docRef = readingStatesCol.doc(stateKey);
    if (!docRef || typeof docRef.get !== 'function') {
      return undefined;
    }
    const snap = await docRef.get();
    if (!snap || !snap.exists) {
      return undefined;
    }
    return normalizeReadingStateDoc(
      snap.id || stateKey,
      (snap.data() || {}) as Record<string, unknown>,
      userId,
    );
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    return undefined;
  }
}

/**
 * Loads all reading state documents for a user into an O(1) lookup Map keyed by `stateKey`
 * (`isbn:<NORMALIZED_ISBN>` or `bookid:<BOOK_ID>`).
 */
export async function fetchUserReadingStatesMap(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<Map<string, Partial<UserReadingState>>> {
  const map = new Map<string, Partial<UserReadingState>>();
  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (!readingStatesCol || typeof readingStatesCol.get !== 'function') {
    return map;
  }

  try {
    const snap = await readingStatesCol.get();
    for (const doc of snap?.docs || []) {
      const normalized = normalizeReadingStateDoc(
        doc.id,
        (doc.data() || {}) as Record<string, unknown>,
        userId,
      );
      map.set(doc.id, normalized);
    }
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    // Return empty map if readingStates collection is not yet populated or mocked
  }

  return map;
}

/**
 * Overlays caller-scoped reading state fields onto a Book DTO using the strict single-lookup key.
 */
export function overlayReadingStateOnBook(
  book: Book,
  state?: Partial<UserReadingState>,
): Book {
  if (!state) {
    return book;
  }
  return {
    ...book,
    ...(state.status ? {readingStatus: state.status} : {}),
    ...(typeof state.rating === 'number' ? {userRating: state.rating} : {}),
    ...(state.readStatusReviewedAt !== undefined
      ? {readStatusReviewedAt: state.readStatusReviewedAt}
      : {}),
    ...(state.startedAt !== undefined ? {startedAt: state.startedAt} : {}),
    ...(state.finishedAt !== undefined ? {finishedAt: state.finishedAt} : {}),
  };
}
