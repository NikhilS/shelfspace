import {computeReadingStateKey} from '../schemas/readingState';
import type {
  Book,
  CanonicalEnrichmentType,
  Library,
  ReadingStatusValue,
  TrackedBookItem,
  TrackedShelfStatus,
} from '../types';
import type {
  EntityCacheState,
  NormalizedEntityReadingStatus,
} from './entityCacheStore';

export function normalizeStatusValue(
  raw: ReadingStatusValue | string | null | undefined,
): NormalizedEntityReadingStatus {
  if (!raw || raw === 'unset') {
    return 'unset';
  }
  if (raw === 'finished') {
    return 'finished';
  }
  if (raw === 'reading') {
    return 'reading';
  }
  if (raw === 'want_to_read') {
    return 'want_to_read';
  }
  if (raw === 'abandoned') {
    return 'abandoned';
  }
  return 'unset';
}

export function normalizeCleanIsbn(raw?: string | null): string {
  if (!raw) {
    return '';
  }
  return raw.replace(/[^0-9X]/gi, '').toUpperCase();
}

export function makeEntityBookKey(libraryId: string, bookId: string): string {
  return `${libraryId}:${bookId}`;
}

export function selectBookWithOverlay(
  state: Pick<
    EntityCacheState,
    'booksByKey' | 'readingStatesByBookKey' | 'isbnReadingStateIndex'
  >,
  libraryId: string,
  bookId: string,
): Book | undefined {
  const entityKey = makeEntityBookKey(libraryId, bookId);
  const baseBook = state.booksByKey[entityKey];
  if (!baseBook) {
    return undefined;
  }

  const canonicalStateKey = computeReadingStateKey({
    libraryId,
    isbn: baseBook.isbn,
    cleanIsbn: baseBook.cleanIsbn,
    bookId,
  });
  const cleanIsbn = normalizeCleanIsbn(baseBook.cleanIsbn || baseBook.isbn);
  const indexedStateKey = cleanIsbn
    ? state.isbnReadingStateIndex[cleanIsbn]
    : undefined;

  const overlay =
    state.readingStatesByBookKey[canonicalStateKey] ??
    (indexedStateKey
      ? state.readingStatesByBookKey[indexedStateKey]
      : undefined);

  if (!overlay) {
    return baseBook;
  }

  return {
    ...baseBook,
    readingStatus: overlay.status,
    ...(overlay.rating !== undefined ? {userRating: overlay.rating} : {}),
    ...(overlay.reviewedAt !== undefined
      ? {readStatusReviewedAt: overlay.reviewedAt}
      : {}),
    ...(overlay.startedAt !== undefined
      ? {startedAt: overlay.startedAt ?? undefined}
      : {}),
    ...(overlay.finishedAt !== undefined
      ? {finishedAt: overlay.finishedAt ?? undefined}
      : {}),
  };
}

export function selectLibraryBooks(
  state: Pick<
    EntityCacheState,
    | 'booksByKey'
    | 'bookIdsByLibrary'
    | 'readingStatesByBookKey'
    | 'isbnReadingStateIndex'
  >,
  libraryId: string,
): Book[] {
  const ids = state.bookIdsByLibrary[libraryId];
  if (!ids || ids.length === 0) {
    return [];
  }
  const result: Book[] = [];
  for (const bookId of ids) {
    const hydrated = selectBookWithOverlay(state, libraryId, bookId);
    if (hydrated) {
      result.push(hydrated);
    }
  }
  return result;
}

export function clearBookEnrichmentFieldOnEntity(
  existing: Book,
  field: CanonicalEnrichmentType,
): Book {
  const nextBook: Book = {...existing};
  const nextStatus = {...(existing.enrichmentStatus || {})};
  delete nextStatus[field];
  nextBook.enrichmentStatus = nextStatus;
  delete nextBook.skippedProviders;

  if (existing.fieldSources) {
    const nextSources = {...existing.fieldSources};
    delete nextSources[field];
    if (field === 'genre') {
      delete nextSources.primaryGenre;
    } else if (field === 'coverImage') {
      delete nextSources.coverUrl;
    }
    nextBook.fieldSources = nextSources;
  }

  if (Array.isArray(existing.missingFlags)) {
    nextBook.missingFlags = existing.missingFlags.includes(field)
      ? existing.missingFlags
      : [...existing.missingFlags, field];
  }

  switch (field) {
    case 'genre':
      delete nextBook.primaryGenre;
      delete nextBook.primaryGenreLower;
      nextBook.subgenres = [];
      nextBook.isCustomPrimary = false;
      break;
    case 'geo':
      delete nextBook.geoMetadata;
      break;
    case 'temporal':
      delete nextBook.temporalMetadata;
      break;
    case 'series':
      delete nextBook.series;
      break;
    case 'coverImage':
      delete nextBook.coverUrl;
      delete nextBook.coverUrlRaw;
      delete nextBook.coverCandidates;
      break;
    case 'synopsis':
      delete nextBook.synopsis;
      if (nextBook.bookDetailsMetadata) {
        nextBook.bookDetailsMetadata = {
          ...nextBook.bookDetailsMetadata,
          hasSynopsis: false,
        };
      }
      break;
    case 'authorBio':
      delete nextBook.authorBio;
      if (nextBook.bookDetailsMetadata) {
        nextBook.bookDetailsMetadata = {
          ...nextBook.bookDetailsMetadata,
          hasAuthorBio: false,
        };
      }
      break;
    case 'embedding':
      delete nextBook.embedding;
      delete nextBook.clusterCoordinates;
      if (nextBook.bookDetailsMetadata) {
        nextBook.bookDetailsMetadata = {
          ...nextBook.bookDetailsMetadata,
          hasEmbedding: false,
          hasClusterCoordinates: false,
        };
      }
      break;
  }

  return nextBook;
}

export function hydrateEntityStoreFromPersistedQuery(
  store: EntityCacheState,
  procedure: string,
  input: Record<string, unknown> | undefined,
  data: unknown,
): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  if (procedure === 'library.list') {
    const libraries: Library[] | undefined = Array.isArray(data)
      ? (data as Library[])
      : Array.isArray((data as {libraries?: unknown}).libraries)
        ? ((data as {libraries: Library[]}).libraries ?? undefined)
        : undefined;
    if (libraries) {
      for (const lib of libraries) {
        if (lib?.id && !store.librariesById[lib.id]) {
          store.upsertLibrary(lib);
        }
      }
    }
    return;
  }

  if (procedure === 'library.get') {
    const lib = data as Library;
    if (lib?.id && !store.librariesById[lib.id]) {
      store.upsertLibrary(lib);
    }
    return;
  }

  if (procedure === 'book.list') {
    const libraryId =
      typeof input?.libraryId === 'string' ? input.libraryId : '';
    if (!libraryId) {
      return;
    }
    const existingIds = store.bookIdsByLibrary[libraryId];
    if (existingIds && existingIds.length > 0) {
      return;
    }
    const books: Book[] | undefined = Array.isArray(data)
      ? (data as Book[])
      : Array.isArray((data as {books?: unknown}).books)
        ? ((data as {books: Book[]}).books ?? undefined)
        : undefined;
    if (books && books.length > 0) {
      store.hydrateLibraryBooks(libraryId, books, {replace: false});
    }
    return;
  }

  if (procedure === 'book.get') {
    const libraryId =
      typeof input?.libraryId === 'string' ? input.libraryId : '';
    const bookId = typeof input?.bookId === 'string' ? input.bookId : '';
    const book = data as Book;
    if (!libraryId || !bookId || !book?.id) {
      return;
    }
    const entityKey = makeEntityBookKey(libraryId, bookId);
    if (
      !store.booksByKey[entityKey] &&
      !store.mutationVersionByEntityKey[entityKey]
    ) {
      store.hydrateLibraryBooks(libraryId, [book], {replace: false});
    }
    return;
  }

  if (procedure === 'readingTracker.getShelf') {
    const items = Array.isArray((data as {items?: unknown}).items)
      ? ((data as {items: TrackedBookItem[]}).items ?? [])
      : [];
    if (items.length > 0) {
      store.hydrateTrackedShelfItems(
        items.filter(
          (
            item,
          ): item is TrackedBookItem & {readingStatus: TrackedShelfStatus} =>
            Boolean(item?.id && item?.libraryId && item?.readingStatus),
        ),
      );
    }
  }
}
