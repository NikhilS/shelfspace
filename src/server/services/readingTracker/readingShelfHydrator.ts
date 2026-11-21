import {getAdminDb} from '../firebaseAdmin';
import {LibraryService} from '../library';
import {getVirtualLibraryId} from '../library/libraryShareService';
import {
  BookPartitioner,
  bookDocConverter,
  fetchUserReadingStatesMap,
  fetchUserReadingStatesProjection,
  parseBookOrStateIdentifier,
  resolveReadingStateFromMap,
} from '../book';
import {safeIdSchema} from '../../../schemas/common';
import type {RequestScopedLoaders} from '../../auth/types';
import type {Book, UserReadingState} from '../../../types';
import type {
  ReadingShelfSummary,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../../types/readingTracker';

const DEFAULT_UNREAD_LIBRARY_BOOKS_LIMIT = 80;
const MIN_PER_LIBRARY_UNREAD_CAP = 25;
const LIVE_BOOK_HYDRATION_CHUNK_SIZE = 250;

export function normalizeShelfStatus(
  raw?: string,
): TrackedShelfStatus | 'unset' {
  if (!raw || raw === 'unset') {
    return 'unset';
  }
  if (raw === 'finished') {
    return 'finished';
  }
  if (raw === 'want_to_read') {
    return 'want_to_read';
  }
  if (raw === 'reading') {
    return 'reading';
  }
  if (raw === 'abandoned') {
    return 'abandoned';
  }
  return 'unset';
}

export function normalizeTrackerTextKey(val?: string): string {
  return (val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeTrackerIsbnKey(val?: string): string {
  return (val || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

interface PendingTrackedShelfRow {
  state: Partial<UserReadingState>;
  readingStatus: TrackedShelfStatus;
  resolvedBookId: string;
  libMeta: {id: string; name: string; isVirtual: boolean};
  canHydrateLiveBook: boolean;
}

/**
 * Retrieves all books tracked by the user directly from `/users/{userId}/readingStates`,
 * batch-hydrating live `/libraries/{libraryId}/books/{bookId}` catalog records via `db.getAll`
 * and falling back to `< 2KB` `MinimalBookStub` snapshots for external or deleted entries.
 */
export async function getPersonalReadingShelf(
  userId: string,
  userEmail: string | undefined,
  options?: {
    shelf?: 'all' | TrackedShelfStatus;
    requestLoaders?: RequestScopedLoaders;
  },
): Promise<ReadingShelfSummary> {
  const db = getAdminDb();
  const virtualLibraryId = getVirtualLibraryId(userId);

  const [{libraries}, readingStatesMap] = await Promise.all([
    options?.requestLoaders
      ? options.requestLoaders.getUserLibraries(userId, userEmail, false)
      : LibraryService.getUserLibraries(
          userId,
          userEmail,
          ['owned', 'shared'],
          false,
        ),
    options?.requestLoaders
      ? options.requestLoaders.getUserReadingStatesMap(userId)
      : fetchUserReadingStatesMap(db, userId),
  ]);

  const libraryMetaMap = new Map<
    string,
    {id: string; name: string; isVirtual: boolean}
  >();

  for (const lib of libraries) {
    libraryMetaMap.set(lib.id, {
      id: lib.id,
      name: lib.name || 'Untitled Library',
      isVirtual: Boolean(lib.id.startsWith('virtual_')),
    });
  }

  libraryMetaMap.set(virtualLibraryId, {
    id: virtualLibraryId,
    name: 'Personal Reading Shelf',
    isVirtual: true,
  });

  const pendingRows: PendingTrackedShelfRow[] = [];
  const hydrationTargets = new Map<
    string,
    {
      libraryId: string;
      bookId: string;
      ref: FirebaseFirestore.DocumentReference;
    }
  >();

  for (const [stateKey, state] of readingStatesMap.entries()) {
    const readingStatus = normalizeShelfStatus(state.status);
    if (readingStatus === 'unset') {
      continue;
    }

    const snap = state.bookSnapshot;
    const parsedKey = parseBookOrStateIdentifier(stateKey);
    const resolvedLibraryId =
      state.libraryId ||
      parsedKey.libraryIdFromId ||
      snap?.libraryId ||
      virtualLibraryId;
    const accessibleMeta = libraryMetaMap.get(resolvedLibraryId);
    const libMeta = accessibleMeta || {
      id: resolvedLibraryId,
      name:
        snap?.libraryName ||
        (resolvedLibraryId.startsWith('virtual_')
          ? 'Personal Reading Shelf'
          : 'Library'),
      isVirtual: resolvedLibraryId.startsWith('virtual_'),
    };
    const resolvedBookId =
      state.bookId || snap?.bookId || parsedKey.cleanBookId || stateKey;
    const canHydrateLiveBook =
      Boolean(accessibleMeta) &&
      state.keyType !== 'ext' &&
      safeIdSchema.safeParse(resolvedBookId).success;

    if (canHydrateLiveBook) {
      const compositeKey = `${libMeta.id}:${resolvedBookId}`;
      if (!hydrationTargets.has(compositeKey)) {
        hydrationTargets.set(compositeKey, {
          libraryId: libMeta.id,
          bookId: resolvedBookId,
          ref: db
            .collection('libraries')
            .doc(libMeta.id)
            .collection('books')
            .doc(resolvedBookId),
        });
      }
    }

    pendingRows.push({
      state,
      readingStatus,
      resolvedBookId,
      libMeta,
      canHydrateLiveBook,
    });
  }

  const liveBooksMap = new Map<string, Book>();
  if (hydrationTargets.size > 0) {
    const targetEntries = Array.from(hydrationTargets.entries());
    for (
      let i = 0;
      i < targetEntries.length;
      i += LIVE_BOOK_HYDRATION_CHUNK_SIZE
    ) {
      const slice = targetEntries.slice(i, i + LIVE_BOOK_HYDRATION_CHUNK_SIZE);
      const refs = slice.map(([, entry]) => entry.ref);
      const snaps = await db.getAll(...refs);
      for (let idx = 0; idx < snaps.length; idx++) {
        const docSnap = snaps[idx];
        const [compositeKey, target] = slice[idx];
        if (!docSnap?.exists) {
          continue;
        }
        const parsed = bookDocConverter.fromFirestore(
          docSnap.id || target.bookId,
          docSnap.data() || {},
          `/libraries/${target.libraryId}/books/${target.bookId}`,
        );
        const merged = BookPartitioner.mergeBookAndDetails(
          docSnap.id || target.bookId,
          parsed,
        );
        liveBooksMap.set(compositeKey, merged);
      }
    }
  }

  const allTracked: TrackedBookItem[] = [];

  for (const row of pendingRows) {
    const {state, readingStatus, resolvedBookId, libMeta, canHydrateLiveBook} =
      row;
    const snap = state.bookSnapshot;
    const liveBook = canHydrateLiveBook
      ? liveBooksMap.get(`${libMeta.id}:${resolvedBookId}`)
      : undefined;

    const ownershipStatus: 'owned' | 'unowned' =
      libMeta.isVirtual ||
      liveBook?.ownershipStatus === 'unowned' ||
      (!liveBook && snap?.ownershipStatus === 'unowned')
        ? 'unowned'
        : 'owned';

    const effectiveUpdatedAt = state.updatedAt || liveBook?.updatedAt;
    const addedAt =
      liveBook?.addedAt || state.updatedAt || new Date().toISOString();

    if (liveBook) {
      allTracked.push({
        ...liveBook,
        id: resolvedBookId,
        isbn: liveBook.isbn || snap?.isbn || state.cleanIsbn,
        cleanIsbn: liveBook.cleanIsbn || snap?.cleanIsbn || state.cleanIsbn,
        coverUrl: liveBook.coverUrl || snap?.coverUrl,
        publishedDate: liveBook.publishedDate || snap?.publishedDate,
        primaryGenre: liveBook.primaryGenre || snap?.primaryGenre,
        series: liveBook.series ?? snap?.series,
        format: liveBook.format || snap?.format || 'physical',
        addedBy: liveBook.addedBy ?? userId,
        addedAt,
        ...(effectiveUpdatedAt ? {updatedAt: effectiveUpdatedAt} : {}),
        libraryId: libMeta.id,
        libraryName: libMeta.name,
        isVirtual: libMeta.isVirtual || ownershipStatus === 'unowned',
        ownershipStatus,
        readingStatus,
        ...(typeof state.rating === 'number' ? {userRating: state.rating} : {}),
        ...(state.readStatusReviewedAt !== undefined
          ? {readStatusReviewedAt: state.readStatusReviewedAt}
          : {}),
        ...(state.startedAt !== undefined ? {startedAt: state.startedAt} : {}),
        ...(state.finishedAt !== undefined
          ? {finishedAt: state.finishedAt}
          : {}),
      });
    } else {
      allTracked.push({
        id: resolvedBookId,
        title: snap?.title || 'Untitled Book',
        author: snap?.author || 'Unknown Author',
        ...(snap?.isbn || state.cleanIsbn
          ? {isbn: snap?.isbn || state.cleanIsbn}
          : {}),
        ...(snap?.cleanIsbn || state.cleanIsbn
          ? {cleanIsbn: snap?.cleanIsbn || state.cleanIsbn}
          : {}),
        ...(snap?.coverUrl ? {coverUrl: snap.coverUrl} : {}),
        ...(snap?.publishedDate ? {publishedDate: snap.publishedDate} : {}),
        ...(snap?.primaryGenre ? {primaryGenre: snap.primaryGenre} : {}),
        subgenres: [],
        isCustomPrimary: false,
        ...(snap?.series ? {series: snap.series} : {}),
        format: snap?.format || 'physical',
        addedBy: userId,
        addedAt,
        ...(effectiveUpdatedAt ? {updatedAt: effectiveUpdatedAt} : {}),
        libraryId: libMeta.id,
        libraryName: libMeta.name,
        isVirtual: libMeta.isVirtual || ownershipStatus === 'unowned',
        ownershipStatus,
        readingStatus,
        ...(typeof state.rating === 'number' ? {userRating: state.rating} : {}),
        ...(state.readStatusReviewedAt !== undefined
          ? {readStatusReviewedAt: state.readStatusReviewedAt}
          : {}),
        ...(state.startedAt !== undefined ? {startedAt: state.startedAt} : {}),
        ...(state.finishedAt !== undefined
          ? {finishedAt: state.finishedAt}
          : {}),
      });
    }
  }

  allTracked.sort((a, b) => {
    const timeA = String(a.updatedAt || a.addedAt || '');
    const timeB = String(b.updatedAt || b.addedAt || '');
    return timeB.localeCompare(timeA);
  });

  const counts = {
    all: allTracked.length,
    want_to_read: 0,
    reading: 0,
    finished: 0,
    abandoned: 0,
  };

  for (const item of allTracked) {
    counts[item.readingStatus]++;
  }

  const targetShelf = options?.shelf || 'all';
  const filteredItems =
    targetShelf === 'all'
      ? allTracked
      : allTracked.filter(item => item.readingStatus === targetShelf);

  return {
    items: filteredItems,
    counts,
  };
}

/**
 * Retrieves unread books ('unset' or 'want_to_read') across all non-virtual libraries
 * accessible to the user (owned and shared), using lightweight reading-state field projections.
 */
export async function getUnreadLibraryBooks(
  userId: string,
  userEmail: string | undefined,
  options?: {
    limit?: number;
    requestLoaders?: RequestScopedLoaders;
  },
): Promise<UnreadLibraryBookItem[]> {
  const db = getAdminDb();
  const totalLimit = Math.max(
    1,
    Math.min(500, options?.limit ?? DEFAULT_UNREAD_LIBRARY_BOOKS_LIMIT),
  );

  const {libraries} = options?.requestLoaders
    ? await options.requestLoaders.getUserLibraries(userId, userEmail, false)
    : await LibraryService.getUserLibraries(
        userId,
        userEmail,
        ['owned', 'shared'],
        false,
      );

  const nonVirtualLibraries = libraries.filter(
    lib => !lib.id.startsWith('virtual_'),
  );

  if (nonVirtualLibraries.length === 0) {
    return [];
  }

  const perLibraryCap = Math.max(
    MIN_PER_LIBRARY_UNREAD_CAP,
    Math.ceil((totalLimit * 2) / Math.max(1, nonVirtualLibraries.length)),
  );

  const [librarySnaps, readingStatesMap] = await Promise.all([
    Promise.all(
      nonVirtualLibraries.map(async lib => {
        const snap = await db
          .collection('libraries')
          .doc(lib.id)
          .collection('books')
          .orderBy('addedAt', 'desc')
          .limit(perLibraryCap)
          .get();
        return {
          libId: lib.id,
          libName: lib.name || 'Untitled Library',
          docs: snap.docs || [],
        };
      }),
    ),
    options?.requestLoaders
      ? options.requestLoaders.getUserReadingStatesMap(userId)
      : fetchUserReadingStatesProjection(db, userId),
  ]);

  const unreadItems: UnreadLibraryBookItem[] = [];
  const seenIdentities = new Set<string>();

  for (const {libId, libName, docs} of librarySnaps) {
    for (const docSnap of docs) {
      const rawData = bookDocConverter.fromFirestore(
        docSnap.id,
        docSnap.data() || {},
        `/libraries/${libId}/books/${docSnap.id}`,
      );
      if (rawData.ownershipStatus === 'unowned') {
        continue;
      }
      const merged = BookPartitioner.mergeBookAndDetails(docSnap.id, rawData);
      const state = resolveReadingStateFromMap(readingStatesMap, {
        libraryId: libId,
        bookId: merged.id,
        isbn: merged.isbn,
        cleanIsbn: merged.cleanIsbn,
      });
      const status = normalizeShelfStatus(state?.status);

      if (status !== 'unset' && status !== 'want_to_read') {
        continue;
      }

      const dedupeIdentity = merged.cleanIsbn
        ? `cleanIsbn:${merged.cleanIsbn}`
        : `book:${libId}:${merged.id}`;
      if (seenIdentities.has(dedupeIdentity)) {
        continue;
      }
      seenIdentities.add(dedupeIdentity);

      unreadItems.push({
        ...merged,
        libraryId: libId,
        libraryName: libName,
        readingStatus: status,
        ...(typeof state?.rating === 'number'
          ? {userRating: state.rating}
          : {}),
        ...(state?.readStatusReviewedAt !== undefined
          ? {readStatusReviewedAt: state.readStatusReviewedAt}
          : {}),
      });

      if (unreadItems.length >= totalLimit) {
        return unreadItems;
      }
    }
  }

  return unreadItems;
}
