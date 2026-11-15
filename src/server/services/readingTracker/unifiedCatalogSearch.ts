import {getAdminDb} from '../firebaseAdmin';
import {LibraryService} from '../library';
import {getVirtualLibraryId} from '../library/libraryShareService';
import {
  bookDocConverter,
  computeReadingStateKey,
  fetchUserReadingStatesMap,
} from '../book';
import {catalogOrchestrator} from '../catalog';
import {extractPrimarySearchToken} from '../../../lib/duplicateDetection';
import type {BookDetails} from '../../../types';
import type {
  UnifiedExternalSearchMatch,
  UnifiedLibrarySearchMatch,
} from '../../../types/readingTracker';
import {
  normalizeShelfStatus,
  normalizeTrackerIsbnKey,
  normalizeTrackerTextKey,
} from './readingShelfHydrator';

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
  const queryTerms = queryLower
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);
  const queryIsbn = normalizeTrackerIsbnKey(query);
  const isLikelyIsbn =
    (queryIsbn.length === 10 || queryIsbn.length === 13) &&
    /^[0-9X]+$/.test(queryIsbn);
  const primarySearchToken = extractPrimarySearchToken(query);

  function matchesSearchCriteria(data: {
    title?: string;
    author?: string;
    series?: string | null;
    isbn?: string;
    cleanIsbn?: string;
  }): boolean {
    const title = data.title || 'Untitled Book';
    const author = data.author || 'Unknown Author';
    const series = data.series || '';
    const isbn = data.isbn || '';
    const cleanBookIsbn = data.cleanIsbn || normalizeTrackerIsbnKey(isbn);

    const titleLower = title.toLowerCase();
    const authorLower = author.toLowerCase();
    const seriesLower = series.toLowerCase();

    const directSubstringMatch =
      titleLower.includes(queryLower) ||
      authorLower.includes(queryLower) ||
      (seriesLower.length > 0 && seriesLower.includes(queryLower));

    const isbnMatch =
      Boolean(queryIsbn && queryIsbn.length >= 4) &&
      cleanBookIsbn.includes(queryIsbn);

    if (directSubstringMatch || isbnMatch) {
      return true;
    }

    if (queryTerms.length > 0) {
      const normalizedHaystack = normalizeTrackerTextKey(
        `${title} ${author} ${series} ${cleanBookIsbn}`,
      );
      return queryTerms.every(
        term =>
          titleLower.includes(term) ||
          authorLower.includes(term) ||
          seriesLower.includes(term) ||
          normalizedHaystack.includes(term),
      );
    }

    return false;
  }

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

    const [snaps, readingStatesMap] = await Promise.all([
      Promise.all(
        libEntries.map(async libMeta => {
          try {
            const booksRef = db
              .collection('libraries')
              .doc(libMeta.id)
              .collection('books');

            let ranIndexedTokenQuery = false;

            if (typeof (booksRef as {where?: unknown}).where === 'function') {
              if (isLikelyIsbn) {
                const isbnSnap = await booksRef
                  .where('cleanIsbn', '==', queryIsbn)
                  .limit(25)
                  .get();
                const matchedIsbnDocs = (isbnSnap?.docs || []).filter(docSnap =>
                  matchesSearchCriteria(
                    bookDocConverter.fromFirestore(
                      docSnap.id,
                      (docSnap.data() || {}) as Record<string, unknown>,
                    ),
                  ),
                );
                if (matchedIsbnDocs.length > 0) {
                  return {libMeta, docs: matchedIsbnDocs};
                }
                if (libMeta.bookCount === 0) {
                  return {libMeta, docs: []};
                }
              } else if (primarySearchToken) {
                ranIndexedTokenQuery = true;
                const tokenSnap = await booksRef
                  .where('searchTokens', 'array-contains', primarySearchToken)
                  .limit(100)
                  .get();
                const matchedTokenDocs = (tokenSnap?.docs || []).filter(
                  docSnap =>
                    matchesSearchCriteria(
                      bookDocConverter.fromFirestore(
                        docSnap.id,
                        (docSnap.data() || {}) as Record<string, unknown>,
                      ),
                    ),
                );
                if (matchedTokenDocs.length > 0) {
                  return {libMeta, docs: matchedTokenDocs};
                }
                if (libMeta.bookCount === 0) {
                  return {libMeta, docs: []};
                }
              }
            }

            const snap =
              typeof (booksRef as {limit?: unknown}).limit === 'function'
                ? await booksRef.limit(200).get()
                : await booksRef.get();
            const fallbackDocs = (snap.docs || []).filter(docSnap => {
              const data = bookDocConverter.fromFirestore(
                docSnap.id,
                docSnap.data() || {},
              );
              if (
                ranIndexedTokenQuery &&
                Array.isArray(data.searchTokens) &&
                data.searchTokens.length > 0
              ) {
                return false;
              }
              return matchesSearchCriteria(data);
            });
            return {libMeta, docs: fallbackDocs};
          } catch {
            return {libMeta, docs: []};
          }
        }),
      ),
      fetchUserReadingStatesMap(db, userId),
    ]);

    const matches: UnifiedLibrarySearchMatch[] = [];
    const seenStateKeys = new Set<string>();
    for (const {libMeta, docs} of snaps) {
      for (const docSnap of docs) {
        const raw = (docSnap.data() || {}) as Record<string, unknown>;
        const data = bookDocConverter.fromFirestore(docSnap.id, raw);
        const title = data.title || 'Untitled Book';
        const author = data.author || 'Unknown Author';

        const stateKey = computeReadingStateKey({
          isbn: data.isbn,
          cleanIsbn: data.cleanIsbn,
          bookId: docSnap.id,
        });
        seenStateKeys.add(stateKey);
        const state = readingStatesMap.get(stateKey);
        const rawStatus =
          state?.status ?? (libMeta.isVirtual ? 'want_to_read' : 'unset');
        const readingStatus = normalizeShelfStatus(rawStatus);
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
          ...(data.series ? {series: data.series} : {}),
          isbn: data.isbn,
          coverUrl: data.coverUrl,
          publishedDate: data.publishedDate,
          primaryGenre: data.primaryGenre || undefined,
          synopsis:
            typeof raw.synopsis === 'string' && raw.synopsis.length > 0
              ? raw.synopsis
              : undefined,
          readingStatus,
          userRating: state?.rating,
        });
      }
    }

    for (const [stateKey, state] of readingStatesMap.entries()) {
      if (seenStateKeys.has(stateKey) || !state.bookSnapshot) {
        continue;
      }
      if (!matchesSearchCriteria(state.bookSnapshot)) {
        continue;
      }
      const snap = state.bookSnapshot;
      const resolvedLibraryId =
        state.libraryId || snap.libraryId || virtualLibraryId;
      const isVirtual =
        resolvedLibraryId.startsWith('virtual_') ||
        snap.ownershipStatus === 'unowned';
      matches.push({
        bookId:
          state.bookId ||
          snap.bookId ||
          (stateKey.startsWith('bookid:')
            ? stateKey.slice('bookid:'.length)
            : stateKey),
        libraryId: resolvedLibraryId,
        libraryName:
          snap.libraryName ||
          (isVirtual ? 'Personal Reading Shelf' : 'Library'),
        isVirtual,
        ownershipStatus: isVirtual ? 'unowned' : 'owned',
        title: snap.title || 'Untitled Book',
        author: snap.author || 'Unknown Author',
        ...(snap.series ? {series: snap.series} : {}),
        isbn: snap.isbn || state.cleanIsbn,
        coverUrl: snap.coverUrl,
        publishedDate: snap.publishedDate,
        primaryGenre: snap.primaryGenre,
        synopsis: snap.synopsis,
        readingStatus: normalizeShelfStatus(state.status),
        userRating: state.rating,
      });
    }

    return matches.slice(0, 25);
  })();

  const externalPromise = (async (): Promise<BookDetails[]> => {
    try {
      const searchOptions = {
        priority: 'INTERACTIVE' as const,
        verifyCovers: false,
      };
      if (isLikelyIsbn) {
        const byIsbn = await catalogOrchestrator.searchByIsbn(
          queryIsbn,
          searchOptions,
        );
        if (byIsbn) {
          const byQueryRes = await catalogOrchestrator
            .searchByQuery({rawQuery: query, limit: 15}, searchOptions)
            .catch(() => ({
              books: [] as BookDetails[],
              skippedProviders: [],
              respondedProviders: [],
            }));
          const extraBooks = Array.isArray(byQueryRes?.books)
            ? byQueryRes.books
            : [];
          return [byIsbn, ...extraBooks];
        }
      }
      const res = await catalogOrchestrator.searchByQuery(
        {rawQuery: query, limit: 15},
        searchOptions,
      );
      return Array.isArray(res?.books) ? res.books : [];
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
  const safeExternal = Array.isArray(rawExternal) ? rawExternal : [];

  for (const ext of safeExternal) {
    if (!ext || !ext.title) {
      continue;
    }
    const extIsbn = normalizeTrackerIsbnKey(ext.isbn);
    const extTitleKey = `${normalizeTrackerTextKey(ext.title)}::${normalizeTrackerTextKey(ext.author)}`;
    const dedupeKey = extIsbn || extTitleKey;
    if (seenExternalKeys.has(dedupeKey)) {
      continue;
    }
    seenExternalKeys.add(dedupeKey);

    const matchingLibBook = libraryMatches.find(libBook => {
      const libIsbn = normalizeTrackerIsbnKey(libBook.isbn);
      if (extIsbn && libIsbn && extIsbn === libIsbn) {
        return true;
      }
      const libTitleKey = `${normalizeTrackerTextKey(libBook.title)}::${normalizeTrackerTextKey(libBook.author)}`;
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
