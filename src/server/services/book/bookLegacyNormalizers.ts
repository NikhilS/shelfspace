import {FieldValue} from 'firebase-admin/firestore';
import type {BookDetailsPayload} from '../../../types';

const DEPRECATED_ROOT_BOOK_KEYS = new Set([
  'genres',
  'genre',
  'categories',
  'synopsis',
  'description',
  'summary',
  'authorBio',
  'embedding',
  'clusterCoordinates',
  'readingStatus',
  'status',
  'rating',
  'userRating',
  'userStatuses',
  'userRatings',
  'reviews',
  'notes',
  'reviewText',
  'reviewedAt',
  'startedAt',
  'finishedAt',
  'readStatusReviewedAt',
  'pageCount',
  'publisher',
  'language',
  'tags',
  'customGenres',
  'subtitle',
  'edition',
  'seriesIndex',
  'seriesNumber',
  'seriesName',
  'bookId',
  'libraryId',
  'libraryName',
  'isVirtual',
  'createdAt',
  'hasSearchTokens',
  'googleBooksId',
  'openLibraryId',
  'goodreadsId',
  'asin',
  'averageRating',
  'ratingsCount',
]);

const NON_NULLABLE_OPTIONAL_BOOK_KEYS = new Set([
  'isbn',
  'cleanIsbn',
  'dedupeKey',
  'searchTokens',
  'coverUrl',
  'coverUrlRaw',
  'publishedDate',
  'primaryGenreLower',
  'missingFlags',
  'subgenres',
  'isCustomPrimary',
  'format',
  'ownershipStatus',
  'enrichmentStatus',
  'bookDetailsMetadata',
  'coverCandidates',
  'sources',
  'fieldSources',
  'skippedProviders',
  'addedAt',
  'updatedAt',
]);

const DEPRECATED_BOOK_DETAILS_KEYS = new Set([
  'description',
  'summary',
  'id',
  'bookId',
  'libraryId',
  'createdAt',
]);

const VALID_ENRICHMENT_STATUS_VALUES = new Set([
  'completed',
  'unsupported',
  'failed',
  'pending',
  'in_progress',
  'processing',
  'skipped',
]);

const CANONICAL_ENRICHMENT_KEYS = new Set([
  'geo',
  'temporal',
  'genre',
  'synopsis',
  'authorBio',
  'coverImage',
  'series',
  'embedding',
]);

function coerceIsoTimestamp(val: unknown): string | undefined {
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

function normalizeLegacyGeoAdminLevel(
  rawLevel: string,
): 'city' | 'state' | 'country' | 'region' | undefined {
  const clean = rawLevel.trim().toLowerCase();
  if (
    clean === 'city' ||
    clean === 'town' ||
    clean === 'village' ||
    clean === 'municipality'
  ) {
    return 'city';
  }
  if (
    clean === 'state' ||
    clean === 'province' ||
    clean === 'prefecture' ||
    clean === 'county'
  ) {
    return 'state';
  }
  if (clean === 'country' || clean === 'nation') {
    return 'country';
  }
  if (
    clean === 'region' ||
    clean === 'continent' ||
    clean === 'island' ||
    clean === 'ocean' ||
    clean === 'sea' ||
    clean === 'area' ||
    clean === 'territory' ||
    clean === 'other'
  ) {
    return 'region';
  }
  return undefined;
}

function normalizeLegacyTemporalField(rawTemporal: unknown): {
  value: unknown;
  mutated: boolean;
} {
  if (
    rawTemporal === null ||
    rawTemporal === undefined ||
    typeof rawTemporal !== 'object' ||
    Array.isArray(rawTemporal)
  ) {
    return {value: rawTemporal, mutated: false};
  }

  const out: Record<string, unknown> = {
    ...(rawTemporal as Record<string, unknown>),
  };
  let mutated = false;

  for (const alias of [
    'eraLabel',
    'era',
    'historicalPeriod',
    'period',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(out, alias)) {
      const aliasVal = out[alias];
      if (
        (out.eraName === undefined || out.eraName === null) &&
        typeof aliasVal === 'string' &&
        aliasVal.trim().length > 0
      ) {
        out.eraName = aliasVal.trim().slice(0, 300);
      }
      delete out[alias];
      mutated = true;
    }
  }

  for (const alias of ['enrichedAt', 'updatedAt', 'syncedAt'] as const) {
    if (Object.prototype.hasOwnProperty.call(out, alias)) {
      const ts = coerceIsoTimestamp(out[alias]);
      if ((out.lastSyncedAt === undefined || out.lastSyncedAt === null) && ts) {
        out.lastSyncedAt = ts;
      }
      delete out[alias];
      mutated = true;
    }
  }

  if (
    out.lastSyncedAt !== undefined &&
    out.lastSyncedAt !== null &&
    typeof out.lastSyncedAt !== 'string'
  ) {
    const normalizedTs = coerceIsoTimestamp(out.lastSyncedAt);
    if (normalizedTs) {
      out.lastSyncedAt = normalizedTs;
      mutated = true;
    }
  }

  for (const dropKey of [
    'confidence',
    'source',
    'century',
    'decade',
    'notes',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(out, dropKey)) {
      delete out[dropKey];
      mutated = true;
    }
  }

  if (out.isNonHistorical === null) {
    delete out.isNonHistorical;
    mutated = true;
  }

  for (const k of Object.keys(out)) {
    if (out[k] === undefined) {
      delete out[k];
    }
  }

  return {value: out, mutated};
}

function normalizeLegacyGeoField(rawGeo: unknown): {
  value: unknown;
  mutated: boolean;
} {
  if (
    rawGeo === null ||
    rawGeo === undefined ||
    typeof rawGeo !== 'object' ||
    Array.isArray(rawGeo)
  ) {
    return {value: rawGeo, mutated: false};
  }

  const out: Record<string, unknown> = {...(rawGeo as Record<string, unknown>)};
  let mutated = false;

  if (Object.prototype.hasOwnProperty.call(out, 'isFictional')) {
    if (out.isNonEarth === undefined && typeof out.isFictional === 'boolean') {
      out.isNonEarth = out.isFictional;
    }
    delete out.isFictional;
    mutated = true;
  }

  for (const alias of ['enrichedAt', 'updatedAt', 'syncedAt'] as const) {
    if (Object.prototype.hasOwnProperty.call(out, alias)) {
      const ts = coerceIsoTimestamp(out[alias]);
      if (out.lastSyncedAt === undefined && ts) {
        out.lastSyncedAt = ts;
      }
      delete out[alias];
      mutated = true;
    }
  }

  if (out.lastSyncedAt === null) {
    delete out.lastSyncedAt;
    mutated = true;
  } else if (
    out.lastSyncedAt !== undefined &&
    typeof out.lastSyncedAt !== 'string'
  ) {
    const normalizedTs = coerceIsoTimestamp(out.lastSyncedAt);
    if (normalizedTs) {
      out.lastSyncedAt = normalizedTs;
      mutated = true;
    }
  }

  if (out.isNonEarth === null) {
    delete out.isNonEarth;
    mutated = true;
  }

  for (const dropKey of [
    'primaryLocation',
    'confidence',
    'source',
    'rationale',
    'notes',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(out, dropKey)) {
      delete out[dropKey];
      mutated = true;
    }
  }

  if (Array.isArray(out.locations)) {
    const nextLocations: unknown[] = [];
    for (const rawLoc of out.locations.slice(0, 50)) {
      if (!rawLoc || typeof rawLoc !== 'object' || Array.isArray(rawLoc)) {
        nextLocations.push(rawLoc);
        continue;
      }
      const locObj: Record<string, unknown> = {
        ...(rawLoc as Record<string, unknown>),
      };

      if (typeof locObj.adminLevel === 'string') {
        const canonicalLevel = normalizeLegacyGeoAdminLevel(locObj.adminLevel);
        if (canonicalLevel !== locObj.adminLevel) {
          if (canonicalLevel) {
            locObj.adminLevel = canonicalLevel;
          } else {
            delete locObj.adminLevel;
          }
          mutated = true;
        }
      } else if (locObj.adminLevel === null) {
        delete locObj.adminLevel;
        mutated = true;
      }

      const hasFlatCoords =
        Object.prototype.hasOwnProperty.call(locObj, 'lat') ||
        Object.prototype.hasOwnProperty.call(locObj, 'lng') ||
        Object.prototype.hasOwnProperty.call(locObj, 'latitude') ||
        Object.prototype.hasOwnProperty.call(locObj, 'longitude');

      if (hasFlatCoords) {
        const rawLat =
          typeof locObj.lat === 'number'
            ? locObj.lat
            : typeof locObj.latitude === 'number'
              ? locObj.latitude
              : undefined;
        const rawLng =
          typeof locObj.lng === 'number'
            ? locObj.lng
            : typeof locObj.longitude === 'number'
              ? locObj.longitude
              : undefined;
        if (
          !locObj.coordinates &&
          rawLat !== undefined &&
          rawLng !== undefined &&
          Number.isFinite(rawLat) &&
          Number.isFinite(rawLng) &&
          rawLat >= -90 &&
          rawLat <= 90 &&
          rawLng >= -180 &&
          rawLng <= 180
        ) {
          locObj.coordinates = {lat: rawLat, lng: rawLng};
        }
        delete locObj.lat;
        delete locObj.lng;
        delete locObj.latitude;
        delete locObj.longitude;
        mutated = true;
      }

      if (locObj.coordinates === null) {
        delete locObj.coordinates;
        mutated = true;
      }
      if (locObj.rationale === null) {
        delete locObj.rationale;
        mutated = true;
      }

      for (const dropKey of [
        'country',
        'countryCode',
        'confidence',
        'type',
        'role',
        'placeId',
        'formattedAddress',
        'importance',
        'isPrimary',
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(locObj, dropKey)) {
          delete locObj[dropKey];
          mutated = true;
        }
      }

      for (const k of Object.keys(locObj)) {
        if (locObj[k] === undefined) {
          delete locObj[k];
        }
      }
      nextLocations.push(locObj);
    }
    out.locations = nextLocations;
  }

  for (const k of Object.keys(out)) {
    if (out[k] === undefined) {
      delete out[k];
    }
  }

  return {value: out, mutated};
}

function normalizeEnrichmentStatusValue(val: unknown): string | undefined {
  if (typeof val !== 'string') {
    return undefined;
  }
  const clean = val.trim().toLowerCase();
  if (VALID_ENRICHMENT_STATUS_VALUES.has(clean)) {
    return clean;
  }
  if (clean === 'done' || clean === 'complete' || clean === 'success') {
    return 'completed';
  }
  if (clean === 'error') {
    return 'failed';
  }
  if (clean === 'none' || clean === 'not_applicable' || clean === 'n/a') {
    return 'unsupported';
  }
  return val;
}

function normalizeLegacyEnrichmentStatusField(rawStatus: unknown): {
  value: unknown;
  mutated: boolean;
} {
  if (
    rawStatus === null ||
    rawStatus === undefined ||
    typeof rawStatus !== 'object' ||
    Array.isArray(rawStatus)
  ) {
    return {value: rawStatus, mutated: false};
  }

  const out: Record<string, unknown> = {
    ...(rawStatus as Record<string, unknown>),
  };
  let mutated = false;

  const keyAliases: Array<[string, string | null]> = [
    ['author_bio', 'authorBio'],
    ['cover_image', 'coverImage'],
    ['cover', 'coverImage'],
    ['description', 'synopsis'],
    ['basic_info', null],
    ['basicInfo', null],
  ];

  for (const [legacyKey, canonicalKey] of keyAliases) {
    if (Object.prototype.hasOwnProperty.call(out, legacyKey)) {
      if (canonicalKey && out[canonicalKey] === undefined) {
        out[canonicalKey] = out[legacyKey];
      }
      delete out[legacyKey];
      mutated = true;
    }
  }

  for (const tsAlias of ['updatedAt', 'lastEnrichedAt', 'syncedAt'] as const) {
    if (Object.prototype.hasOwnProperty.call(out, tsAlias)) {
      const ts = coerceIsoTimestamp(out[tsAlias]);
      if (out.lastAttemptedAt === undefined && ts) {
        out.lastAttemptedAt = ts;
      }
      delete out[tsAlias];
      mutated = true;
    }
  }

  if (out.lastAttemptedAt === null) {
    delete out.lastAttemptedAt;
    mutated = true;
  } else if (
    out.lastAttemptedAt !== undefined &&
    typeof out.lastAttemptedAt !== 'string'
  ) {
    const ts = coerceIsoTimestamp(out.lastAttemptedAt);
    if (ts) {
      out.lastAttemptedAt = ts;
      mutated = true;
    }
  }

  for (const key of CANONICAL_ENRICHMENT_KEYS) {
    if (out[key] === null) {
      delete out[key];
      mutated = true;
    } else if (out[key] !== undefined) {
      const normalized = normalizeEnrichmentStatusValue(out[key]);
      if (normalized !== out[key]) {
        if (normalized === undefined) {
          delete out[key];
        } else {
          out[key] = normalized;
        }
        mutated = true;
      }
    }
  }

  for (const k of Object.keys(out)) {
    if (out[k] === undefined) {
      delete out[k];
    }
  }

  return {value: out, mutated};
}

function normalizeLegacyClusterCoordinates(rawCoords: unknown): {
  value: unknown;
  mutated: boolean;
} {
  if (
    rawCoords === null ||
    rawCoords === undefined ||
    typeof rawCoords !== 'object' ||
    Array.isArray(rawCoords)
  ) {
    return {value: rawCoords, mutated: false};
  }
  const out: Record<string, unknown> = {
    ...(rawCoords as Record<string, unknown>),
  };
  let mutated = false;
  if (Object.prototype.hasOwnProperty.call(out, 'label')) {
    if (out.clusterName === undefined && typeof out.label === 'string') {
      out.clusterName = out.label.slice(0, 200);
    }
    delete out.label;
    mutated = true;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'description')) {
    if (
      out.clusterThesis === undefined &&
      typeof out.description === 'string'
    ) {
      out.clusterThesis = out.description.slice(0, 600);
    }
    delete out.description;
    mutated = true;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'z')) {
    delete out.z;
    mutated = true;
  }
  for (const nullOpt of [
    'clusterId',
    'clusterName',
    'clusterThesis',
  ] as const) {
    if (out[nullOpt] === null) {
      delete out[nullOpt];
      mutated = true;
    }
  }
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) {
      delete out[k];
    }
  }
  return {value: out, mutated};
}

/**
 * Extracts heavy prose or vector fields (`synopsis`, `authorBio`, `embedding`, `clusterCoordinates`)
 * embedded on a pre-partition `/books/{bookId}` document so `getBook` can return them immediately
 * and the background self-healer can persist them into `/bookDetails/{bookId}`.
 */
export function extractRescuedLegacyBookDetails(
  raw: Record<string, unknown>,
): BookDetailsPayload {
  const rescued: BookDetailsPayload = {};
  const rawSynopsis =
    typeof raw.synopsis === 'string' && raw.synopsis.trim().length > 0
      ? raw.synopsis
      : typeof raw.description === 'string' && raw.description.trim().length > 0
        ? raw.description
        : typeof raw.summary === 'string' && raw.summary.trim().length > 0
          ? raw.summary
          : undefined;

  if (rawSynopsis) {
    rescued.synopsis = rawSynopsis.slice(0, 50000);
  }
  if (typeof raw.authorBio === 'string' && raw.authorBio.trim().length > 0) {
    rescued.authorBio = raw.authorBio.slice(0, 50000);
  }
  if (
    Array.isArray(raw.embedding) &&
    raw.embedding.length > 0 &&
    raw.embedding.every(n => typeof n === 'number' && Number.isFinite(n))
  ) {
    rescued.embedding = (raw.embedding as number[]).slice(0, 4096);
  }
  if (
    raw.clusterCoordinates &&
    typeof raw.clusterCoordinates === 'object' &&
    !Array.isArray(raw.clusterCoordinates)
  ) {
    const normalizedCoords = normalizeLegacyClusterCoordinates(
      raw.clusterCoordinates,
    ).value as Record<string, unknown>;
    if (
      typeof normalizedCoords.x === 'number' &&
      typeof normalizedCoords.y === 'number'
    ) {
      rescued.clusterCoordinates =
        normalizedCoords as BookDetailsPayload['clusterCoordinates'];
    }
  }
  return rescued;
}

export interface BookSelfHealPlan {
  bookPatch: Record<string, unknown>;
  rescuedHeavy?: BookDetailsPayload;
}

export function normalizeLegacyBookReadCandidate(
  candidate: Record<string, unknown>,
  raw: Record<string, unknown>,
): BookSelfHealPlan | null {
  const bookPatch: Record<string, unknown> = {};
  let hasChanges = false;

  const rescuedHeavy = extractRescuedLegacyBookDetails(raw);
  const hasRescuedHeavy = Object.keys(rescuedHeavy).length > 0;

  if (Array.isArray(raw.genres)) {
    const cleanGenres = raw.genres
      .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
      .map(g => g.trim().slice(0, 200));
    if (
      (typeof candidate.primaryGenre !== 'string' ||
        candidate.primaryGenre.trim().length === 0) &&
      cleanGenres.length > 0
    ) {
      candidate.primaryGenre = cleanGenres[0];
      candidate.primaryGenreLower = cleanGenres[0].toLowerCase();
      bookPatch.primaryGenre = candidate.primaryGenre;
      bookPatch.primaryGenreLower = candidate.primaryGenreLower;
    }
    if (
      (!Array.isArray(candidate.subgenres) ||
        candidate.subgenres.length === 0) &&
      cleanGenres.length > 1
    ) {
      candidate.subgenres = cleanGenres.slice(1, 51);
      bookPatch.subgenres = candidate.subgenres;
    }
  } else if (
    (typeof candidate.primaryGenre !== 'string' ||
      candidate.primaryGenre.trim().length === 0) &&
    typeof raw.genre === 'string' &&
    raw.genre.trim().length > 0
  ) {
    candidate.primaryGenre = raw.genre.trim().slice(0, 200);
    candidate.primaryGenreLower = (
      candidate.primaryGenre as string
    ).toLowerCase();
    bookPatch.primaryGenre = candidate.primaryGenre;
    bookPatch.primaryGenreLower = candidate.primaryGenreLower;
  }

  if (
    (typeof candidate.series !== 'string' ||
      candidate.series.trim().length === 0) &&
    typeof raw.seriesName === 'string' &&
    raw.seriesName.trim().length > 0
  ) {
    candidate.series = raw.seriesName.trim().slice(0, 300);
    bookPatch.series = candidate.series;
  }

  for (const deprecatedKey of DEPRECATED_ROOT_BOOK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, deprecatedKey)) {
      delete candidate[deprecatedKey];
      bookPatch[deprecatedKey] = FieldValue.delete();
      hasChanges = true;
    }
  }

  for (const nonNullKey of NON_NULLABLE_OPTIONAL_BOOK_KEYS) {
    if (candidate[nonNullKey] === null) {
      delete candidate[nonNullKey];
      bookPatch[nonNullKey] = FieldValue.delete();
      hasChanges = true;
    }
  }

  if (candidate.temporalMetadata !== undefined) {
    const normalizedTemporal = normalizeLegacyTemporalField(
      candidate.temporalMetadata,
    );
    if (normalizedTemporal.mutated) {
      candidate.temporalMetadata = normalizedTemporal.value;
      bookPatch.temporalMetadata = normalizedTemporal.value;
      hasChanges = true;
    }
  }

  if (candidate.geoMetadata !== undefined) {
    const normalizedGeo = normalizeLegacyGeoField(candidate.geoMetadata);
    if (normalizedGeo.mutated) {
      candidate.geoMetadata = normalizedGeo.value;
      bookPatch.geoMetadata = normalizedGeo.value;
      hasChanges = true;
    }
  }

  if (candidate.enrichmentStatus !== undefined) {
    const normalizedStatus = normalizeLegacyEnrichmentStatusField(
      candidate.enrichmentStatus,
    );
    if (normalizedStatus.mutated) {
      candidate.enrichmentStatus = normalizedStatus.value;
      bookPatch.enrichmentStatus = normalizedStatus.value;
      hasChanges = true;
    }
  }

  if (
    (candidate.bookDetailsMetadata &&
      typeof candidate.bookDetailsMetadata === 'object' &&
      !Array.isArray(candidate.bookDetailsMetadata)) ||
    hasRescuedHeavy
  ) {
    const rawMeta =
      candidate.bookDetailsMetadata &&
      typeof candidate.bookDetailsMetadata === 'object' &&
      !Array.isArray(candidate.bookDetailsMetadata)
        ? {...(candidate.bookDetailsMetadata as Record<string, unknown>)}
        : {};
    let metaMutated = false;

    if (Object.prototype.hasOwnProperty.call(rawMeta, 'hasDescription')) {
      if (
        rawMeta.hasSynopsis === undefined &&
        typeof rawMeta.hasDescription === 'boolean'
      ) {
        rawMeta.hasSynopsis = rawMeta.hasDescription;
      }
      delete rawMeta.hasDescription;
      metaMutated = true;
    }
    if (Object.prototype.hasOwnProperty.call(rawMeta, 'updatedAt')) {
      delete rawMeta.updatedAt;
      metaMutated = true;
    }
    for (const flagKey of [
      'hasSynopsis',
      'hasAuthorBio',
      'hasEmbedding',
      'hasClusterCoordinates',
    ] as const) {
      if (rawMeta[flagKey] === null) {
        delete rawMeta[flagKey];
        metaMutated = true;
      }
    }

    if (rescuedHeavy.synopsis && rawMeta.hasSynopsis !== true) {
      rawMeta.hasSynopsis = true;
      metaMutated = true;
    }
    if (rescuedHeavy.authorBio && rawMeta.hasAuthorBio !== true) {
      rawMeta.hasAuthorBio = true;
      metaMutated = true;
    }
    if (rescuedHeavy.embedding && rawMeta.hasEmbedding !== true) {
      rawMeta.hasEmbedding = true;
      metaMutated = true;
    }
    if (
      rescuedHeavy.clusterCoordinates &&
      rawMeta.hasClusterCoordinates !== true
    ) {
      rawMeta.hasClusterCoordinates = true;
      metaMutated = true;
    }

    if (metaMutated) {
      candidate.bookDetailsMetadata = rawMeta;
      bookPatch.bookDetailsMetadata = rawMeta;
      hasChanges = true;
    }
  }

  if (!hasChanges && !hasRescuedHeavy) {
    return null;
  }

  return {
    bookPatch,
    ...(hasRescuedHeavy ? {rescuedHeavy} : {}),
  };
}

export function normalizeLegacyBookDetailsReadCandidate(
  candidate: Record<string, unknown>,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const detailsPatch: Record<string, unknown> = {};
  let hasChanges = false;

  const fallbackSynopsis =
    typeof raw.description === 'string' && raw.description.trim().length > 0
      ? raw.description
      : typeof raw.summary === 'string' && raw.summary.trim().length > 0
        ? raw.summary
        : undefined;

  if (
    (candidate.synopsis === undefined || candidate.synopsis === null) &&
    fallbackSynopsis
  ) {
    candidate.synopsis = fallbackSynopsis.slice(0, 50000);
    detailsPatch.synopsis = candidate.synopsis;
    hasChanges = true;
  }

  for (const deprecatedKey of DEPRECATED_BOOK_DETAILS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, deprecatedKey)) {
      delete candidate[deprecatedKey];
      detailsPatch[deprecatedKey] = FieldValue.delete();
      hasChanges = true;
    }
  }

  if (candidate.clusterCoordinates !== undefined) {
    const normalizedCoords = normalizeLegacyClusterCoordinates(
      candidate.clusterCoordinates,
    );
    if (normalizedCoords.mutated) {
      candidate.clusterCoordinates = normalizedCoords.value;
      detailsPatch.clusterCoordinates = normalizedCoords.value;
      hasChanges = true;
    }
  }

  return hasChanges ? detailsPatch : null;
}
