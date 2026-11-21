import {FieldValue} from 'firebase-admin/firestore';
import {getAdminDb} from '../firebaseAdmin';
import {
  safeIdSchema,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  computeReadingStateKey,
  resolveReadingStateKeyType,
  storedUserReadingStateDocSchema,
  userReadingStateBookSnapshotSchema,
  type ReadingStateKeyType,
} from '../../../schemas/readingState';
import {normalizeIsbnForDedupe} from '../../../lib/duplicateDetection';
import {normalizeFirestoreTimestamp} from './bookPartitioner';
import {canRunBackgroundSelfHeal} from './bookLegacySelfHealer';
import type {
  Book,
  ReadingStatusValue,
  StoredUserReadingStateDoc,
  UserReadingState,
  UserReadingStateBookSnapshot,
} from '../../../types';

export {computeReadingStateKey, resolveReadingStateKeyType};

const MAX_SNAPSHOT_COVER_URL_LENGTH = 2048;

const DEPRECATED_BOOK_SNAPSHOT_KEYS = new Set([
  'id',
  'synopsis',
  'description',
  'summary',
  'authorBio',
  'subgenres',
  'genres',
  'genre',
  'isCustomPrimary',
  'geoMetadata',
  'temporalMetadata',
  'clusterCoordinates',
  'embedding',
  'enrichmentStatus',
  'bookDetailsMetadata',
  'missingFlags',
  'primaryGenreLower',
  'dedupeKey',
  'searchTokens',
  'coverUrlRaw',
  'coverCandidates',
  'sources',
  'fieldSources',
  'skippedProviders',
  'addedBy',
  'addedAt',
  'updatedAt',
  'createdAt',
  'isVirtual',
  'readingStatus',
  'userRating',
]);

const inFlightReadingStateHeals = new Set<string>();

/**
 * Normalizes a book identifier that may either be a raw Firestore document ID (`abc123`)
 * or a canonical `readingStates` key (`book:<libId>:<bookId>` or `ext:<isbn>`).
 */
export function parseBookOrStateIdentifier(rawId: string): {
  cleanBookId: string;
  libraryIdFromId?: string;
  isbnFromId?: string;
} {
  const trimmed = (rawId || '').trim();
  if (trimmed.startsWith('book:')) {
    const parts = trimmed.split(':');
    if (parts.length === 3 && parts[1] && parts[2]) {
      return {
        cleanBookId: parts[2],
        libraryIdFromId: parts[1],
      };
    }
  }
  if (trimmed.startsWith('ext:')) {
    const extValue = trimmed.slice('ext:'.length).trim();
    const cleanIsbn = normalizeIsbnForDedupe(extValue);
    const isNumericOrIsbn = /^[0-9X]+$/i.test(extValue);
    return {
      cleanBookId:
        cleanIsbn && isNumericOrIsbn
          ? `ext_${cleanIsbn}`
          : extValue || 'unknown_book',
      ...(cleanIsbn && isNumericOrIsbn ? {isbnFromId: cleanIsbn} : {}),
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

function sanitizeCoverUrlForStub(rawCoverUrl: unknown): string | undefined {
  if (typeof rawCoverUrl !== 'string') {
    return undefined;
  }
  const trimmed = rawCoverUrl.trim();
  if (!trimmed || trimmed.length > MAX_SNAPSHOT_COVER_URL_LENGTH) {
    return undefined;
  }
  if (trimmed.toLowerCase().startsWith('data:') && trimmed.length > 1500) {
    return undefined;
  }
  return trimmed;
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
  keyType: ReadingStateKeyType;
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
  return db.collection('users').doc(userId).collection('readingStates');
}

export function buildBookSnapshotFromData(
  bookData: Record<string, unknown>,
  options?: {
    bookId?: string;
    libraryId?: string;
    libraryName?: string;
  },
): UserReadingStateBookSnapshot {
  const title = (
    typeof bookData.title === 'string' && bookData.title.trim().length > 0
      ? bookData.title.trim()
      : 'Untitled Book'
  ).slice(0, 300);
  const author = (
    typeof bookData.author === 'string' && bookData.author.trim().length > 0
      ? bookData.author.trim()
      : 'Unknown Author'
  ).slice(0, 300);
  const isbn =
    typeof bookData.isbn === 'string' && bookData.isbn.trim().length > 0
      ? bookData.isbn.trim().slice(0, 64)
      : undefined;
  const cleanIsbn =
    typeof bookData.cleanIsbn === 'string' &&
    bookData.cleanIsbn.trim().length > 0
      ? bookData.cleanIsbn.trim().slice(0, 64)
      : normalizeIsbnForDedupe(isbn)?.slice(0, 64) || undefined;

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

  const rawLibId =
    options?.libraryId ||
    (typeof bookData.libraryId === 'string' ? bookData.libraryId : undefined);
  const safeLibraryId =
    rawLibId &&
    rawLibId !== 'external' &&
    safeIdSchema.safeParse(rawLibId).success
      ? rawLibId
      : undefined;

  const rawLibName =
    options?.libraryName ||
    (typeof bookData.libraryName === 'string'
      ? bookData.libraryName
      : undefined);
  const safeCoverUrl = sanitizeCoverUrlForStub(bookData.coverUrl);

  const candidate: UserReadingStateBookSnapshot = {
    title,
    author,
    ...(isbn ? {isbn} : {}),
    ...(cleanIsbn ? {cleanIsbn} : {}),
    ...(safeCoverUrl ? {coverUrl: safeCoverUrl} : {}),
    ...(typeof bookData.publishedDate === 'string' && bookData.publishedDate
      ? {publishedDate: bookData.publishedDate.slice(0, 100)}
      : {}),
    ...(typeof bookData.primaryGenre === 'string' && bookData.primaryGenre
      ? {primaryGenre: bookData.primaryGenre.slice(0, 200)}
      : {}),
    ...(typeof bookData.series === 'string' && bookData.series
      ? {series: bookData.series.slice(0, 200)}
      : {}),
    ...(bookData.format === 'physical' || bookData.format === 'digital'
      ? {format: bookData.format}
      : {}),
    ...(safeLibraryId ? {libraryId: safeLibraryId} : {}),
    ...(typeof rawLibName === 'string' && rawLibName.trim().length > 0
      ? {libraryName: rawLibName.trim().slice(0, 200)}
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
  startedAt?: string | null;
  finishedAt?: string | null;
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
    const {isbnFromId, libraryIdFromId} = parseBookOrStateIdentifier(
      options.bookId,
    );
    const safeBookId = resolveSafeBookId(options.bookId, options.bookData);
    const effectiveLibraryId =
      options.libraryId ||
      libraryIdFromId ||
      (typeof options.bookData?.libraryId === 'string'
        ? options.bookData.libraryId
        : undefined);
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
      libraryId: effectiveLibraryId,
      cleanIsbn: normalizedIsbn,
      bookId: safeBookId,
    });
    const keyType = resolveReadingStateKeyType(stateKey);
    const nowIso = new Date().toISOString();

    const payload: StoredUserReadingStateWritePayload = {
      id: stateKey,
      userId: options.userId,
      keyType,
      ...(normalizedIsbn.length > 0 ? {cleanIsbn: normalizedIsbn} : {}),
      bookId: safeBookId,
      ...(effectiveLibraryId && effectiveLibraryId !== 'external'
        ? {libraryId: effectiveLibraryId}
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (options.status !== undefined) {
      payload.status = options.status;
      if (options.startedAt === undefined && options.status === 'reading') {
        payload.startedAt = nowIso;
      }
      if (options.finishedAt === undefined && options.status === 'finished') {
        payload.finishedAt = nowIso;
      }
    }

    if (options.startedAt !== undefined) {
      payload.startedAt = options.startedAt;
    }
    if (options.finishedAt !== undefined) {
      payload.finishedAt = options.finishedAt;
    }

    if (typeof options.rating === 'number' && options.rating >= 1) {
      payload.rating = options.rating;
    }

    if (options.reviewText !== undefined) {
      payload.reviewText = options.reviewText;
      payload.reviewedAt = options.reviewedAt ?? nowIso;
    }

    if (options.clearReadStatusReviewedAt) {
      payload.readStatusReviewedAt = FieldValue.delete();
    } else if (options.readStatusReviewedAt !== undefined) {
      payload.readStatusReviewedAt = options.readStatusReviewedAt;
    }

    if (options.bookData && Object.keys(options.bookData).length > 0) {
      payload.bookSnapshot = buildBookSnapshotFromData(options.bookData, {
        bookId: safeBookId,
        libraryId: effectiveLibraryId,
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
    let needsSelfHeal = false;
    const rawStatusStr =
      typeof raw.status === 'string' ? raw.status : undefined;
    const status: ReadingStatusValue | undefined =
      rawStatusStr === 'completed'
        ? ((needsSelfHeal = true), 'finished')
        : (rawStatusStr as ReadingStatusValue | undefined);
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
        if (snapCopy[k] === undefined || snapCopy[k] === null) {
          if (snapCopy[k] === null) {
            needsSelfHeal = true;
          }
          delete snapCopy[k];
        } else if (DEPRECATED_BOOK_SNAPSHOT_KEYS.has(k)) {
          delete snapCopy[k];
          needsSelfHeal = true;
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
    const resolvedKeyType: ReadingStateKeyType =
      raw.keyType === 'book' || raw.keyType === 'ext'
        ? raw.keyType
        : resolveReadingStateKeyType(docId);

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

    const parsedState = validateFirestoreReadPayload(
      storedUserReadingStateDocSchema,
      candidate,
      {
        entity: 'StoredUserReadingStateDoc',
        documentPath: `/users/${resolvedUserId}/readingStates/${docId}`,
        operation: 'read',
      },
    );

    if (
      needsSelfHeal &&
      resolvedUserId !== 'unknown_user' &&
      canRunBackgroundSelfHeal()
    ) {
      const healKey = `${resolvedUserId}:${docId}`;
      if (!inFlightReadingStateHeals.has(healKey)) {
        inFlightReadingStateHeals.add(healKey);
        const healPatch: Record<string, unknown> = {};
        if (parsedState.status !== undefined) {
          healPatch.status = parsedState.status;
        }
        if (parsedState.bookSnapshot !== undefined) {
          healPatch.bookSnapshot = parsedState.bookSnapshot;
        }
        if (Object.keys(healPatch).length > 0) {
          validateFirestoreWritePayload(
            storedUserReadingStateDocSchema.partial(),
            healPatch,
            {
              entity: 'StoredUserReadingStateDoc',
              documentPath: `/users/${resolvedUserId}/readingStates/${docId}`,
              operation: 'update',
            },
          );
          void getAdminDb()
            .collection('users')
            .doc(resolvedUserId)
            .collection('readingStates')
            .doc(docId)
            .update(healPatch)
            .catch(() => {})
            .finally(() => {
              inFlightReadingStateHeals.delete(healKey);
            });
        } else {
          inFlightReadingStateHeals.delete(healKey);
        }
      }
    }

    return parsedState;
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
 * Resolves a user's reading state from an in-memory map across canonical `book:<lib>:<id>` keys,
 * standalone `ext:<isbn>` keys, and cross-edition `cleanIsbn` matches.
 */
export function resolveReadingStateFromMap(
  readingStatesMap: Map<string, Partial<UserReadingState>>,
  target: {
    libraryId?: string;
    bookId: string;
    isbn?: string;
    cleanIsbn?: string;
  },
): Partial<UserReadingState> | undefined {
  if (readingStatesMap.size === 0) {
    return undefined;
  }

  const canonicalKey = computeReadingStateKey({
    libraryId: target.libraryId,
    isbn: target.isbn,
    cleanIsbn: target.cleanIsbn,
    bookId: target.bookId,
  });
  const directHit = readingStatesMap.get(canonicalKey);
  if (directHit) {
    return directHit;
  }

  const normalizedIsbn = normalizeIsbnForDedupe(
    target.cleanIsbn || target.isbn,
  );
  if (normalizedIsbn) {
    const extHit = readingStatesMap.get(`ext:${normalizedIsbn}`);
    if (extHit) {
      return extHit;
    }
    for (const entry of readingStatesMap.values()) {
      if (entry.cleanIsbn === normalizedIsbn) {
        return entry;
      }
    }
  }

  return undefined;
}

/**
 * Fetches the reading state document for a book using its canonical `book:<libraryId>:<bookId>` key
 * (with optional `ext:<cleanIsbn>` check when tracked as an external edition).
 */
export async function fetchUserReadingStateForBook(
  db: FirebaseFirestore.Firestore,
  userId: string,
  book: {id: string; libraryId?: string; isbn?: string; cleanIsbn?: string},
): Promise<Partial<UserReadingState> | undefined> {
  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (!readingStatesCol) {
    return undefined;
  }

  const candidateKeys: string[] = [];
  const primaryKey = computeReadingStateKey({
    libraryId: book.libraryId,
    isbn: book.isbn,
    cleanIsbn: book.cleanIsbn,
    bookId: book.id,
  });
  candidateKeys.push(primaryKey);

  const normalizedIsbn = normalizeIsbnForDedupe(book.cleanIsbn || book.isbn);
  if (normalizedIsbn) {
    const extKey = `ext:${normalizedIsbn}`;
    if (!candidateKeys.includes(extKey)) {
      candidateKeys.push(extKey);
    }
  }

  for (const key of candidateKeys) {
    const snap = await readingStatesCol.doc(key).get();
    if (snap.exists) {
      return normalizeReadingStateDoc(
        snap.id || key,
        snap.data() || {},
        userId,
      );
    }
  }

  return undefined;
}

/**
 * Loads all reading state documents for a user into a lookup Map keyed by `stateKey`.
 */
export async function fetchUserReadingStatesMap(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<Map<string, Partial<UserReadingState>>> {
  const map = new Map<string, Partial<UserReadingState>>();
  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (!readingStatesCol) {
    return map;
  }

  const snap = await readingStatesCol.get();
  for (const doc of snap.docs) {
    const normalized = normalizeReadingStateDoc(
      doc.id,
      doc.data() || {},
      userId,
    );
    map.set(doc.id, normalized);
  }

  return map;
}

/**
 * Loads lightweight reading-state overlay fields via Firestore `.select(...)` projection,
 * omitting `bookSnapshot` and `reviewText` wire bytes on catalog list/sync paths.
 */
export async function fetchUserReadingStatesProjection(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<Map<string, Partial<UserReadingState>>> {
  const map = new Map<string, Partial<UserReadingState>>();
  const readingStatesCol = getReadingStatesCollection(db, userId);
  if (!readingStatesCol) {
    return map;
  }

  const projectedQuery = readingStatesCol.select(
    'userId',
    'keyType',
    'cleanIsbn',
    'bookId',
    'libraryId',
    'status',
    'rating',
    'startedAt',
    'finishedAt',
    'readStatusReviewedAt',
    'updatedAt',
  );
  const snap = await projectedQuery.get();
  for (const doc of snap.docs) {
    const normalized = normalizeReadingStateDoc(
      doc.id,
      doc.data() || {},
      userId,
    );
    map.set(doc.id, normalized);
  }

  return map;
}

/**
 * Convenience wrapper that loads a user's reading states Map from the canonical Admin DB.
 */
export async function loadUserReadingStatesMap(
  userId: string,
): Promise<Map<string, Partial<UserReadingState>>> {
  return fetchUserReadingStatesMap(getAdminDb(), userId);
}

/**
 * Overlays caller-scoped reading state fields onto a Book DTO.
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
