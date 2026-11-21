import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {validateFirestoreWritePayload} from '../../../schemas/common';
import {
  storedBookDetailsDocSchema,
  storedBookDocSchema,
} from '../../../schemas/book';
import {type BookSelfHealPlan} from './bookLegacyNormalizers';

const LIBRARY_BOOK_PATH_REGEX =
  /^\/?libraries\/([a-zA-Z0-9_-]{1,128})\/books\/([a-zA-Z0-9_-]{1,128})$/;
const LIBRARY_BOOK_DETAILS_PATH_REGEX =
  /^\/?libraries\/([a-zA-Z0-9_-]{1,128})\/bookDetails\/([a-zA-Z0-9_-]{1,128})$/;

export function canRunBackgroundSelfHeal(): boolean {
  if (process.env.VITEST === 'true') {
    return Boolean((getAdminDb as unknown as {mock?: unknown}).mock);
  }
  return true;
}

interface QueuedBookHealEntry {
  libraryId: string;
  bookId: string;
  plan: BookSelfHealPlan;
}

interface QueuedDetailsHealEntry {
  libraryId: string;
  bookId: string;
  detailsPatch: Record<string, unknown>;
}

const pendingBookHeals = new Map<string, QueuedBookHealEntry>();
const pendingDetailsHeals = new Map<string, QueuedDetailsHealEntry>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushQueuedBookSelfHeals(): Promise<void> {
  flushTimer = null;
  if (pendingBookHeals.size === 0 && pendingDetailsHeals.size === 0) {
    return;
  }

  const bookEntries = Array.from(pendingBookHeals.values());
  const detailsEntries = Array.from(pendingDetailsHeals.values());
  pendingBookHeals.clear();
  pendingDetailsHeals.clear();

  try {
    const db = getAdminDb();
    const MAX_ENTRIES_PER_BATCH = 180;

    for (let i = 0; i < bookEntries.length; i += MAX_ENTRIES_PER_BATCH) {
      const chunk = bookEntries.slice(i, i + MAX_ENTRIES_PER_BATCH);
      const batch = db.batch();
      let stagedOps = 0;

      for (const entry of chunk) {
        const libRef = db.collection('libraries').doc(entry.libraryId);
        const bookRef = libRef.collection('books').doc(entry.bookId);

        if (Object.keys(entry.plan.bookPatch).length > 0) {
          validateFirestoreWritePayload(
            storedBookDocSchema.partial(),
            entry.plan.bookPatch,
            {
              entity: 'StoredBookDoc',
              documentPath: `/libraries/${entry.libraryId}/books/${entry.bookId}`,
              operation: 'update',
            },
          );
          batch.update(bookRef, entry.plan.bookPatch);
          stagedOps++;
        }

        if (
          entry.plan.rescuedHeavy &&
          Object.keys(entry.plan.rescuedHeavy).length > 0
        ) {
          const detailsRef = libRef.collection('bookDetails').doc(entry.bookId);
          validateFirestoreWritePayload(
            storedBookDetailsDocSchema.partial(),
            entry.plan.rescuedHeavy,
            {
              entity: 'StoredBookDetailsDoc',
              documentPath: `/libraries/${entry.libraryId}/bookDetails/${entry.bookId}`,
              operation: 'upsert',
            },
          );
          batch.set(detailsRef, entry.plan.rescuedHeavy, {merge: true});
          stagedOps++;
        }
      }

      if (stagedOps > 0) {
        try {
          await batch.commit();
        } catch {
          await Promise.all(
            chunk.map(async entry => {
              const libRef = db.collection('libraries').doc(entry.libraryId);
              if (Object.keys(entry.plan.bookPatch).length > 0) {
                await libRef
                  .collection('books')
                  .doc(entry.bookId)
                  .update(entry.plan.bookPatch)
                  .catch(() => {});
              }
              if (
                entry.plan.rescuedHeavy &&
                Object.keys(entry.plan.rescuedHeavy).length > 0
              ) {
                await libRef
                  .collection('bookDetails')
                  .doc(entry.bookId)
                  .set(entry.plan.rescuedHeavy, {merge: true})
                  .catch(() => {});
              }
            }),
          );
        }
      }
    }

    for (let i = 0; i < detailsEntries.length; i += MAX_ENTRIES_PER_BATCH) {
      const chunk = detailsEntries.slice(i, i + MAX_ENTRIES_PER_BATCH);
      const batch = db.batch();
      let stagedOps = 0;

      for (const entry of chunk) {
        const detailsRef = db
          .collection('libraries')
          .doc(entry.libraryId)
          .collection('bookDetails')
          .doc(entry.bookId);
        validateFirestoreWritePayload(
          storedBookDetailsDocSchema.partial(),
          entry.detailsPatch,
          {
            entity: 'StoredBookDetailsDoc',
            documentPath: `/libraries/${entry.libraryId}/bookDetails/${entry.bookId}`,
            operation: 'update',
          },
        );
        batch.update(detailsRef, entry.detailsPatch);
        stagedOps++;
      }

      if (stagedOps > 0) {
        await batch.commit().catch(() => {});
      }
    }
  } catch (err) {
    console.warn(
      '[BookPartitioner] Background book self-heal error:',
      formatFirestoreAdminError(err),
    );
  }
}

function ensureSelfHealFlushScheduled(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    void flushQueuedBookSelfHeals();
  }, 15);
  flushTimer.unref?.();
}

export function scheduleBookSelfHeal(
  documentPath: string,
  plan: BookSelfHealPlan,
): void {
  if (!canRunBackgroundSelfHeal()) {
    return;
  }
  const match = LIBRARY_BOOK_PATH_REGEX.exec(documentPath);
  if (!match) {
    return;
  }
  const [, libraryId, bookId] = match;
  const key = `${libraryId}:${bookId}`;
  pendingBookHeals.set(key, {libraryId, bookId, plan});
  ensureSelfHealFlushScheduled();
}

export function scheduleBookDetailsSelfHeal(
  documentPath: string,
  detailsPatch: Record<string, unknown>,
): void {
  if (!canRunBackgroundSelfHeal()) {
    return;
  }
  const match = LIBRARY_BOOK_DETAILS_PATH_REGEX.exec(documentPath);
  if (!match) {
    return;
  }
  const [, libraryId, bookId] = match;
  const key = `${libraryId}:${bookId}`;
  pendingDetailsHeals.set(key, {libraryId, bookId, detailsPatch});
  ensureSelfHealFlushScheduled();
}
