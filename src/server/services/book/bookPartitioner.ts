import {FieldValue} from 'firebase-admin/firestore';
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
import {
  hasControlCharacters,
  isFirestoreFieldValueSentinel,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  normalizeIsbnForDedupe,
  computeBookDedupeKey,
  computeBookSearchTokens,
} from '../../../lib/duplicateDetection';
import {
  normalizeLegacyBookDetailsReadCandidate,
  normalizeLegacyBookReadCandidate,
} from './bookLegacyNormalizers';
import {
  scheduleBookDetailsSelfHeal,
  scheduleBookSelfHeal,
} from './bookLegacySelfHealer';

export interface StoredBookWritePayload extends Omit<
  Partial<StoredBookDoc>,
  | 'addedAt'
  | 'updatedAt'
  | 'searchTokens'
  | 'primaryGenreLower'
  | 'missingFlags'
> {
  addedAt?: unknown;
  updatedAt?: unknown;
  searchTokens?: string[] | unknown;
  primaryGenreLower?: string | unknown;
  missingFlags?: string[] | unknown;
  [key: string]: unknown;
}

export const HEAVY_FIELDS = new Set([
  'synopsis',
  'authorBio',
  'embedding',
  'clusterCoordinates',
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
  'primaryGenreLower',
  'missingFlags',
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

export function computePrimaryGenreLower(
  primaryGenre: unknown,
): string | undefined {
  if (typeof primaryGenre !== 'string') {
    return undefined;
  }
  const normalized = primaryGenre.trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 200) : undefined;
}

export function computeBookMissingFlags(
  core: {
    geoMetadata?: unknown;
    temporalMetadata?: unknown;
    primaryGenre?: unknown;
    coverUrl?: unknown;
    series?: unknown;
  },
  detailsMeta?: {
    hasSynopsis?: boolean;
    hasAuthorBio?: boolean;
    hasEmbedding?: boolean;
  },
): string[] {
  const flags: string[] = [];
  if (!core.geoMetadata) {
    flags.push('geo');
  }
  if (!core.temporalMetadata) {
    flags.push('temporal');
  }
  if (
    typeof core.primaryGenre !== 'string' ||
    core.primaryGenre.trim().length === 0
  ) {
    flags.push('genre');
  }
  if (!detailsMeta?.hasSynopsis) {
    flags.push('synopsis');
  }
  if (!detailsMeta?.hasAuthorBio) {
    flags.push('authorBio');
  }
  if (!detailsMeta?.hasEmbedding) {
    flags.push('embedding');
  }
  if (typeof core.coverUrl !== 'string' || core.coverUrl.trim().length === 0) {
    flags.push('coverImage');
  }
  if (typeof core.series !== 'string' || core.series.trim().length === 0) {
    flags.push('series');
  }
  return flags;
}

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
  existingBook?: Partial<StoredBookDoc>;
}

function isClearedFieldValue(value: unknown): boolean {
  return value === null || value === '' || isFirestoreFieldValueSentinel(value);
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
    const detailsHealPatch = normalizeLegacyBookDetailsReadCandidate(
      candidate,
      raw,
    );
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    const parsedDetails = validateFirestoreReadPayload(
      storedBookDetailsDocSchema,
      candidate,
      {
        entity: 'StoredBookDetailsDoc',
        documentPath,
        operation: 'read',
      },
    );
    if (detailsHealPatch) {
      scheduleBookDetailsSelfHeal(documentPath, detailsHealPatch);
    }
    return parsedDetails;
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

export interface BookConverterReadOptions {
  skipSelfHeal?: boolean;
  isPartialProjection?: boolean;
}

function isFullBookDocumentSnapshot(
  raw: Record<string, unknown>,
  options?: BookConverterReadOptions,
): boolean {
  if (options?.isPartialProjection) {
    return false;
  }
  return (
    'addedAt' in raw ||
    'addedBy' in raw ||
    'format' in raw ||
    'enrichmentStatus' in raw ||
    'bookDetailsMetadata' in raw ||
    'missingFlags' in raw
  );
}

function augmentBookReadCandidateWithMissingIndexes(
  candidate: Record<string, unknown>,
  raw: Record<string, unknown>,
  existingPlan: ReturnType<typeof normalizeLegacyBookReadCandidate>,
  options?: BookConverterReadOptions,
): ReturnType<typeof normalizeLegacyBookReadCandidate> {
  const indexPatch: Record<string, unknown> = {};
  const isFullSnapshot = isFullBookDocumentSnapshot(raw, options);

  if (typeof candidate.isbn === 'string' && candidate.isbn.trim().length > 0) {
    const expectedCleanIsbn = normalizeIsbnForDedupe(candidate.isbn);
    if (expectedCleanIsbn && candidate.cleanIsbn !== expectedCleanIsbn) {
      candidate.cleanIsbn = expectedCleanIsbn;
      indexPatch.cleanIsbn = expectedCleanIsbn;
    }
  }

  const hasExplicitTitleAndAuthor =
    typeof raw.title === 'string' &&
    raw.title.trim().length > 0 &&
    typeof raw.author === 'string' &&
    raw.author.trim().length > 0;
  if (
    hasExplicitTitleAndAuthor &&
    (typeof candidate.dedupeKey !== 'string' ||
      candidate.dedupeKey.trim().length === 0)
  ) {
    const expectedDedupeKey = computeBookDedupeKey(
      String(candidate.title),
      String(candidate.author),
    );
    if (expectedDedupeKey) {
      candidate.dedupeKey = expectedDedupeKey;
      indexPatch.dedupeKey = expectedDedupeKey;
    }
  }

  if (typeof candidate.primaryGenre === 'string') {
    const expectedGenreLower = computePrimaryGenreLower(candidate.primaryGenre);
    if (
      expectedGenreLower &&
      candidate.primaryGenreLower !== expectedGenreLower
    ) {
      candidate.primaryGenreLower = expectedGenreLower;
      indexPatch.primaryGenreLower = expectedGenreLower;
    }
  }

  if (isFullSnapshot) {
    if (
      !Array.isArray(candidate.searchTokens) ||
      candidate.searchTokens.length === 0
    ) {
      const computedTokens = computeBookSearchTokens({
        title: String(candidate.title || ''),
        author: String(candidate.author || ''),
        isbn: typeof candidate.isbn === 'string' ? candidate.isbn : undefined,
        series:
          typeof candidate.series === 'string' ? candidate.series : undefined,
      });
      if (computedTokens.length > 0) {
        candidate.searchTokens = computedTokens;
        indexPatch.searchTokens = computedTokens;
      }
    }

    if (!Array.isArray(candidate.missingFlags)) {
      const detailsMeta =
        candidate.bookDetailsMetadata &&
        typeof candidate.bookDetailsMetadata === 'object' &&
        !Array.isArray(candidate.bookDetailsMetadata)
          ? (candidate.bookDetailsMetadata as BookDetailsMetadata)
          : undefined;
      const computedFlags = computeBookMissingFlags(
        {
          geoMetadata: candidate.geoMetadata,
          temporalMetadata: candidate.temporalMetadata,
          primaryGenre: candidate.primaryGenre,
          coverUrl: candidate.coverUrl,
          series: candidate.series,
        },
        detailsMeta,
      );
      candidate.missingFlags = computedFlags;
      indexPatch.missingFlags = computedFlags;
    }
  }

  if (Object.keys(indexPatch).length === 0) {
    return existingPlan;
  }

  if (existingPlan) {
    return {
      bookPatch: {
        ...existingPlan.bookPatch,
        ...indexPatch,
      },
      rescuedHeavy: existingPlan.rescuedHeavy,
    };
  }

  return {
    bookPatch: indexPatch,
  };
}

/**
 * Typed Firestore converter for `/libraries/{libraryId}/books/{bookId}`.
 */
export const bookDocConverter = {
  fromFirestore(
    bookId: string,
    raw: Record<string, unknown>,
    documentPath = `books/${bookId}`,
    options?: BookConverterReadOptions,
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
    const baseHealPlan = normalizeLegacyBookReadCandidate(candidate, raw);
    const healPlan = augmentBookReadCandidateWithMissingIndexes(
      candidate,
      raw,
      baseHealPlan,
      options,
    );
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    const parsedBook = validateFirestoreReadPayload(
      storedBookDocSchema,
      candidate,
      {
        entity: 'StoredBookDoc',
        documentPath,
        operation: 'read',
      },
    );
    if (healPlan && !options?.skipSelfHeal) {
      scheduleBookSelfHeal(documentPath, healPlan);
    }
    return parsedBook;
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

    const heavyData: Record<string, unknown> = {};
    if (input.synopsis !== undefined && input.synopsis !== null) {
      heavyData.synopsis = input.synopsis;
    }
    if (input.authorBio !== undefined && input.authorBio !== null) {
      heavyData.authorBio = input.authorBio;
    }
    if (input.embedding !== undefined && input.embedding !== null) {
      heavyData.embedding = input.embedding;
    }
    if (
      input.clusterCoordinates !== undefined &&
      input.clusterCoordinates !== null
    ) {
      heavyData.clusterCoordinates = input.clusterCoordinates;
    }

    const cleanHeavy = Object.fromEntries(
      Object.entries(heavyData).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
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
    const computedPrimaryGenreLower = computePrimaryGenreLower(
      rawInput.primaryGenre,
    );
    const computedMissingFlags = computeBookMissingFlags(
      {
        geoMetadata: rawInput.geoMetadata,
        temporalMetadata: rawInput.temporalMetadata,
        primaryGenre: rawInput.primaryGenre,
        coverUrl: rawInput.coverUrl,
        series: rawInput.series,
      },
      bookDetailsMetadata,
    );

    const coreData: Record<string, unknown> = {
      ...rawInput,
      id: bookId,
      title: input.title,
      author: authorStr,
      format: input.format || 'physical',
      ...(computedCleanIsbn ? {cleanIsbn: computedCleanIsbn} : {}),
      ...(computedDedupeKey ? {dedupeKey: computedDedupeKey} : {}),
      ...(computedSearchTokens.length > 0
        ? {searchTokens: computedSearchTokens}
        : {}),
      ...(computedPrimaryGenreLower
        ? {primaryGenreLower: computedPrimaryGenreLower}
        : {}),
      missingFlags: computedMissingFlags,
      addedBy: userId || null,
      addedAt: serverTimestamp,
      updatedAt: serverTimestamp,
      bookDetailsMetadata,
    };

    if (!computedPrimaryGenreLower) {
      delete coreData.primaryGenreLower;
    }

    HEAVY_FIELDS.forEach(f => {
      delete coreData[f];
    });

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
        heavyUpdates[key] = value;
      } else if (ALLOWED_CORE_BOOK_FIELDS.has(key)) {
        coreUpdates[key] = value;
      }
    }

    if (typeof coreUpdates.isbn === 'string') {
      const cleanIsbn = normalizeIsbnForDedupe(coreUpdates.isbn);
      if (cleanIsbn) {
        coreUpdates.cleanIsbn = cleanIsbn;
      }
    }

    if ('primaryGenre' in coreUpdates) {
      const lowerGenre = computePrimaryGenreLower(coreUpdates.primaryGenre);
      coreUpdates.primaryGenreLower = lowerGenre ?? FieldValue.delete();
    } else if (
      options?.existingBook?.primaryGenre &&
      options.existingBook.primaryGenreLower === undefined
    ) {
      const backfilledLower = computePrimaryGenreLower(
        options.existingBook.primaryGenre,
      );
      if (backfilledLower) {
        coreUpdates.primaryGenreLower = backfilledLower;
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
      : (options?.existingBook?.series ?? undefined);

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
        const deltaTokens = computeBookSearchTokens({
          isbn: hasIsbnUpdate ? coreUpdates.isbn : undefined,
          series: hasSeriesUpdate ? (coreUpdates.series as string) : undefined,
        });
        if (deltaTokens.length > 0) {
          coreUpdates.searchTokens = FieldValue.arrayUnion(...deltaTokens);
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

    delete coreUpdates.readingStatus;

    const explicitMetaPatch: Partial<BookDetailsMetadata> = {};
    if (
      coreUpdates.bookDetailsMetadata &&
      typeof coreUpdates.bookDetailsMetadata === 'object'
    ) {
      const explicitMeta = coreUpdates.bookDetailsMetadata as Record<
        string,
        unknown
      >;
      for (const [metaKey, metaVal] of Object.entries(explicitMeta)) {
        if (typeof metaVal === 'boolean') {
          coreUpdates[`bookDetailsMetadata.${metaKey}`] = metaVal;
          explicitMetaPatch[metaKey as keyof BookDetailsMetadata] = metaVal;
        }
      }
      delete coreUpdates.bookDetailsMetadata;
    }

    if (Object.keys(heavyUpdates).length > 0) {
      if (heavyUpdates.synopsis !== undefined) {
        const hasSyn = Boolean(heavyUpdates.synopsis);
        coreUpdates['bookDetailsMetadata.hasSynopsis'] = hasSyn;
        explicitMetaPatch.hasSynopsis = hasSyn;
      }
      if (heavyUpdates.authorBio !== undefined) {
        const hasBio = Boolean(heavyUpdates.authorBio);
        coreUpdates['bookDetailsMetadata.hasAuthorBio'] = hasBio;
        explicitMetaPatch.hasAuthorBio = hasBio;
      }
      if (heavyUpdates.embedding !== undefined) {
        const hasEmb = Boolean(
          Array.isArray(heavyUpdates.embedding) &&
          heavyUpdates.embedding.length > 0,
        );
        coreUpdates['bookDetailsMetadata.hasEmbedding'] = hasEmb;
        explicitMetaPatch.hasEmbedding = hasEmb;
      }
      if (heavyUpdates.clusterCoordinates !== undefined) {
        const hasCoords = Boolean(heavyUpdates.clusterCoordinates);
        coreUpdates['bookDetailsMetadata.hasClusterCoordinates'] = hasCoords;
        explicitMetaPatch.hasClusterCoordinates = hasCoords;
      }
    }

    const existingFull = options?.existingBook;
    const hasFullExistingContext = Boolean(
      existingFull &&
      ('id' in existingFull ||
        'bookDetailsMetadata' in existingFull ||
        'missingFlags' in existingFull),
    );
    if (hasFullExistingContext && existingFull) {
      const effectiveGeo =
        'geoMetadata' in coreUpdates
          ? isClearedFieldValue(coreUpdates.geoMetadata)
            ? undefined
            : coreUpdates.geoMetadata
          : existingFull.geoMetadata;
      const effectiveTemporal =
        'temporalMetadata' in coreUpdates
          ? isClearedFieldValue(coreUpdates.temporalMetadata)
            ? undefined
            : coreUpdates.temporalMetadata
          : existingFull.temporalMetadata;
      const effectiveGenre =
        'primaryGenre' in coreUpdates
          ? isClearedFieldValue(coreUpdates.primaryGenre)
            ? undefined
            : coreUpdates.primaryGenre
          : existingFull.primaryGenre;
      const effectiveCover =
        'coverUrl' in coreUpdates
          ? isClearedFieldValue(coreUpdates.coverUrl)
            ? undefined
            : coreUpdates.coverUrl
          : existingFull.coverUrl;
      const effectiveSeriesVal =
        'series' in coreUpdates
          ? isClearedFieldValue(coreUpdates.series)
            ? undefined
            : coreUpdates.series
          : existingFull.series;
      const effectiveDetailsMeta: BookDetailsMetadata = {
        ...(existingFull.bookDetailsMetadata || {}),
        ...explicitMetaPatch,
      };
      coreUpdates.missingFlags = computeBookMissingFlags(
        {
          geoMetadata: effectiveGeo,
          temporalMetadata: effectiveTemporal,
          primaryGenre: effectiveGenre,
          coverUrl: effectiveCover,
          series: effectiveSeriesVal,
        },
        effectiveDetailsMeta,
      );
    } else if (coreUpdates.missingFlags === undefined) {
      const satisfiedFlags: string[] = [];
      if (
        'geoMetadata' in coreUpdates &&
        !isClearedFieldValue(coreUpdates.geoMetadata)
      ) {
        satisfiedFlags.push('geo');
      }
      if (
        'temporalMetadata' in coreUpdates &&
        !isClearedFieldValue(coreUpdates.temporalMetadata)
      ) {
        satisfiedFlags.push('temporal');
      }
      if (
        'primaryGenre' in coreUpdates &&
        typeof coreUpdates.primaryGenre === 'string' &&
        coreUpdates.primaryGenre.trim().length > 0
      ) {
        satisfiedFlags.push('genre');
      }
      if (
        'coverUrl' in coreUpdates &&
        typeof coreUpdates.coverUrl === 'string' &&
        coreUpdates.coverUrl.trim().length > 0
      ) {
        satisfiedFlags.push('coverImage');
      }
      if (
        'series' in coreUpdates &&
        typeof coreUpdates.series === 'string' &&
        coreUpdates.series.trim().length > 0
      ) {
        satisfiedFlags.push('series');
      }
      if (explicitMetaPatch.hasSynopsis === true) {
        satisfiedFlags.push('synopsis');
      }
      if (explicitMetaPatch.hasAuthorBio === true) {
        satisfiedFlags.push('authorBio');
      }
      if (explicitMetaPatch.hasEmbedding === true) {
        satisfiedFlags.push('embedding');
      }
      if (satisfiedFlags.length > 0) {
        coreUpdates.missingFlags = FieldValue.arrayRemove(...satisfiedFlags);
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
      ('hasSearchTokens' in bookData && Boolean(bookData.hasSearchTokens)) ||
      (Array.isArray(bookData.searchTokens) &&
        bookData.searchTokens.length > 0);
    const baseFields = bookData as Partial<Book>;

    const merged: Book = {
      ...baseFields,
      title: bookData.title || 'Untitled Book',
      author: bookData.author || 'Unknown Author',
      addedBy: bookData.addedBy ?? null,
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
