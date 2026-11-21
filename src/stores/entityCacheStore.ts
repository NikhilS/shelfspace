import {create} from 'zustand';
import {computeReadingStateKey} from '../schemas/readingState';
import type {
  Book,
  CanonicalEnrichmentType,
  Library,
  ReadingStatusValue,
  TrackedBookItem,
  TrackedShelfStatus,
} from '../types';
import {
  clearBookEnrichmentFieldOnEntity,
  makeEntityBookKey,
  normalizeCleanIsbn,
  normalizeStatusValue,
  selectBookWithOverlay,
  selectLibraryBooks,
} from './entityCacheHelpers';

export {makeEntityBookKey, selectBookWithOverlay, selectLibraryBooks};

export type NormalizedEntityReadingStatus = TrackedShelfStatus | 'unset';

export interface NormalizedReadingStateEntry {
  stateKey: string;
  libraryId: string;
  bookId: string;
  cleanIsbn?: string;
  status: NormalizedEntityReadingStatus;
  rating?: number;
  reviewedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAtMs: number;
  isOptimistic?: boolean;
}

export interface EntityBookReview {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: string;
}

export interface EntityRollbackSnapshot {
  entityKey: string;
  stateKey: string;
  libraryId: string;
  bookId: string;
  previousBook: Book | undefined;
  previousLibraryBookIds: string[] | undefined;
  previousReadingState: NormalizedReadingStateEntry | undefined;
  previousIsbnStateKey: {
    cleanIsbn: string;
    stateKey: string | undefined;
  } | null;
}

export interface PatchEntityReadingStateParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAt?: string | null;
  rating?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  isbn?: string;
  cleanIsbn?: string;
  isOptimistic?: boolean;
}

export interface EntityCacheState {
  librariesById: Record<string, Library>;
  booksByKey: Record<string, Book>;
  bookIdsByLibrary: Record<string, string[]>;
  readingStatesByBookKey: Record<string, NormalizedReadingStateEntry>;
  isbnReadingStateIndex: Record<string, string>;
  reviewsByBookKey: Record<string, EntityBookReview[]>;
  mutationVersionByEntityKey: Record<string, number>;
  nextMutationVersion: number;

  upsertLibrary: (library: Library) => void;
  adjustLibraryBookCount: (libraryId: string, delta: number) => void;
  hydrateLibraryBooks: (
    libraryId: string,
    books: Book[],
    options?: {replace?: boolean},
  ) => void;
  upsertBooksDelta: (
    libraryId: string,
    books: Array<Partial<Book> & {id: string}>,
    options?: {bookCountDelta?: number; prependNew?: boolean},
  ) => void;
  patchBookOptimistically: (
    libraryId: string,
    bookId: string,
    patch: Partial<Book>,
  ) => {
    version: number;
    snapshot: EntityRollbackSnapshot;
  };
  clearLibraryEnrichmentField: (
    libraryId: string,
    field: CanonicalEnrichmentType,
  ) => void;
  removeBooks: (
    libraryId: string,
    bookIds: string[],
    options?: {bookCountDelta?: number},
  ) => EntityRollbackSnapshot[];
  patchReadingState: (params: PatchEntityReadingStateParams) => {
    version: number;
    snapshot: EntityRollbackSnapshot;
  };
  rollbackEntitySnapshot: (
    snapshot: EntityRollbackSnapshot,
    expectedVersion?: number,
  ) => boolean;
  upsertBookReview: (
    libraryId: string,
    bookId: string,
    review: EntityBookReview,
  ) => void;
  hydrateTrackedShelfItems: (items: TrackedBookItem[]) => void;
  clearAllEntities: () => void;
}

const INITIAL_ENTITY_CACHE_STATE = {
  librariesById: {} as Record<string, Library>,
  booksByKey: {} as Record<string, Book>,
  bookIdsByLibrary: {} as Record<string, string[]>,
  readingStatesByBookKey: {} as Record<string, NormalizedReadingStateEntry>,
  isbnReadingStateIndex: {} as Record<string, string>,
  reviewsByBookKey: {} as Record<string, EntityBookReview[]>,
  mutationVersionByEntityKey: {} as Record<string, number>,
  nextMutationVersion: 1,
};

export const useEntityCacheStore = create<EntityCacheState>((set, get) => ({
  ...INITIAL_ENTITY_CACHE_STATE,

  upsertLibrary: library => {
    if (!library?.id) {
      return;
    }
    set(state => ({
      librariesById: {
        ...state.librariesById,
        [library.id]: {
          ...(state.librariesById[library.id] || {}),
          ...library,
        },
      },
    }));
  },

  adjustLibraryBookCount: (libraryId, delta) => {
    if (!libraryId || !delta || libraryId.startsWith('virtual_')) {
      return;
    }
    set(state => {
      const existing = state.librariesById[libraryId];
      if (!existing) {
        return state;
      }
      const current =
        typeof existing.bookCount === 'number' ? existing.bookCount : 0;
      return {
        librariesById: {
          ...state.librariesById,
          [libraryId]: {
            ...existing,
            bookCount: Math.max(0, current + delta),
          },
        },
      };
    });
  },

  hydrateLibraryBooks: (libraryId, books, options) => {
    if (!libraryId) {
      return;
    }
    set(state => {
      const replace = options?.replace !== false;
      const nextBooksByKey = {...state.booksByKey};
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};
      const existingIds = state.bookIdsByLibrary[libraryId] || [];

      if (replace) {
        const incomingIdSet = new Set(books.map(b => b.id));
        for (const oldId of existingIds) {
          if (!incomingIdSet.has(oldId)) {
            delete nextBooksByKey[makeEntityBookKey(libraryId, oldId)];
          }
        }
      }

      const seenIds = new Set<string>();
      const orderedIds: string[] = [];

      if (!replace) {
        for (const id of existingIds) {
          if (!seenIds.has(id)) {
            seenIds.add(id);
            orderedIds.push(id);
          }
        }
      }

      const nowMs = Date.now();
      for (const incoming of books) {
        if (!incoming?.id) {
          continue;
        }
        const entityKey = makeEntityBookKey(libraryId, incoming.id);
        const existingBook = nextBooksByKey[entityKey];
        const stateKey = computeReadingStateKey({
          libraryId,
          isbn: incoming.isbn,
          cleanIsbn: incoming.cleanIsbn,
          bookId: incoming.id,
        });
        const existingState = nextReadingStates[stateKey];

        // Preserve in-flight optimistic reading state over stale background hydration
        const preserveOptimistic = Boolean(existingState?.isOptimistic);
        const normalizedIncomingStatus = normalizeStatusValue(
          incoming.readingStatus,
        );

        const mergedBook: Book = {
          ...(existingBook || {}),
          ...incoming,
          id: incoming.id,
          libraryId,
          ...(preserveOptimistic && existingState
            ? {
                readingStatus: existingState.status,
                ...(existingState.rating !== undefined
                  ? {userRating: existingState.rating}
                  : {}),
                ...(existingState.reviewedAt !== undefined
                  ? {readStatusReviewedAt: existingState.reviewedAt}
                  : {}),
              }
            : {}),
        };
        nextBooksByKey[entityKey] = mergedBook;

        if (!seenIds.has(incoming.id)) {
          seenIds.add(incoming.id);
          orderedIds.push(incoming.id);
        }

        if (!preserveOptimistic && normalizedIncomingStatus !== 'unset') {
          const cleanIsbn = normalizeCleanIsbn(
            incoming.cleanIsbn || incoming.isbn,
          );
          nextReadingStates[stateKey] = {
            stateKey,
            libraryId,
            bookId: incoming.id,
            ...(cleanIsbn ? {cleanIsbn} : {}),
            status: normalizedIncomingStatus,
            ...(incoming.userRating !== undefined
              ? {rating: incoming.userRating}
              : {}),
            ...(incoming.readStatusReviewedAt !== undefined
              ? {reviewedAt: incoming.readStatusReviewedAt}
              : {}),
            ...(incoming.startedAt !== undefined
              ? {startedAt: incoming.startedAt}
              : {}),
            ...(incoming.finishedAt !== undefined
              ? {finishedAt: incoming.finishedAt}
              : {}),
            updatedAtMs: nowMs,
          };
          if (cleanIsbn) {
            nextIsbnIndex[cleanIsbn] = stateKey;
          }
        }
      }

      return {
        booksByKey: nextBooksByKey,
        bookIdsByLibrary: {
          ...state.bookIdsByLibrary,
          [libraryId]: orderedIds,
        },
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
      };
    });
  },

  upsertBooksDelta: (libraryId, books, options) => {
    if (!libraryId || books.length === 0) {
      return;
    }
    set(state => {
      const nextBooksByKey = {...state.booksByKey};
      const existingIds = state.bookIdsByLibrary[libraryId] || [];
      const existingSet = new Set(existingIds);
      const prependedIds: string[] = [];
      const appendedIds: string[] = [];
      const nextMutationVersions = {...state.mutationVersionByEntityKey};
      let versionCounter = state.nextMutationVersion;

      for (const patch of books) {
        if (!patch?.id) {
          continue;
        }
        const entityKey = makeEntityBookKey(libraryId, patch.id);
        const current = nextBooksByKey[entityKey];
        const merged: Book = {
          ...(current || {}),
          ...patch,
          format: patch.format ?? current?.format ?? 'physical',
          addedAt:
            patch.addedAt ?? current?.addedAt ?? new Date().toISOString(),
          title: patch.title ?? current?.title ?? 'Untitled Book',
          author: patch.author ?? current?.author ?? 'Unknown Author',
          id: patch.id,
          libraryId,
        };
        nextBooksByKey[entityKey] = merged;
        nextMutationVersions[entityKey] = versionCounter++;

        if (!existingSet.has(patch.id)) {
          existingSet.add(patch.id);
          if (options?.prependNew !== false) {
            prependedIds.push(patch.id);
          } else {
            appendedIds.push(patch.id);
          }
        }
      }

      const nextIds = [...prependedIds, ...existingIds, ...appendedIds];
      const nextLibraries = {...state.librariesById};
      const countDelta = options?.bookCountDelta ?? 0;
      if (
        countDelta !== 0 &&
        !libraryId.startsWith('virtual_') &&
        nextLibraries[libraryId]
      ) {
        const existingLib = nextLibraries[libraryId];
        const currentCount =
          typeof existingLib.bookCount === 'number' ? existingLib.bookCount : 0;
        nextLibraries[libraryId] = {
          ...existingLib,
          bookCount: Math.max(0, currentCount + countDelta),
        };
      }

      return {
        booksByKey: nextBooksByKey,
        bookIdsByLibrary: {
          ...state.bookIdsByLibrary,
          [libraryId]: nextIds,
        },
        librariesById: nextLibraries,
        mutationVersionByEntityKey: nextMutationVersions,
        nextMutationVersion: versionCounter,
      };
    });
  },

  patchBookOptimistically: (libraryId, bookId, patch) => {
    const entityKey = makeEntityBookKey(libraryId, bookId);
    const currentState = get();
    const existingBook = currentState.booksByKey[entityKey];
    const cleanIsbn = normalizeCleanIsbn(
      patch.cleanIsbn ||
        patch.isbn ||
        existingBook?.cleanIsbn ||
        existingBook?.isbn,
    );
    const stateKey = computeReadingStateKey({
      libraryId,
      isbn: patch.isbn ?? existingBook?.isbn,
      cleanIsbn,
      bookId,
    });

    const snapshot: EntityRollbackSnapshot = {
      entityKey,
      stateKey,
      libraryId,
      bookId,
      previousBook: existingBook,
      previousLibraryBookIds: currentState.bookIdsByLibrary[libraryId],
      previousReadingState: currentState.readingStatesByBookKey[stateKey],
      previousIsbnStateKey: cleanIsbn
        ? {
            cleanIsbn,
            stateKey: currentState.isbnReadingStateIndex[cleanIsbn],
          }
        : null,
    };

    const assignedVersion = currentState.nextMutationVersion;

    set(state => {
      const nextBooksByKey = {...state.booksByKey};
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};
      const prevBook = nextBooksByKey[entityKey];

      if (prevBook || patch.title) {
        nextBooksByKey[entityKey] = {
          ...(prevBook || {}),
          ...patch,
          id: bookId,
          libraryId,
          format: patch.format ?? prevBook?.format ?? 'physical',
          addedAt:
            patch.addedAt ?? prevBook?.addedAt ?? new Date().toISOString(),
          title: patch.title ?? prevBook?.title ?? 'Untitled Book',
          author: patch.author ?? prevBook?.author ?? 'Unknown Author',
        };
      }

      if (patch.readingStatus !== undefined) {
        const normalizedStatus = normalizeStatusValue(patch.readingStatus);
        const prevStateEntry = nextReadingStates[stateKey];
        if (normalizedStatus === 'unset') {
          delete nextReadingStates[stateKey];
          if (cleanIsbn && nextIsbnIndex[cleanIsbn] === stateKey) {
            delete nextIsbnIndex[cleanIsbn];
          }
        } else {
          nextReadingStates[stateKey] = {
            stateKey,
            libraryId,
            bookId,
            ...(cleanIsbn ? {cleanIsbn} : {}),
            status: normalizedStatus,
            rating: patch.userRating ?? prevStateEntry?.rating,
            reviewedAt:
              patch.readStatusReviewedAt !== undefined
                ? patch.readStatusReviewedAt
                : prevStateEntry?.reviewedAt,
            startedAt:
              patch.startedAt !== undefined
                ? patch.startedAt
                : prevStateEntry?.startedAt,
            finishedAt:
              patch.finishedAt !== undefined
                ? patch.finishedAt
                : prevStateEntry?.finishedAt,
            updatedAtMs: Date.now(),
            isOptimistic: true,
          };
          if (cleanIsbn) {
            nextIsbnIndex[cleanIsbn] = stateKey;
          }
        }
      }

      return {
        booksByKey: nextBooksByKey,
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
        mutationVersionByEntityKey: {
          ...state.mutationVersionByEntityKey,
          [entityKey]: assignedVersion,
        },
        nextMutationVersion: state.nextMutationVersion + 1,
      };
    });

    return {version: assignedVersion, snapshot};
  },

  clearLibraryEnrichmentField: (libraryId, field) => {
    if (!libraryId) {
      return;
    }
    set(state => {
      const ids = state.bookIdsByLibrary[libraryId] || [];
      if (ids.length === 0) {
        return state;
      }
      const nextBooksByKey = {...state.booksByKey};
      const nextMutationVersions = {...state.mutationVersionByEntityKey};
      let versionCounter = state.nextMutationVersion;

      for (const bookId of ids) {
        const entityKey = makeEntityBookKey(libraryId, bookId);
        const existing = nextBooksByKey[entityKey];
        if (!existing) {
          continue;
        }
        nextBooksByKey[entityKey] = clearBookEnrichmentFieldOnEntity(
          existing,
          field,
        );
        nextMutationVersions[entityKey] = versionCounter++;
      }

      return {
        booksByKey: nextBooksByKey,
        mutationVersionByEntityKey: nextMutationVersions,
        nextMutationVersion: versionCounter,
      };
    });
  },

  removeBooks: (libraryId, bookIds, options) => {
    if (!libraryId || bookIds.length === 0) {
      return [];
    }
    const snapshots: EntityRollbackSnapshot[] = [];
    const currentState = get();
    const removeSet = new Set(bookIds);
    const prevIds = currentState.bookIdsByLibrary[libraryId];

    for (const bookId of bookIds) {
      const entityKey = makeEntityBookKey(libraryId, bookId);
      const prevBook = currentState.booksByKey[entityKey];
      const cleanIsbn = normalizeCleanIsbn(
        prevBook?.cleanIsbn || prevBook?.isbn,
      );
      const stateKey = computeReadingStateKey({
        libraryId,
        isbn: prevBook?.isbn,
        cleanIsbn,
        bookId,
      });
      snapshots.push({
        entityKey,
        stateKey,
        libraryId,
        bookId,
        previousBook: prevBook,
        previousLibraryBookIds: prevIds,
        previousReadingState: currentState.readingStatesByBookKey[stateKey],
        previousIsbnStateKey: cleanIsbn
          ? {
              cleanIsbn,
              stateKey: currentState.isbnReadingStateIndex[cleanIsbn],
            }
          : null,
      });
    }

    set(state => {
      const nextBooksByKey = {...state.booksByKey};
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};
      const nextReviews = {...state.reviewsByBookKey};
      const nextMutationVersions = {...state.mutationVersionByEntityKey};
      let versionCounter = state.nextMutationVersion;

      for (const bookId of bookIds) {
        const entityKey = makeEntityBookKey(libraryId, bookId);
        const prevBook = nextBooksByKey[entityKey];
        const cleanIsbn = normalizeCleanIsbn(
          prevBook?.cleanIsbn || prevBook?.isbn,
        );
        const stateKey = computeReadingStateKey({
          libraryId,
          isbn: prevBook?.isbn,
          cleanIsbn,
          bookId,
        });
        delete nextBooksByKey[entityKey];
        delete nextReadingStates[stateKey];
        delete nextReviews[entityKey];
        if (cleanIsbn && nextIsbnIndex[cleanIsbn] === stateKey) {
          delete nextIsbnIndex[cleanIsbn];
        }
        nextMutationVersions[entityKey] = versionCounter++;
      }

      const existingIds = state.bookIdsByLibrary[libraryId] || [];
      const filteredIds = existingIds.filter(id => !removeSet.has(id));

      const nextLibraries = {...state.librariesById};
      const countDelta = options?.bookCountDelta ?? 0;
      if (
        countDelta !== 0 &&
        !libraryId.startsWith('virtual_') &&
        nextLibraries[libraryId]
      ) {
        const existingLib = nextLibraries[libraryId];
        const currentCount =
          typeof existingLib.bookCount === 'number' ? existingLib.bookCount : 0;
        nextLibraries[libraryId] = {
          ...existingLib,
          bookCount: Math.max(0, currentCount + countDelta),
        };
      }

      return {
        booksByKey: nextBooksByKey,
        bookIdsByLibrary: {
          ...state.bookIdsByLibrary,
          [libraryId]: filteredIds,
        },
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
        reviewsByBookKey: nextReviews,
        librariesById: nextLibraries,
        mutationVersionByEntityKey: nextMutationVersions,
        nextMutationVersion: versionCounter,
      };
    });

    return snapshots;
  },

  patchReadingState: params => {
    const {libraryId, bookId} = params;
    const entityKey = makeEntityBookKey(libraryId, bookId);
    const currentState = get();
    const existingBook = currentState.booksByKey[entityKey];
    const cleanIsbn = normalizeCleanIsbn(
      params.cleanIsbn ||
        params.isbn ||
        existingBook?.cleanIsbn ||
        existingBook?.isbn,
    );
    const stateKey = computeReadingStateKey({
      libraryId,
      cleanIsbn,
      bookId,
    });

    const snapshot: EntityRollbackSnapshot = {
      entityKey,
      stateKey,
      libraryId,
      bookId,
      previousBook: existingBook,
      previousLibraryBookIds: currentState.bookIdsByLibrary[libraryId],
      previousReadingState: currentState.readingStatesByBookKey[stateKey],
      previousIsbnStateKey: cleanIsbn
        ? {
            cleanIsbn,
            stateKey: currentState.isbnReadingStateIndex[cleanIsbn],
          }
        : null,
    };

    const assignedVersion = currentState.nextMutationVersion;
    const normalizedStatus = normalizeStatusValue(params.status);

    set(state => {
      const nextBooksByKey = {...state.booksByKey};
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};
      const prevStateEntry = nextReadingStates[stateKey];

      if (normalizedStatus === 'unset') {
        delete nextReadingStates[stateKey];
        if (cleanIsbn && nextIsbnIndex[cleanIsbn] === stateKey) {
          delete nextIsbnIndex[cleanIsbn];
        }
      } else {
        nextReadingStates[stateKey] = {
          stateKey,
          libraryId,
          bookId,
          ...(cleanIsbn ? {cleanIsbn} : {}),
          status: normalizedStatus,
          rating: params.rating ?? prevStateEntry?.rating,
          reviewedAt:
            params.reviewedAt !== undefined
              ? params.reviewedAt
              : prevStateEntry?.reviewedAt,
          startedAt:
            params.startedAt !== undefined
              ? params.startedAt
              : prevStateEntry?.startedAt,
          finishedAt:
            params.finishedAt !== undefined
              ? params.finishedAt
              : prevStateEntry?.finishedAt,
          updatedAtMs: Date.now(),
          isOptimistic: Boolean(params.isOptimistic),
        };
        if (cleanIsbn) {
          nextIsbnIndex[cleanIsbn] = stateKey;
        }
      }

      const bookRecord = nextBooksByKey[entityKey];
      if (bookRecord) {
        nextBooksByKey[entityKey] = {
          ...bookRecord,
          readingStatus: normalizedStatus,
          ...(params.rating !== undefined ? {userRating: params.rating} : {}),
          ...(params.reviewedAt !== undefined
            ? {readStatusReviewedAt: params.reviewedAt}
            : {}),
          ...(params.startedAt !== undefined
            ? {startedAt: params.startedAt ?? undefined}
            : {}),
          ...(params.finishedAt !== undefined
            ? {finishedAt: params.finishedAt ?? undefined}
            : {}),
        };
      }

      return {
        booksByKey: nextBooksByKey,
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
        mutationVersionByEntityKey: {
          ...state.mutationVersionByEntityKey,
          [entityKey]: assignedVersion,
        },
        nextMutationVersion: state.nextMutationVersion + 1,
      };
    });

    return {version: assignedVersion, snapshot};
  },

  rollbackEntitySnapshot: (snapshot, expectedVersion) => {
    const currentVersion =
      get().mutationVersionByEntityKey[snapshot.entityKey] ?? 0;
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      // Newer mutation superseded this optimistic patch; ignore stale rollback
      return false;
    }

    set(state => {
      const nextBooksByKey = {...state.booksByKey};
      const nextBookIdsByLibrary = {...state.bookIdsByLibrary};
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};

      if (snapshot.previousBook) {
        nextBooksByKey[snapshot.entityKey] = snapshot.previousBook;
      } else {
        delete nextBooksByKey[snapshot.entityKey];
      }

      if (snapshot.previousLibraryBookIds !== undefined) {
        nextBookIdsByLibrary[snapshot.libraryId] =
          snapshot.previousLibraryBookIds;
      }

      if (snapshot.previousReadingState) {
        nextReadingStates[snapshot.stateKey] = snapshot.previousReadingState;
      } else {
        delete nextReadingStates[snapshot.stateKey];
      }

      if (snapshot.previousIsbnStateKey) {
        const {cleanIsbn, stateKey} = snapshot.previousIsbnStateKey;
        if (stateKey) {
          nextIsbnIndex[cleanIsbn] = stateKey;
        } else {
          delete nextIsbnIndex[cleanIsbn];
        }
      }

      return {
        booksByKey: nextBooksByKey,
        bookIdsByLibrary: nextBookIdsByLibrary,
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
      };
    });

    return true;
  },

  upsertBookReview: (libraryId, bookId, review) => {
    if (!libraryId || !bookId || !review) {
      return;
    }
    const entityKey = makeEntityBookKey(libraryId, bookId);
    set(state => {
      const existingReviews = state.reviewsByBookKey[entityKey] || [];
      const filtered = existingReviews.filter(
        r =>
          r.userId !== review.userId &&
          r.id !== review.id &&
          !String(r.id).startsWith('temp-'),
      );
      const nextBooksByKey = {...state.booksByKey};
      if (nextBooksByKey[entityKey]) {
        nextBooksByKey[entityKey] = {
          ...nextBooksByKey[entityKey],
          userRating: review.rating,
        };
      }
      return {
        reviewsByBookKey: {
          ...state.reviewsByBookKey,
          [entityKey]: [review, ...filtered],
        },
        booksByKey: nextBooksByKey,
      };
    });
  },

  hydrateTrackedShelfItems: items => {
    if (!items || items.length === 0) {
      return;
    }
    set(state => {
      const nextReadingStates = {...state.readingStatesByBookKey};
      const nextIsbnIndex = {...state.isbnReadingStateIndex};
      let changed = false;
      const nowMs = Date.now();

      for (const item of items) {
        if (!item?.id || !item?.libraryId) {
          continue;
        }
        const entityKey = makeEntityBookKey(item.libraryId, item.id);
        if (state.mutationVersionByEntityKey[entityKey]) {
          continue;
        }
        const cleanIsbn = normalizeCleanIsbn(item.isbn);
        const stateKey = computeReadingStateKey({
          libraryId: item.libraryId,
          isbn: item.isbn,
          cleanIsbn,
          bookId: item.id,
        });
        if (nextReadingStates[stateKey]) {
          continue;
        }
        const normalizedStatus = normalizeStatusValue(item.readingStatus);
        if (normalizedStatus === 'unset') {
          continue;
        }
        nextReadingStates[stateKey] = {
          stateKey,
          libraryId: item.libraryId,
          bookId: item.id,
          ...(cleanIsbn ? {cleanIsbn} : {}),
          status: normalizedStatus,
          ...(item.userRating !== undefined ? {rating: item.userRating} : {}),
          ...(item.readStatusReviewedAt !== undefined
            ? {reviewedAt: item.readStatusReviewedAt}
            : {}),
          ...(item.startedAt !== undefined ? {startedAt: item.startedAt} : {}),
          ...(item.finishedAt !== undefined
            ? {finishedAt: item.finishedAt}
            : {}),
          updatedAtMs: nowMs,
        };
        if (cleanIsbn && !nextIsbnIndex[cleanIsbn]) {
          nextIsbnIndex[cleanIsbn] = stateKey;
        }
        changed = true;
      }

      if (!changed) {
        return state;
      }
      return {
        readingStatesByBookKey: nextReadingStates,
        isbnReadingStateIndex: nextIsbnIndex,
      };
    });
  },

  clearAllEntities: () => {
    set({
      ...INITIAL_ENTITY_CACHE_STATE,
    });
  },
}));
