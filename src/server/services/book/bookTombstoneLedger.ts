import {
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  storedBookTombstoneDocSchema,
  type StoredBookTombstoneDoc,
} from '../../../schemas/book';
import {normalizeFirestoreTimestamp} from './bookPartitioner';

export const TOMBSTONE_SYNC_QUERY_LIMIT = 1000;

export const bookTombstoneConverter = {
  toFirestoreWrite(
    libraryId: string,
    bookId: string,
    input: {
      deletedAtMs: number;
      deletedBy?: string;
      updatedAt?: string;
    },
  ): StoredBookTombstoneDoc {
    const payload: StoredBookTombstoneDoc = {
      id: bookId,
      bookId,
      deletedAtMs: Math.max(0, Math.trunc(input.deletedAtMs)),
      ...(input.deletedBy ? {deletedBy: input.deletedBy} : {}),
      updatedAt: input.updatedAt || new Date(input.deletedAtMs).toISOString(),
    };
    validateFirestoreWritePayload(storedBookTombstoneDocSchema, payload, {
      entity: 'StoredBookTombstoneDoc',
      documentPath: `/libraries/${libraryId}/tombstones/${bookId}`,
      operation: 'upsert',
    });
    return payload;
  },

  fromFirestore(
    libraryId: string,
    docId: string,
    raw: Record<string, unknown>,
  ): StoredBookTombstoneDoc {
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: docId,
      bookId: typeof raw.bookId === 'string' && raw.bookId ? raw.bookId : docId,
    };
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'libraryId')) {
      delete candidate.libraryId;
    }
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return validateFirestoreReadPayload(
      storedBookTombstoneDocSchema,
      candidate,
      {
        entity: 'StoredBookTombstoneDoc',
        documentPath: `/libraries/${libraryId}/tombstones/${docId}`,
        operation: 'read',
      },
    );
  },
};

export function stageBookTombstoneInBatch(
  batch: FirebaseFirestore.WriteBatch,
  libraryRef: FirebaseFirestore.DocumentReference,
  libraryId: string,
  bookId: string,
  options: {deletedAtMs?: number; deletedBy?: string} = {},
): void {
  const deletedAtMs = options.deletedAtMs ?? Date.now();
  const tombstoneRef = libraryRef.collection('tombstones').doc(bookId);
  const payload = bookTombstoneConverter.toFirestoreWrite(libraryId, bookId, {
    deletedAtMs,
    deletedBy: options.deletedBy,
  });
  batch.set(tombstoneRef, payload);
}

export function clearBookTombstoneInBatch(
  batch: FirebaseFirestore.WriteBatch,
  libraryRef: FirebaseFirestore.DocumentReference,
  bookId: string,
): void {
  const tombstoneRef = libraryRef.collection('tombstones').doc(bookId);
  batch.delete(tombstoneRef);
}

export async function queryDeletedBookIdsSince(
  libraryRef: FirebaseFirestore.DocumentReference,
  libraryId: string,
  sinceMs: number,
): Promise<string[]> {
  if (sinceMs <= 0) {
    return [];
  }
  const snap = await libraryRef
    .collection('tombstones')
    .where('deletedAtMs', '>=', sinceMs)
    .limit(TOMBSTONE_SYNC_QUERY_LIMIT)
    .get();

  const deletedIds: string[] = [];
  for (const docSnap of snap.docs) {
    const parsed = bookTombstoneConverter.fromFirestore(
      libraryId,
      docSnap.id,
      docSnap.data() || {},
    );
    deletedIds.push(parsed.bookId);
  }
  return deletedIds;
}
