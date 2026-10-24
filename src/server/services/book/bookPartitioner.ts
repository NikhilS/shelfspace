import type {
  Book,
  BookDetailsMetadata,
  BookDetailsPayload,
  BookTemporalMetadata,
  UserStatuses,
} from '../../../types';

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
  'userStatuses',
  'userRatings',
  'status',
  'geoMetadata',
  'temporalMetadata',
  'enrichmentStatus',
  'bookDetailsMetadata',
  'coverCandidates',
  'sources',
  'fieldSources',
  'skippedProviders',
]);

import {hasControlCharacters} from '../../../schemas/common';
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
 * Converts a Firestore Timestamp, Date, or string into an ISO-8601 string.
 */
export function normalizeFirestoreTimestamp(val: unknown): string | undefined {
  if (!val) {
    return undefined;
  }
  if (typeof val === 'string') {
    return val;
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
  if (copy.startYear !== undefined && copy.endYear === undefined) {
    copy.endYear = copy.startYear;
  }
  const start = copy.startYear;
  const end = copy.endYear;
  if (
    (start !== undefined && (start < -10000 || start > 2100)) ||
    (end !== undefined && (end < -10000 || end > 2100))
  ) {
    return undefined;
  }
  return copy;
}

export interface PartitionUpdateOptions {
  callerUserId?: string;
  allowFullUserStatuses?: boolean;
}

/**
 * Authoritative partitioner that splits a raw book payload into lightweight core catalog
 * fields (`books/{id}`) and heavy prose/vector fields (`bookDetails/{id}`), while
 * computing `bookDetailsMetadata` presence flags and enforcing field-level security.
 */
export class BookPartitioner {
  static partitionCreatePayload(
    input: Record<string, unknown>,
    bookId: string,
    userId?: string,
    serverTimestamp?: unknown,
  ): {
    cleanCore: Record<string, unknown>;
    cleanHeavy: BookDetailsPayload;
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

    // Scope reading status strictly to the authenticated caller's UID
    delete rawInput.status;
    delete rawInput.userStatuses;
    if (userId) {
      const explicitStatus = input.status as UserStatuses[string] | undefined;
      const mapStatus =
        input.userStatuses &&
        typeof input.userStatuses === 'object' &&
        !Array.isArray(input.userStatuses)
          ? (input.userStatuses as Record<string, UserStatuses[string]>)[userId]
          : undefined;
      const callerStatus = explicitStatus || mapStatus;
      if (callerStatus) {
        rawInput.userStatuses = {
          [userId]: callerStatus,
        };
      }
    }

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
    );

    return {cleanCore, cleanHeavy, bookDetailsMetadata};
  }

  static partitionUpdatePayload(
    updates: Record<string, unknown>,
    serverTimestamp?: unknown,
    options?: PartitionUpdateOptions,
  ): {
    coreUpdates: Record<string, unknown>;
    heavyUpdates: Record<string, unknown>;
  } {
    const coreUpdates: Record<string, unknown> = {};
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

    if (hasTitleUpdate && hasAuthorUpdate) {
      const dedupeKey = computeBookDedupeKey(
        coreUpdates.title as string,
        coreUpdates.author as string,
      );
      if (dedupeKey) {
        coreUpdates.dedupeKey = dedupeKey;
      }
    }

    if (hasTitleUpdate || hasAuthorUpdate || hasSeriesUpdate || hasIsbnUpdate) {
      const searchTokens = computeBookSearchTokens({
        title: hasTitleUpdate ? (coreUpdates.title as string) : undefined,
        author: hasAuthorUpdate ? (coreUpdates.author as string) : undefined,
        isbn: hasIsbnUpdate ? (coreUpdates.isbn as string) : undefined,
        series: hasSeriesUpdate ? (coreUpdates.series as string) : undefined,
      });
      if (searchTokens.length > 0) {
        coreUpdates.searchTokens = searchTokens;
      }
    }

    // Enforce caller-scoped reading status writes unless explicitly trusted (e.g. duplicate merge union)
    if (!options?.allowFullUserStatuses) {
      const callerUid = options?.callerUserId;
      const rawStatus = coreUpdates.status as string | undefined;
      const rawUserStatuses =
        coreUpdates.userStatuses &&
        typeof coreUpdates.userStatuses === 'object' &&
        !Array.isArray(coreUpdates.userStatuses)
          ? (coreUpdates.userStatuses as Record<string, string>)
          : undefined;

      delete coreUpdates.status;
      delete coreUpdates.userStatuses;

      if (callerUid) {
        const callerStatus =
          rawStatus ??
          (rawUserStatuses ? rawUserStatuses[callerUid] : undefined);
        if (callerStatus) {
          coreUpdates[`userStatuses.${callerUid}`] = callerStatus;
        }
      }
    }

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

    return {coreUpdates, heavyUpdates};
  }

  static mergeBookAndDetails(
    bookId: string,
    bookData: Partial<Book>,
    heavyData?: BookDetailsPayload,
  ): Book {
    const normalizedAddedAt =
      normalizeFirestoreTimestamp(bookData.addedAt) || new Date().toISOString();
    const normalizedUpdatedAt = normalizeFirestoreTimestamp(bookData.updatedAt);

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
      ...(heavyData?.synopsis ? {synopsis: heavyData.synopsis} : {}),
      ...(heavyData?.authorBio ? {authorBio: heavyData.authorBio} : {}),
      ...(heavyData?.embedding ? {embedding: heavyData.embedding} : {}),
      ...(heavyData?.clusterCoordinates
        ? {clusterCoordinates: heavyData.clusterCoordinates}
        : {}),
    };

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
