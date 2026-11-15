import {getAdminDb} from '../firebaseAdmin';
import {LibraryService} from '../library';
import {getVirtualLibraryId} from '../library/libraryShareService';
import {
  BookPartitioner,
  bookDocConverter,
  computeReadingStateKey,
  fetchUserReadingStatesMap,
} from '../book';
import type {RequestScopedLoaders} from '../../auth/types';
import type {
  ReadingShelfSummary,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../../types/readingTracker';

const DEFAULT_UNREAD_LIBRARY_BOOKS_LIMIT = 80;
const MIN_PER_LIBRARY_UNREAD_CAP = 25;

export function normalizeShelfStatus(
  raw?: string,
): TrackedShelfStatus | 'unset' {
  if (!raw || raw === 'unset') {
    return 'unset';
  }
  if (raw === 'completed' || raw === 'finished') {
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

/**
 * Retrieves all books tracked by the user directly from `/users/{userId}/readingStates`,
 * annotated with library metadata from accessible owned/shared libraries and the personal virtual shelf.
 */
export async function getPersonalReadingShelf(
  userId: string,
  userEmail: string | undefined,
  options?: {
    shelf?: 'all' | TrackedShelfStatus;
    requestLoaders?: RequestScopedLoaders;
  },
): Promise<ReadingShelfSummary> {
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
      : fetchUserReadingStatesMap(getAdminDb(), userId),
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

  const allTracked: TrackedBookItem[] = [];

  for (const [stateKey, state] of readingStatesMap.entries()) {
    const readingStatus = normalizeShelfStatus(state.status);
    if (readingStatus === 'unset') {
      continue;
    }

    const snap = state.bookSnapshot;
    const resolvedLibraryId =
      state.libraryId || snap?.libraryId || virtualLibraryId;
    const libMeta = libraryMetaMap.get(resolvedLibraryId) || {
      id: resolvedLibraryId,
      name:
        snap?.libraryName ||
        (resolvedLibraryId.startsWith('virtual_')
          ? 'Personal Reading Shelf'
          : 'Library'),
      isVirtual: resolvedLibraryId.startsWith('virtual_'),
    };
    const resolvedBookId =
      state.bookId ||
      snap?.bookId ||
      (stateKey.startsWith('bookid:')
        ? stateKey.slice('bookid:'.length)
        : stateKey);

    const ownershipStatus: 'owned' | 'unowned' =
      libMeta.isVirtual || snap?.ownershipStatus === 'unowned'
        ? 'unowned'
        : 'owned';

    const addedAt = state.updatedAt || new Date().toISOString();

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
      subgenres: Array.isArray(snap?.subgenres) ? snap.subgenres : [],
      isCustomPrimary: false,
      ...(snap?.series ? {series: snap.series} : {}),
      format: snap?.format || 'physical',
      ...(snap?.synopsis ? {synopsis: snap.synopsis} : {}),
      ...(snap?.authorBio ? {authorBio: snap.authorBio} : {}),
      ...(snap?.geoMetadata ? {geoMetadata: snap.geoMetadata} : {}),
      ...(snap?.temporalMetadata
        ? {temporalMetadata: snap.temporalMetadata}
        : {}),
      ...(snap?.clusterCoordinates
        ? {clusterCoordinates: snap.clusterCoordinates}
        : {}),
      addedBy: userId,
      addedAt,
      ...(state.updatedAt ? {updatedAt: state.updatedAt} : {}),
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
      ...(state.finishedAt !== undefined ? {finishedAt: state.finishedAt} : {}),
    });
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
 * accessible to the user (owned and shared), using the strict single-lookup reading state key.
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
        try {
          let booksQuery: FirebaseFirestore.Query = db
            .collection('libraries')
            .doc(lib.id)
            .collection('books');
          if (
            typeof (booksQuery as {orderBy?: unknown}).orderBy === 'function'
          ) {
            try {
              booksQuery = booksQuery.orderBy('addedAt', 'desc');
            } catch {
              // Fallback if index or test mock does not implement orderBy
            }
          }
          if (typeof (booksQuery as {limit?: unknown}).limit === 'function') {
            booksQuery = booksQuery.limit(perLibraryCap);
          }
          const snap = await booksQuery.get();
          return {
            libId: lib.id,
            libName: lib.name || 'Untitled Library',
            docs: snap.docs || [],
          };
        } catch {
          return {
            libId: lib.id,
            libName: lib.name || 'Untitled Library',
            docs: [],
          };
        }
      }),
    ),
    options?.requestLoaders
      ? options.requestLoaders.getUserReadingStatesMap(userId)
      : fetchUserReadingStatesMap(db, userId),
  ]);

  const unreadItems: UnreadLibraryBookItem[] = [];
  const seenKeys = new Set<string>();

  for (const {libId, libName, docs} of librarySnaps) {
    for (const docSnap of docs) {
      const rawData = bookDocConverter.fromFirestore(
        docSnap.id,
        docSnap.data() || {},
      );
      if (rawData.ownershipStatus === 'unowned') {
        continue;
      }
      const merged = BookPartitioner.mergeBookAndDetails(docSnap.id, rawData);
      const stateKey = computeReadingStateKey({
        isbn: merged.isbn,
        cleanIsbn: merged.cleanIsbn,
        bookId: merged.id,
      });

      const state = readingStatesMap.get(stateKey);
      const status = normalizeShelfStatus(state?.status);

      if (status !== 'unset' && status !== 'want_to_read') {
        continue;
      }

      if (seenKeys.has(stateKey)) {
        continue;
      }
      seenKeys.add(stateKey);

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
