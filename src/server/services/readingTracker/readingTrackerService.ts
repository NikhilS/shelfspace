import {getAdminDb} from '../firebaseAdmin';
import {FieldPath} from 'firebase-admin/firestore';
import {LibraryService} from '../library';
import {getVirtualLibraryId} from '../library/libraryShareService';
import {BookService, BookPartitioner} from '../book';
import {catalogOrchestrator} from '../catalog';
import {
  normalizeIsbnForDedupe,
  computeBookDedupeKey,
  extractPrimarySearchToken,
} from '../../../lib/duplicateDetection';
import type {Book, BookDetails} from '../../../types';

const TRACKED_STATUS_VALUES = [
  'want_to_read',
  'reading',
  'finished',
  'completed',
  'abandoned',
] as const;

export type TrackedShelfStatus =
  'want_to_read' | 'reading' | 'finished' | 'abandoned';

export interface TrackedBookItem extends Book {
  libraryId: string;
  libraryName: string;
  isVirtual: boolean;
  ownershipStatus: 'owned' | 'unowned';
  readingStatus: TrackedShelfStatus;
  userRating?: number;
}

export interface ReadingShelfSummary {
  items: TrackedBookItem[];
  counts: {
    all: number;
    want_to_read: number;
    reading: number;
    finished: number;
    abandoned: number;
  };
}

export interface UnifiedLibrarySearchMatch {
  bookId: string;
  libraryId: string;
  libraryName: string;
  isVirtual: boolean;
  ownershipStatus: 'owned' | 'unowned';
  title: string;
  author: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  primaryGenre?: string;
  synopsis?: string;
  readingStatus: TrackedShelfStatus | 'unset';
  userRating?: number;
}

export interface UnifiedExternalSearchMatch extends BookDetails {
  existingMatch?: {
    bookId: string;
    libraryId: string;
    libraryName: string;
    isVirtual: boolean;
    ownershipStatus: 'owned' | 'unowned';
    readingStatus: TrackedShelfStatus | 'unset';
  };
}

function normalizeStatus(raw?: string): TrackedShelfStatus | 'unset' {
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

function normalizeTextKey(val?: string): string {
  return (val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIsbnKey(val?: string): string {
  return (val || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Retrieves all books tracked by the user across owned libraries, shared libraries,
 * and the user's personal virtual shelf (`virtual_${userId}`).
 */
export async function getPersonalReadingShelf(
  userId: string,
  userEmail: string | undefined,
  options?: {
    shelf?: 'all' | TrackedShelfStatus;
  },
): Promise<ReadingShelfSummary> {
  const db = getAdminDb();
  const virtualLibraryId = getVirtualLibraryId(userId);

  const {libraries} = await LibraryService.getUserLibraries(
    userId,
    userEmail,
    ['owned', 'shared'],
    false,
  );

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

  const libraryEntries = Array.from(libraryMetaMap.values());

  const snapshots = await Promise.all(
    libraryEntries.map(async libMeta => {
      try {
        const booksRef = db
          .collection('libraries')
          .doc(libMeta.id)
          .collection('books');
        if (
          !libMeta.isVirtual &&
          typeof (booksRef as {where?: unknown}).where === 'function'
        ) {
          const snap = await booksRef
            .where(new FieldPath('userStatuses', userId), 'in', [
              ...TRACKED_STATUS_VALUES,
            ])
            .get();
          return {libMeta, docs: snap.docs || []};
        }
        const snap = await booksRef.get();
        return {libMeta, docs: snap.docs || []};
      } catch {
        return {libMeta, docs: []};
      }
    }),
  );

  const allTracked: TrackedBookItem[] = [];

  for (const {libMeta, docs} of snapshots) {
    for (const docSnap of docs) {
      const rawData = (docSnap.data() || {}) as Partial<Book>;
      const merged = BookPartitioner.mergeBookAndDetails(docSnap.id, rawData);

      const userStatusRaw =
        merged.userStatuses?.[userId] ??
        (libMeta.isVirtual ? merged.status || 'want_to_read' : undefined);
      const readingStatus = normalizeStatus(userStatusRaw);

      if (readingStatus === 'unset') {
        continue;
      }

      const ownershipStatus: 'owned' | 'unowned' =
        libMeta.isVirtual || merged.ownershipStatus === 'unowned'
          ? 'unowned'
          : 'owned';

      const userRating =
        merged.userRatings && typeof merged.userRatings[userId] === 'number'
          ? merged.userRatings[userId]
          : undefined;

      allTracked.push({
        ...merged,
        libraryId: libMeta.id,
        libraryName: libMeta.name,
        isVirtual: libMeta.isVirtual || ownershipStatus === 'unowned',
        ownershipStatus,
        readingStatus,
        ...(userRating !== undefined ? {userRating} : {}),
      });
    }
  }

  // Sort by most recently updated or added
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
 * Searches simultaneously across all libraries accessible to the user (owned, shared, virtual)
 * and external book metadata providers, deduplicating and annotating matches.
 */
export async function searchUnifiedCatalog(
  userId: string,
  userEmail: string | undefined,
  rawQuery: string,
): Promise<{
  libraryMatches: UnifiedLibrarySearchMatch[];
  externalMatches: UnifiedExternalSearchMatch[];
}> {
  const query = rawQuery.trim();
  if (!query) {
    return {libraryMatches: [], externalMatches: []};
  }

  const db = getAdminDb();
  const virtualLibraryId = getVirtualLibraryId(userId);
  const queryLower = query.toLowerCase();
  const queryIsbn = normalizeIsbnKey(query);
  const isLikelyIsbn =
    (queryIsbn.length === 10 || queryIsbn.length === 13) &&
    /^[0-9X]+$/.test(queryIsbn);
  const primarySearchToken = extractPrimarySearchToken(query);

  const librariesPromise = (async (): Promise<UnifiedLibrarySearchMatch[]> => {
    const {libraries} = await LibraryService.getUserLibraries(
      userId,
      userEmail,
      ['owned', 'shared'],
      false,
    );

    const libEntries = [
      ...libraries.map(l => ({
        id: l.id,
        name: l.name || 'Untitled Library',
        isVirtual: false,
        bookCount: l.bookCount,
      })),
      {
        id: virtualLibraryId,
        name: 'Personal Reading Shelf',
        isVirtual: true,
        bookCount: undefined as number | undefined,
      },
    ];

    const snaps = await Promise.all(
      libEntries.map(async libMeta => {
        try {
          const booksRef = db
            .collection('libraries')
            .doc(libMeta.id)
            .collection('books');

          if (typeof (booksRef as {where?: unknown}).where === 'function') {
            if (isLikelyIsbn) {
              const isbnSnap = await booksRef
                .where('cleanIsbn', '==', queryIsbn)
                .limit(25)
                .get();
              if (isbnSnap?.docs && isbnSnap.docs.length > 0) {
                return {libMeta, docs: isbnSnap.docs};
              }
            } else if (primarySearchToken) {
              const tokenSnap = await booksRef
                .where('searchTokens', 'array-contains', primarySearchToken)
                .limit(100)
                .get();
              if (tokenSnap?.docs && tokenSnap.docs.length > 0) {
                return {libMeta, docs: tokenSnap.docs};
              }
              // If library is explicitly empty, skip fallback scan
              if (libMeta.bookCount === 0) {
                return {libMeta, docs: []};
              }
            }
          }

          // Fallback scan for legacy libraries containing un-backfilled books
          const snap = await booksRef.get();
          return {libMeta, docs: snap.docs || []};
        } catch {
          return {libMeta, docs: []};
        }
      }),
    );

    const matches: UnifiedLibrarySearchMatch[] = [];
    for (const {libMeta, docs} of snaps) {
      for (const docSnap of docs) {
        const data = (docSnap.data() || {}) as Partial<Book>;
        const title = data.title || 'Untitled Book';
        const author = data.author || 'Unknown Author';
        const isbn = data.isbn || '';
        const cleanBookIsbn = data.cleanIsbn || normalizeIsbnKey(isbn);

        const titleMatch = title.toLowerCase().includes(queryLower);
        const authorMatch = author.toLowerCase().includes(queryLower);
        const isbnMatch =
          Boolean(queryIsbn && queryIsbn.length >= 4) &&
          cleanBookIsbn.includes(queryIsbn);

        if (!titleMatch && !authorMatch && !isbnMatch) {
          continue;
        }

        const rawStatus =
          data.userStatuses?.[userId] ??
          (libMeta.isVirtual ? data.status || 'want_to_read' : 'unset');
        const readingStatus = normalizeStatus(rawStatus);
        const ownershipStatus: 'owned' | 'unowned' =
          libMeta.isVirtual || data.ownershipStatus === 'unowned'
            ? 'unowned'
            : 'owned';

        matches.push({
          bookId: docSnap.id,
          libraryId: libMeta.id,
          libraryName: libMeta.name,
          isVirtual: libMeta.isVirtual || ownershipStatus === 'unowned',
          ownershipStatus,
          title,
          author,
          isbn: data.isbn,
          coverUrl: data.coverUrl,
          publishedDate: data.publishedDate,
          primaryGenre: data.primaryGenre || undefined,
          synopsis: data.synopsis,
          readingStatus,
          userRating: data.userRatings?.[userId],
        });
      }
    }

    return matches.slice(0, 25);
  })();

  const externalPromise = (async (): Promise<BookDetails[]> => {
    try {
      if (isLikelyIsbn) {
        const byIsbn = await catalogOrchestrator.searchByIsbn(queryIsbn);
        if (byIsbn) {
          const byQuery = await catalogOrchestrator
            .searchByQuery(query)
            .catch(() => []);
          return [byIsbn, ...byQuery];
        }
      }
      return await catalogOrchestrator.searchByQuery(query);
    } catch {
      return [];
    }
  })();

  const [libraryMatches, rawExternal] = await Promise.all([
    librariesPromise,
    externalPromise,
  ]);

  const seenExternalKeys = new Set<string>();
  const externalMatches: UnifiedExternalSearchMatch[] = [];

  for (const ext of rawExternal) {
    if (!ext || !ext.title) {
      continue;
    }
    const extIsbn = normalizeIsbnKey(ext.isbn);
    const extTitleKey = `${normalizeTextKey(ext.title)}::${normalizeTextKey(ext.author)}`;
    const dedupeKey = extIsbn || extTitleKey;
    if (seenExternalKeys.has(dedupeKey)) {
      continue;
    }
    seenExternalKeys.add(dedupeKey);

    const matchingLibBook = libraryMatches.find(libBook => {
      const libIsbn = normalizeIsbnKey(libBook.isbn);
      if (extIsbn && libIsbn && extIsbn === libIsbn) {
        return true;
      }
      const libTitleKey = `${normalizeTextKey(libBook.title)}::${normalizeTextKey(libBook.author)}`;
      return extTitleKey === libTitleKey;
    });

    externalMatches.push({
      ...ext,
      ...(matchingLibBook
        ? {
            existingMatch: {
              bookId: matchingLibBook.bookId,
              libraryId: matchingLibBook.libraryId,
              libraryName: matchingLibBook.libraryName,
              isVirtual: matchingLibBook.isVirtual,
              ownershipStatus: matchingLibBook.ownershipStatus,
              readingStatus: matchingLibBook.readingStatus,
            },
          }
        : {}),
    });
  }

  return {
    libraryMatches,
    externalMatches: externalMatches.slice(0, 20),
  };
}

export interface TrackBookInput {
  source: 'library' | 'external';
  status: TrackedShelfStatus | 'unset';
  libraryId?: string;
  bookId?: string;
  targetLibraryId?: string;
  bookData?: {
    title: string;
    author?: string;
    isbn?: string;
    coverUrl?: string;
    publishedDate?: string;
    primaryGenre?: string;
    subgenres?: string[];
    synopsis?: string;
    authorBio?: string;
    series?: string;
    format?: 'physical' | 'digital';
  };
  rating?: number;
  reviewText?: string;
}

/**
 * Adds or updates a book on the user's personal reading tracker, supporting both
 * in-place tracking on accessible libraries and virtual ('unowned') book tracking,
 * plus optional rating & review submission.
 */
export async function trackBook(
  userId: string,
  userEmail: string | undefined,
  userName: string | undefined,
  input: TrackBookInput,
): Promise<{
  success: true;
  libraryId: string;
  bookId: string;
  status: string;
  ownershipStatus: 'owned' | 'unowned';
  isVirtual: boolean;
}> {
  const db = getAdminDb();
  const hasValidRating = typeof input.rating === 'number' && input.rating >= 1;
  const trimmedReviewText = input.reviewText?.trim() || '';
  const hasReview = hasValidRating && trimmedReviewText.length > 0;

  if (input.source === 'library' && input.libraryId && input.bookId) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      input.libraryId,
      'viewer',
    );

    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        input.libraryId,
        input.bookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true, status: input.status},
      );
    } else {
      await BookService.updateBookStatus(
        userId,
        input.libraryId,
        input.bookId,
        input.status,
        hasValidRating ? {rating: input.rating} : undefined,
      );
    }

    const isVirtual = input.libraryId === getVirtualLibraryId(userId);
    return {
      success: true,
      libraryId: input.libraryId,
      bookId: input.bookId,
      status: input.status,
      ownershipStatus: isVirtual ? 'unowned' : 'owned',
      isVirtual,
    };
  }

  // External / new book tracking flow
  const virtualLibraryId = getVirtualLibraryId(userId);
  const destinationLibraryId = input.targetLibraryId || virtualLibraryId;
  const isVirtual = destinationLibraryId === virtualLibraryId;
  const ownershipStatus: 'owned' | 'unowned' = isVirtual ? 'unowned' : 'owned';

  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    destinationLibraryId,
    isVirtual ? 'owner' : 'editor',
  );

  const bookData = input.bookData || {
    title: 'Untitled Book',
    author: 'Unknown Author',
  };

  // Check if book already exists in destination library via native Firestore indexed queries
  // (`cleanIsbn` and `dedupeKey`), with fallback for legacy unindexed books.
  let existingBookId: string | undefined;
  try {
    const booksRef = db
      .collection('libraries')
      .doc(destinationLibraryId)
      .collection('books');
    const targetIsbn = normalizeIsbnForDedupe(bookData.isbn);
    const targetDedupeKey = computeBookDedupeKey(
      bookData.title,
      bookData.author || 'Unknown Author',
    );
    const targetKey = `${normalizeTextKey(bookData.title)}::${normalizeTextKey(bookData.author || 'Unknown Author')}`;

    if (typeof (booksRef as {where?: unknown}).where === 'function') {
      const indexQueries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
      if (targetIsbn) {
        indexQueries.push(
          booksRef.where('cleanIsbn', '==', targetIsbn).limit(1).get(),
        );
      }
      if (targetDedupeKey) {
        indexQueries.push(
          booksRef.where('dedupeKey', '==', targetDedupeKey).limit(1).get(),
        );
      }

      if (indexQueries.length > 0) {
        const indexSnaps = await Promise.all(indexQueries);
        for (const snap of indexSnaps) {
          const matchedDoc = snap?.docs?.[0];
          if (matchedDoc?.id) {
            existingBookId = matchedDoc.id;
            break;
          }
        }
      }

      // Secondary exact-field query for un-backfilled legacy books before scanning
      if (!existingBookId) {
        const legacyQueries: Array<Promise<FirebaseFirestore.QuerySnapshot>> =
          [];
        if (bookData.isbn?.trim()) {
          legacyQueries.push(
            booksRef.where('isbn', '==', bookData.isbn.trim()).limit(1).get(),
          );
        }
        if (bookData.title?.trim()) {
          legacyQueries.push(
            booksRef.where('title', '==', bookData.title.trim()).limit(5).get(),
          );
        }
        if (legacyQueries.length > 0) {
          const legacySnaps = await Promise.all(legacyQueries);
          for (const snap of legacySnaps) {
            for (const docSnap of snap?.docs || []) {
              const d = (docSnap.data() || {}) as Partial<Book>;
              const docIsbn = normalizeIsbnKey(d.isbn);
              if (targetIsbn && docIsbn && targetIsbn === docIsbn) {
                existingBookId = docSnap.id;
                break;
              }
              const docKey = `${normalizeTextKey(d.title)}::${normalizeTextKey(d.author)}`;
              if (targetKey === docKey) {
                existingBookId = docSnap.id;
                break;
              }
            }
            if (existingBookId) {
              break;
            }
          }
        }
      }
    } else {
      const existingSnap = await booksRef.get();
      for (const docSnap of existingSnap.docs || []) {
        const d = (docSnap.data() || {}) as Partial<Book>;
        const docIsbn = normalizeIsbnKey(d.isbn);
        if (targetIsbn && docIsbn && targetIsbn === docIsbn) {
          existingBookId = docSnap.id;
          break;
        }
        const docKey = `${normalizeTextKey(d.title)}::${normalizeTextKey(d.author)}`;
        if (targetKey === docKey) {
          existingBookId = docSnap.id;
          break;
        }
      }
    }
  } catch {
    existingBookId = undefined;
  }

  let resolvedBookId: string;

  if (existingBookId) {
    resolvedBookId = existingBookId;
    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        destinationLibraryId,
        resolvedBookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true, status: input.status},
      );
    } else {
      await BookService.updateBookStatus(
        userId,
        destinationLibraryId,
        resolvedBookId,
        input.status,
        hasValidRating ? {rating: input.rating} : undefined,
      );
    }
  } else {
    const created = await BookService.createBook(userId, {
      libraryId: destinationLibraryId,
      title: bookData.title.trim() || 'Untitled Book',
      author: (bookData.author || 'Unknown Author').trim(),
      isbn: bookData.isbn,
      coverUrl: bookData.coverUrl,
      publishedDate: bookData.publishedDate,
      primaryGenre: bookData.primaryGenre,
      subgenres: bookData.subgenres,
      synopsis: bookData.synopsis,
      authorBio: bookData.authorBio,
      series: bookData.series,
      format: bookData.format || 'physical',
      ownershipStatus,
      status: input.status,
      ...(hasValidRating && input.rating !== undefined
        ? {userRatings: {[userId]: input.rating}}
        : {}),
    });
    resolvedBookId = created.id;

    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        destinationLibraryId,
        resolvedBookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true},
      );
    }
  }

  return {
    success: true,
    libraryId: destinationLibraryId,
    bookId: resolvedBookId,
    status: input.status,
    ownershipStatus,
    isVirtual,
  };
}
