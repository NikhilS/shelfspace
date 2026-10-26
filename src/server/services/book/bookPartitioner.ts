import type {
  Book,
  BookDetailsMetadata,
  BookDetailsPayload,
  BookTemporalMetadata,
  StoredBookDetailsDoc,
  StoredBookDoc,
} from '../../../types';
import {
  storedBookDetailsDocSchema,
  storedBookDocSchema,
} from '../../../schemas/book';

export interface StoredBookWritePayload extends Omit<
  Partial<StoredBookDoc>,
  'addedAt' | 'updatedAt' | 'searchTokens'
> {
  addedAt?: unknown;
  updatedAt?: unknown;
  searchTokens?: string[] | unknown;
  [key: string]: unknown;
}

export const HEAVY_FIELDS = new Set([
  'synopsis',
  'authorBio',
  'embedding',
  'clusterCoordinates',
  'description',
]);

export const IMMUTABLE_SYSTEM_FIELDS = new Set([
  'id',
  'bookId',
  'libraryId',
  'addedBy',
  'addedAt',
  'updatedAt',
  'bookCount',
  'ownerId',
  'access',
  'action',
  'operation',
  '__proto__',
  'constructor',
  'prototype',
]);

export const ALLOWED_CORE_BOOK_FIELDS = new Set([
  'title',
  'author',
  'isbn',
  'cleanIsbn',
  'dedupeKey',
  'searchTokens',
  'coverUrl',
  'coverUrlRaw',
  'publishedDate',
  'primaryGenre',
  'subgenres',
  'isCustomPrimary',
  'series',
  'format',
  'ownershipStatus',
  'geoMetadata',
  'temporalMetadata',
  'enrichmentStatus',
  'bookDetailsMetadata',
  'coverCandidates',
  'sources',
  'fieldSources',
  'skippedProviders',
]);

import {FieldValue} from 'firebase-admin/firestore';
import {
  hasControlCharacters,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  normalizeIsbnForDedupe,
  computeBookDedupeKey,
  computeBookSearchTokens,
} from '../../../lib/duplicateDetection';

export function isUnsafeFieldKey(key: string): boolean {
  return (
    IMMUTABLE_SYSTEM_FIELDS.has(key) ||
    key.includes('.') ||
    key.includes('/') ||
    hasControlCharacters(key)
  );
}

/**
 * Converts a Firestore Timestamp, Date, numeric epoch, or string into an ISO-8601 string.
 */
export function normalizeFirestoreTimestamp(val: unknown): string | undefined {
  if (val === undefined || val === null || val === '') {
    return undefined;
  }
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return new Date(val).toISOString();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as {toDate?: () => Date}).toDate === 'function'
  ) {
    return (val as {toDate: () => Date}).toDate().toISOString();
  }
  return undefined;
}

/**
 * Validates and normalizes temporal metadata bounds (-10000 to 2100) and fills endYear.
 */
export function sanitizeTemporalMetadata(
  temporal: BookTemporalMetadata | undefined,
): BookTemporalMetadata | undefined {
  if (!temporal || typeof temporal !== 'object') {
    return undefined;
  }
  const copy: BookTemporalMetadata = {...temporal};
  if (
    typeof copy.startYear === 'number' &&
    (copy.endYear === undefined || copy.endYear === null)
  ) {
    copy.endYear = copy.startYear;
  }
  const start = copy.startYear;
  const end = copy.endYear;
  if (
    (typeof start === 'number' && (start < -10000 || start > 2100)) ||
    (typeof end === 'number' && (end < -10000 || end > 2100))
  ) {
    return undefined;
  }
  return copy;
}

export interface PartitionUpdateOptions {
  callerUserId?: string;
  existingBook?: {
    title?: string;
    author?: string;
    isbn?: string;
    series?: string;
  };
}

/**
 * Typed Firestore converter for `/libraries/{libraryId}/bookDetails/{bookId}`.
 */
export const bookDetailsDocConverter = {
  fromFirestore(
    bookId: string,
    raw: Record<string, unknown>,
    documentPath = `bookDetails/${bookId}`,
  ): StoredBookDetailsDoc {
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
    };
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return validateFirestoreReadPayload(storedBookDetailsDocSchema, candidate, {
      entity: 'StoredBookDetailsDoc',
      documentPath,
      operation: 'read',
    });
  },

  toFirestoreWrite(
    bookId: string,
    payload: Record<string, unknown>,
    operation: 'create' | 'update' | 'upsert' = 'upsert',
    documentPath = `bookDetails/${bookId}`,
  ): Record<string, unknown> {
    validateFirestoreWritePayload(
      operation === 'create'
        ? storedBookDetailsDocSchema
        : storedBookDetailsDocSchema.partial(),
      payload,
      {
        entity: 'StoredBookDetailsDoc',
        documentPath,
        operation,
      },
    );
    return payload;
  },
};

/**
 * Deprecated legacy fields on `/libraries/{libraryId}/books/{bookId}` documents that
 * are completely ignored on read and never propagated to `StoredBookDoc` or client DTOs.
 */
const IGNORED_LEGACY_BOOK_FIELDS = new Set([
  'genres',
  'genre',
  'description',
  'readingStatus',
  'userRating',
  'rating',
  'reviewText',
  'reviewedAt',
  'startedAt',
  'finishedAt',
  'readStatusReviewedAt',
]);

/**
 * Typed Firestore converter for `/libraries/{libraryId}/books/{bookId}`.
 */
export const bookDocConverter = {
  fromFirestore(
    bookId: string,
    raw: Record<string, unknown>,
    documentPath = `books/${bookId}`,
  ): StoredBookDoc {
    const addedAt = normalizeFirestoreTimestamp(raw.addedAt);
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: bookId,
      title:
        typeof raw.title === 'string' && raw.title.trim().length > 0
          ? raw.title
          : 'Untitled Book',
      author:
        typeof raw.author === 'string' && raw.author.trim().length > 0
          ? raw.author
          : 'Unknown Author',
    };
    for (const legacyKey of IGNORED_LEGACY_BOOK_FIELDS) {
      delete candidate[legacyKey];
    }
    if (addedAt !== undefined) {
      candidate.addedAt = addedAt;
    } else {
      delete candidate.addedAt;
    }
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return validateFirestoreReadPayload(storedBookDocSchema, candidate, {
      entity: 'StoredBookDoc',
      documentPath,
      operation: 'read',
    });
  },

  /**
   * Used during Shelf Care sanitization (`resetMetadata('sanitize')`) and batch enrichment
   * to inspect and separate any legacy heavy fields (`synopsis`, `authorBio`, `embedding`,
   * `clusterCoordinates`, `description`) before validating both partitions against their schemas.
   */
  fromFirestoreWithLegacyLeaks(
    bookId: string,
    raw: Record<string, unknown>,
    documentPath = `books/${bookId}`,
  ): {
    book: StoredBookDoc;
    leakedDetails: StoredBookDetailsDoc;
    hasLeaks: boolean;
  } {
    const coreRaw: Record<string, unknown> = {};
    const heavyRaw: Record<string, unknown> = {};
    let hasLeaks = false;

    for (const [key, val] of Object.entries(raw)) {
      if (HEAVY_FIELDS.has(key)) {
        if (val !== undefined) {
          hasLeaks = true;
          heavyRaw[key] = val;
        }
      } else {
        coreRaw[key] = val;
      }
    }

    const book = bookDocConverter.fromFirestore(bookId, coreRaw, documentPath);
    const leakedDetails =
      Object.keys(heavyRaw).length > 0
        ? bookDetailsDocConverter.fromFirestore(
            bookId,
            heavyRaw,
            `bookDetails/${bookId}`,
          )
        : {};

    return {book, leakedDetails, hasLeaks};
  },
};

export class BookPartitioner {
  static partitionCreatePayload(
    input: Record<string, unknown>,
    bookId: string,
    userId?: string,
    serverTimestamp?: unknown,
  ): {
    cleanCore: StoredBookWritePayload;
    cleanHeavy: StoredBookDetailsDoc;
    bookDetailsMetadata: BookDetailsMetadata;
  } {
    const rawInput: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      if (isUnsafeFieldKey(key)) {
        continue;
      }
      if (ALLOWED_CORE_BOOK_FIELDS.has(key)) {
        rawInput[key] = val;
      }
    }

    const nestedHeavyRaw =
      (input.heavyDetails as Record<string, unknown> | undefined) ||
      (input.heavyData as Record<string, unknown> | undefined) ||
      {};

    const heavyData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nestedHeavyRaw)) {
      if (HEAVY_FIELDS.has(k) && !isUnsafeFieldKey(k)) {
        heavyData[k] = v;
      }
    }

    const synopsisVal =
      input.synopsis !== undefined && input.synopsis !== null
        ? input.synopsis
        : input.description !== undefined && input.description !== null
          ? input.description
          : nestedHeavyRaw.synopsis !== undefined
            ? nestedHeavyRaw.synopsis
            : nestedHeavyRaw.description;

    if (synopsisVal !== undefined && synopsisVal !== null) {
      heavyData.synopsis = synopsisVal;
    }
    if (input.authorBio !== undefined && input.authorBio !== null) {
      heavyData.authorBio = input.authorBio;
    }
    const embeddingVal =
      input.embedding !== undefined && input.embedding !== null
        ? input.embedding
        : (input.embeddings as number[] | undefined);
    if (embeddingVal !== undefined && embeddingVal !== null) {
      heavyData.embedding = embeddingVal;
    }
    if (
      input.clusterCoordinates !== undefined &&
      input.clusterCoordinates !== null
    ) {
      heavyData.clusterCoordinates = input.clusterCoordinates;
    }

    const cleanHeavy = Object.fromEntries(
      Object.entries(heavyData).filter(
        ([k, v]) =>
          k !== 'description' && v !== undefined && v !== null && v !== '',
      ),
    ) as BookDetailsPayload;

    const existingMeta =
      input.bookDetailsMetadata &&
      typeof input.bookDetailsMetadata === 'object' &&
      !Array.isArray(input.bookDetailsMetadata)
        ? (input.bookDetailsMetadata as BookDetailsMetadata)
        : {};
    const bookDetailsMetadata: BookDetailsMetadata = {
      hasSynopsis:
        Boolean(cleanHeavy.synopsis) || Boolean(existingMeta.hasSynopsis),
      hasAuthorBio:
        Boolean(cleanHeavy.authorBio) || Boolean(existingMeta.hasAuthorBio),
      hasEmbedding:
        Boolean(
          Array.isArray(cleanHeavy.embedding) &&
          cleanHeavy.embedding.length > 0,
        ) || Boolean(existingMeta.hasEmbedding),
      hasClusterCoordinates:
        Boolean(cleanHeavy.clusterCoordinates) ||
        Boolean(existingMeta.hasClusterCoordinates),
    };

    // Per-user reading state is stored in /users/{userId}/readingStates/{stateKey}, never on books/{bookId}
    delete rawInput.readingStatus;

    const titleStr = (input.title as string) || '';
    const authorStr = (input.author as string) || 'Unknown Author';
    const isbnStr = input.isbn as string | undefined;
    const seriesStr = input.series as string | undefined;

    const computedCleanIsbn = normalizeIsbnForDedupe(isbnStr);
    const computedDedupeKey = computeBookDedupeKey(titleStr, authorStr);
    const computedSearchTokens = computeBookSearchTokens({
      title: titleStr,
      author: authorStr,
      isbn: isbnStr,
      series: seriesStr,
    });

    const coreData: Record<string, unknown> = {
      ...rawInput,
      id: bookId,
      title: input.title,
      author: authorStr,
      format: (input.format as string) || 'physical',
      ...(computedCleanIsbn ? {cleanIsbn: computedCleanIsbn} : {}),
      ...(computedDedupeKey ? {dedupeKey: computedDedupeKey} : {}),
      ...(computedSearchTokens.length > 0
        ? {searchTokens: computedSearchTokens}
        : {}),
      addedBy: userId || null,
      addedAt: serverTimestamp,
      updatedAt: serverTimestamp,
      bookDetailsMetadata,
    };

    HEAVY_FIELDS.forEach(f => {
      delete coreData[f];
    });
    delete coreData.embeddings;
    delete coreData.heavyDetails;
    delete coreData.heavyData;

    const cleanCore = Object.fromEntries(
      Object.entries(coreData).filter(([, v]) => v !== undefined),
    ) as StoredBookWritePayload;

    validateFirestoreWritePayload(storedBookDocSchema, cleanCore, {
      entity: 'StoredBookDoc',
      documentPath: `books/${bookId}`,
      operation: 'create',
    });
    if (Object.keys(cleanHeavy).length > 0) {
      validateFirestoreWritePayload(storedBookDetailsDocSchema, cleanHeavy, {
        entity: 'StoredBookDetailsDoc',
        documentPath: `bookDetails/${bookId}`,
        operation: 'create',
      });
    }

    return {cleanCore, cleanHeavy, bookDetailsMetadata};
  }

  static partitionUpdatePayload(
    updates: Record<string, unknown>,
    serverTimestamp?: unknown,
    options?: PartitionUpdateOptions,
  ): {
    coreUpdates: StoredBookWritePayload;
    heavyUpdates: Partial<StoredBookDetailsDoc> & Record<string, unknown>;
  } {
    const coreUpdates: StoredBookWritePayload = {};
    const heavyUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue;
      }
      if (isUnsafeFieldKey(key)) {
        continue;
      }

      if (HEAVY_FIELDS.has(key)) {
        if (key === 'description' && heavyUpdates.synopsis === undefined) {
          heavyUpdates.synopsis = value;
        } else {
          heavyUpdates[key] = value;
        }
      } else if (
        (key === 'heavyDetails' || key === 'heavyData') &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        for (const [hk, hv] of Object.entries(
          value as Record<string, unknown>,
        )) {
          if (HEAVY_FIELDS.has(hk) && !isUnsafeFieldKey(hk)) {
            if (hk === 'description' && heavyUpdates.synopsis === undefined) {
              heavyUpdates.synopsis = hv;
            } else {
              heavyUpdates[hk] = hv;
            }
          }
        }
      } else if (ALLOWED_CORE_BOOK_FIELDS.has(key)) {
        coreUpdates[key] = value;
      }
    }

    // Recompute normalized index fields when searchable/dedupe fields are updated
    if (typeof coreUpdates.isbn === 'string') {
      const cleanIsbn = normalizeIsbnForDedupe(coreUpdates.isbn);
      if (cleanIsbn) {
        coreUpdates.cleanIsbn = cleanIsbn;
      }
    }

    const hasTitleUpdate = typeof coreUpdates.title === 'string';
    const hasAuthorUpdate = typeof coreUpdates.author === 'string';
    const hasSeriesUpdate = typeof coreUpdates.series === 'string';
    const hasIsbnUpdate = typeof coreUpdates.isbn === 'string';

    const effectiveTitle = hasTitleUpdate
      ? (coreUpdates.title as string)
      : options?.existingBook?.title;
    const effectiveAuthor = hasAuthorUpdate
      ? (coreUpdates.author as string)
      : options?.existingBook?.author;
    const effectiveIsbn = hasIsbnUpdate
      ? (coreUpdates.isbn as string)
      : options?.existingBook?.isbn;
    const effectiveSeries = hasSeriesUpdate
      ? (coreUpdates.series as string)
      : options?.existingBook?.series;

    if (
      (hasTitleUpdate || hasAuthorUpdate) &&
      effectiveTitle &&
      effectiveAuthor
    ) {
      const dedupeKey = computeBookDedupeKey(effectiveTitle, effectiveAuthor);
      if (dedupeKey) {
        coreUpdates.dedupeKey = dedupeKey;
      }
    }

    if (hasTitleUpdate || hasAuthorUpdate || hasSeriesUpdate || hasIsbnUpdate) {
      if (effectiveTitle && effectiveAuthor) {
        const searchTokens = computeBookSearchTokens({
          title: effectiveTitle,
          author: effectiveAuthor,
          isbn: effectiveIsbn,
          series: effectiveSeries,
        });
        if (searchTokens.length > 0) {
          coreUpdates.searchTokens = searchTokens;
        }
      } else if (
        !hasTitleUpdate &&
        !hasAuthorUpdate &&
        (hasSeriesUpdate || hasIsbnUpdate)
      ) {
        // Additive token merge when only series or isbn is patched without baseline title/author
        const deltaTokens = computeBookSearchTokens({
          isbn: hasIsbnUpdate ? (coreUpdates.isbn as string) : undefined,
          series: hasSeriesUpdate ? (coreUpdates.series as string) : undefined,
        });
        if (deltaTokens.length > 0) {
          coreUpdates.searchTokens =
            typeof (FieldValue as {arrayUnion?: (...el: unknown[]) => unknown})
              ?.arrayUnion === 'function'
              ? FieldValue.arrayUnion(...deltaTokens)
              : deltaTokens;
        }
      } else {
        const searchTokens = computeBookSearchTokens({
          title: effectiveTitle,
          author: effectiveAuthor,
          isbn: effectiveIsbn,
          series: effectiveSeries,
        });
        if (searchTokens.length > 0) {
          coreUpdates.searchTokens = searchTokens;
        }
      }
    }

    // Per-user reading state is stored in /users/{userId}/readingStates/{stateKey}, never on books/{bookId}
    delete coreUpdates.readingStatus;

    if (Object.keys(heavyUpdates).length > 0) {
      if (
        coreUpdates.bookDetailsMetadata &&
        typeof coreUpdates.bookDetailsMetadata === 'object'
      ) {
        const meta = {
          ...(coreUpdates.bookDetailsMetadata as Record<string, unknown>),
        };
        if (heavyUpdates.synopsis !== undefined) {
          meta.hasSynopsis = Boolean(heavyUpdates.synopsis);
        }
        if (heavyUpdates.authorBio !== undefined) {
          meta.hasAuthorBio = Boolean(heavyUpdates.authorBio);
        }
        if (heavyUpdates.embedding !== undefined) {
          meta.hasEmbedding = Boolean(
            Array.isArray(heavyUpdates.embedding) &&
            heavyUpdates.embedding.length > 0,
          );
        }
        if (heavyUpdates.clusterCoordinates !== undefined) {
          meta.hasClusterCoordinates = Boolean(heavyUpdates.clusterCoordinates);
        }
        coreUpdates.bookDetailsMetadata = meta;
      } else {
        if (heavyUpdates.synopsis !== undefined) {
          coreUpdates['bookDetailsMetadata.hasSynopsis'] = Boolean(
            heavyUpdates.synopsis,
          );
        }
        if (heavyUpdates.authorBio !== undefined) {
          coreUpdates['bookDetailsMetadata.hasAuthorBio'] = Boolean(
            heavyUpdates.authorBio,
          );
        }
        if (heavyUpdates.embedding !== undefined) {
          coreUpdates['bookDetailsMetadata.hasEmbedding'] = Boolean(
            Array.isArray(heavyUpdates.embedding) &&
            heavyUpdates.embedding.length > 0,
          );
        }
        if (heavyUpdates.clusterCoordinates !== undefined) {
          coreUpdates['bookDetailsMetadata.hasClusterCoordinates'] = Boolean(
            heavyUpdates.clusterCoordinates,
          );
        }
      }
    }

    if (serverTimestamp !== undefined) {
      coreUpdates.updatedAt = serverTimestamp;
    }

    validateFirestoreWritePayload(storedBookDocSchema.partial(), coreUpdates, {
      entity: 'StoredBookDoc',
      operation: 'update',
    });
    if (Object.keys(heavyUpdates).length > 0) {
      validateFirestoreWritePayload(
        storedBookDetailsDocSchema.partial(),
        heavyUpdates,
        {
          entity: 'StoredBookDetailsDoc',
          operation: 'update',
        },
      );
    }

    return {coreUpdates, heavyUpdates};
  }

  static mergeBookAndDetails(
    bookId: string,
    bookData: Partial<StoredBookDoc> | Partial<Book>,
    heavyData?: StoredBookDetailsDoc | BookDetailsPayload,
  ): Book {
    const normalizedAddedAt =
      normalizeFirestoreTimestamp(bookData.addedAt) || new Date().toISOString();
    const normalizedUpdatedAt = normalizeFirestoreTimestamp(bookData.updatedAt);
    const hasSearchTokens =
      Boolean(bookData.hasSearchTokens) ||
      (Array.isArray(bookData.searchTokens) &&
        bookData.searchTokens.length > 0);

    const merged: Book = {
      title: bookData.title || 'Untitled Book',
      author: bookData.author || 'Unknown Author',
      addedBy: bookData.addedBy ?? null,
      ...bookData,
      addedAt: normalizedAddedAt,
      ...(normalizedUpdatedAt ? {updatedAt: normalizedUpdatedAt} : {}),
      id: bookId,
      primaryGenre: bookData.primaryGenre || undefined,
      subgenres: Array.isArray(bookData.subgenres) ? bookData.subgenres : [],
      isCustomPrimary: Boolean(bookData.isCustomPrimary),
      ...(hasSearchTokens ? {hasSearchTokens: true} : {}),
      ...(heavyData?.synopsis ? {synopsis: heavyData.synopsis} : {}),
      ...(heavyData?.authorBio ? {authorBio: heavyData.authorBio} : {}),
      ...(heavyData?.embedding ? {embedding: heavyData.embedding} : {}),
      ...(heavyData?.clusterCoordinates
        ? {clusterCoordinates: heavyData.clusterCoordinates}
        : {}),
    };

    delete merged.searchTokens;

    if (merged.temporalMetadata) {
      const cleanTemporal = sanitizeTemporalMetadata(merged.temporalMetadata);
      if (cleanTemporal) {
        merged.temporalMetadata = cleanTemporal;
      } else {
        delete merged.temporalMetadata;
      }
    }
    return merged;
  }
}
