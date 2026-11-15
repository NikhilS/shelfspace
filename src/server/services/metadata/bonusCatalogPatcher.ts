import {
  computeBookSearchTokens,
  normalizeIsbnForDedupe,
} from '../../../lib/duplicateDetection';
import type {BookDetails} from '../../../schemas/book';
import {isSafeImageOrHttpUrl} from '../../../schemas/common';
import type {
  BonusCatalogFields,
  CanonicalEnrichmentType,
  CoreBookData,
  MetadataPersistencePatch,
} from '../../../types/metadata';
import {catalogOrchestrator} from '../catalog';

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidBonusHttpCoverUrl(url: unknown): url is string {
  if (!hasNonEmptyString(url)) {
    return false;
  }
  const trimmed = url.trim();
  return (
    trimmed.length <= 2048 &&
    /^https?:\/\//i.test(trimmed) &&
    isSafeImageOrHttpUrl(trimmed)
  );
}

/**
 * Extracts bounded, schema-safe opportunistic metadata from a unified
 * `BookDetails` catalog lookup result.
 */
export function extractBonusCatalogFields(
  details: BookDetails | null | undefined,
  options?: {disallowSeries?: boolean},
): BonusCatalogFields | undefined {
  if (!details) {
    return undefined;
  }

  const bonus: BonusCatalogFields = {};
  let populatedCount = 0;

  if (isValidBonusHttpCoverUrl(details.coverUrl)) {
    bonus.coverUrl = details.coverUrl.trim();
    populatedCount++;
  }

  if (hasNonEmptyString(details.isbn)) {
    const clean = details.isbn.trim().slice(0, 64);
    if (clean.length > 0) {
      bonus.isbn = clean;
      populatedCount++;
    }
  }

  if (hasNonEmptyString(details.publishedDate)) {
    const cleanDate = details.publishedDate.trim().slice(0, 100);
    if (cleanDate.length > 0) {
      bonus.publishedDate = cleanDate;
      populatedCount++;
    }
  }

  if (!options?.disallowSeries && hasNonEmptyString(details.series)) {
    const cleanSeries = details.series.trim().slice(0, 300);
    if (cleanSeries.length > 0) {
      bonus.series = cleanSeries;
      populatedCount++;
    }
  }

  if (hasNonEmptyString(details.synopsis)) {
    const cleanSynopsis = details.synopsis.trim().slice(0, 50000);
    if (cleanSynopsis.length > 0) {
      bonus.synopsis = cleanSynopsis;
      populatedCount++;
    }
  }

  if (Array.isArray(details.sources) && hasNonEmptyString(details.sources[0])) {
    bonus.winningProvider = details.sources[0].trim();
  }

  return populatedCount > 0 ? bonus : undefined;
}

/**
 * Merges opportunistic catalog metadata across pipeline stages, preserving
 * earlier fields when downstream stages only supply partial updates.
 */
export function mergeBonusCatalogFields(
  first?: BonusCatalogFields,
  second?: BonusCatalogFields,
): BonusCatalogFields | undefined {
  if (!first && !second) {
    return undefined;
  }
  if (!first) {
    return {...second};
  }
  if (!second) {
    return {...first};
  }
  return {
    coverUrl: second.coverUrl || first.coverUrl,
    isbn: second.isbn || first.isbn,
    publishedDate: second.publishedDate || first.publishedDate,
    series: second.series || first.series,
    synopsis: second.synopsis || first.synopsis,
    winningProvider: second.winningProvider || first.winningProvider,
  };
}

export interface HydratedResidualCatalogItem {
  details: BookDetails | null;
  bonusCatalog?: BonusCatalogFields;
}

export interface HydrateResidualCatalogOptions {
  signal?: AbortSignal;
  verifyCovers?: boolean;
  preferField?: 'synopsis' | 'series' | 'coverUrl';
  disallowSeriesByBookId?: ReadonlySet<string>;
}

function hasPreferredCatalogField(
  details: BookDetails | null | undefined,
  preferField?: 'synopsis' | 'series' | 'coverUrl',
): boolean {
  if (!details) {
    return false;
  }
  if (!preferField) {
    return true;
  }
  if (preferField === 'synopsis') {
    return hasNonEmptyString(details.synopsis);
  }
  if (preferField === 'series') {
    return hasNonEmptyString(details.series);
  }
  return hasNonEmptyString(details.coverUrl);
}

function mergeCatalogDetails(
  primary: BookDetails | null,
  secondary: BookDetails | null,
): BookDetails | null {
  if (!primary) {
    return secondary;
  }
  if (!secondary) {
    return primary;
  }
  return {
    ...secondary,
    ...primary,
    isbn: primary.isbn || secondary.isbn,
    coverUrl: primary.coverUrl || secondary.coverUrl,
    publishedDate: primary.publishedDate || secondary.publishedDate,
    primaryGenre: primary.primaryGenre || secondary.primaryGenre,
    subgenres:
      primary.subgenres && primary.subgenres.length > 0
        ? primary.subgenres
        : secondary.subgenres,
    series: primary.series || secondary.series,
    synopsis: primary.synopsis || secondary.synopsis,
    sources: Array.from(
      new Set([...(primary.sources ?? []), ...(secondary.sources ?? [])]),
    ),
  };
}

/**
 * Queries external catalog providers strictly for residual books that were not
 * resolved by Tier-1 Decisions, capturing both primary details and bonus fields.
 */
export async function hydrateCatalogForResidualBooks(
  books: CoreBookData[],
  options?: HydrateResidualCatalogOptions,
): Promise<Map<string, HydratedResidualCatalogItem>> {
  const results = new Map<string, HydratedResidualCatalogItem>();
  if (books.length === 0 || options?.signal?.aborted) {
    return results;
  }

  const verifyCovers = options?.verifyCovers ?? false;

  await Promise.all(
    books.map(async book => {
      if (options?.signal?.aborted) {
        return;
      }

      let isbnDetails: BookDetails | null = null;
      let queryDetails: BookDetails | null = null;

      try {
        if (hasNonEmptyString(book.isbn)) {
          isbnDetails = await catalogOrchestrator.searchByIsbn(book.isbn, {
            priority: 'BATCH',
            verifyCovers,
            signal: options?.signal,
          });
        }

        if (
          !options?.signal?.aborted &&
          !hasPreferredCatalogField(isbnDetails, options?.preferField) &&
          hasNonEmptyString(book.title)
        ) {
          const searchRes = await catalogOrchestrator.searchByQuery(
            {
              title: book.title,
              author: book.author || '',
              isbn: book.isbn,
              limit: 3,
            },
            {
              priority: 'BATCH',
              verifyCovers,
              signal: options?.signal,
            },
          );
          const candidateBooks = Array.isArray(searchRes?.books)
            ? searchRes.books
            : [];
          queryDetails =
            (options?.preferField
              ? candidateBooks.find(candidate =>
                  hasPreferredCatalogField(candidate, options.preferField),
                )
              : undefined) ??
            candidateBooks[0] ??
            null;
        }
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.error(
            `[hydrateCatalogForResidualBooks] Catalog lookup failed for "${book.title}":`,
            error,
          );
        }
      }

      const merged = hasPreferredCatalogField(isbnDetails, options?.preferField)
        ? mergeCatalogDetails(isbnDetails, queryDetails)
        : mergeCatalogDetails(queryDetails, isbnDetails);

      if (!merged) {
        results.set(book.id, {details: null});
        return;
      }

      let verifiedMerged = merged;
      if (
        !verifyCovers &&
        isValidBonusHttpCoverUrl(merged.coverUrl) &&
        typeof catalogOrchestrator.verifyCoverUrl === 'function'
      ) {
        try {
          const coverValid = await catalogOrchestrator.verifyCoverUrl(
            merged.coverUrl,
            options?.signal,
          );
          if (!coverValid) {
            verifiedMerged = {...merged, coverUrl: ''};
          }
        } catch {
          verifiedMerged = {...merged, coverUrl: ''};
        }
      }

      const disallowSeries =
        options?.disallowSeriesByBookId?.has(book.id) ?? false;
      const bonusCatalog = extractBonusCatalogFields(verifiedMerged, {
        disallowSeries,
      });

      results.set(book.id, {
        details: verifiedMerged,
        ...(bonusCatalog ? {bonusCatalog} : {}),
      });
    }),
  );

  return results;
}

export interface ApplyBonusCatalogPatchParams {
  rawDoc: Record<string, unknown>;
  book: CoreBookData;
  primaryStatusKey: CanonicalEnrichmentType;
  patch: MetadataPersistencePatch;
  bonusCatalog?: BonusCatalogFields;
  existingStatus: Record<string, unknown>;
  existingDetailsMeta: Record<string, unknown>;
  nowIso: string;
}

export interface ApplyBonusCatalogPatchResult {
  patch: MetadataPersistencePatch;
  bonusUpdatedFields: string[];
}

/**
 * Applies opportunistic catalog fields strictly non-destructively onto a book's
 * Firestore persistence patch, maintaining `cleanIsbn`, `searchTokens`,
 * `bookDetailsMetadata`, and `enrichmentStatus` invariants.
 */
export function applyNonDestructiveBonusCatalogPatch(
  params: ApplyBonusCatalogPatchParams,
): ApplyBonusCatalogPatchResult {
  const {
    rawDoc,
    book,
    primaryStatusKey,
    patch,
    bonusCatalog,
    existingStatus,
    existingDetailsMeta,
    nowIso,
  } = params;

  if (!bonusCatalog) {
    return {patch, bonusUpdatedFields: []};
  }

  const bookUpdate: Record<string, unknown> = {...patch.bookUpdate};
  let detailsUpdate: Record<string, unknown> | undefined = patch.detailsUpdate
    ? {...patch.detailsUpdate}
    : undefined;
  const resultPreview: Record<string, unknown> = {...patch.resultPreview};

  const nextStatus: Record<string, unknown> = {
    ...existingStatus,
    ...((bookUpdate.enrichmentStatus as Record<string, unknown> | undefined) ??
      {}),
  };
  const nextDetailsMeta: Record<string, unknown> = {
    ...existingDetailsMeta,
    ...((bookUpdate.bookDetailsMetadata as
      Record<string, unknown> | undefined) ?? {}),
  };

  const bonusUpdatedFields: string[] = [];
  let needsSearchTokenRecompute = false;

  if (
    primaryStatusKey !== 'coverImage' &&
    !hasNonEmptyString(rawDoc.coverUrl) &&
    !hasNonEmptyString(bookUpdate.coverUrl) &&
    isValidBonusHttpCoverUrl(bonusCatalog.coverUrl)
  ) {
    const cleanCover = bonusCatalog.coverUrl.trim();
    bookUpdate.coverUrl = cleanCover;
    resultPreview.coverUrl = cleanCover;
    nextStatus.coverImage = 'completed';
    bonusUpdatedFields.push('coverUrl');
  }

  if (
    !hasNonEmptyString(rawDoc.isbn) &&
    !hasNonEmptyString(bookUpdate.isbn) &&
    hasNonEmptyString(bonusCatalog.isbn)
  ) {
    const cleanRawIsbn = bonusCatalog.isbn.trim().slice(0, 64);
    const normalizedDedupeIsbn = normalizeIsbnForDedupe(cleanRawIsbn);
    if (cleanRawIsbn.length > 0) {
      bookUpdate.isbn = cleanRawIsbn;
      resultPreview.isbn = cleanRawIsbn;
      if (normalizedDedupeIsbn.length > 0) {
        bookUpdate.cleanIsbn = normalizedDedupeIsbn;
      }
      bonusUpdatedFields.push('isbn');
      needsSearchTokenRecompute = true;
    }
  }

  if (
    !hasNonEmptyString(rawDoc.publishedDate) &&
    !hasNonEmptyString(bookUpdate.publishedDate) &&
    hasNonEmptyString(bonusCatalog.publishedDate)
  ) {
    const cleanDate = bonusCatalog.publishedDate.trim().slice(0, 100);
    if (cleanDate.length > 0) {
      bookUpdate.publishedDate = cleanDate;
      resultPreview.publishedDate = cleanDate;
      bonusUpdatedFields.push('publishedDate');
    }
  }

  if (
    primaryStatusKey !== 'series' &&
    nextStatus.series !== 'unsupported' &&
    !hasNonEmptyString(rawDoc.series) &&
    !hasNonEmptyString(bookUpdate.series) &&
    hasNonEmptyString(bonusCatalog.series)
  ) {
    const cleanSeries = bonusCatalog.series.trim().slice(0, 300);
    if (cleanSeries.length > 0) {
      bookUpdate.series = cleanSeries;
      resultPreview.series = cleanSeries;
      nextStatus.series = 'completed';
      bonusUpdatedFields.push('series');
      needsSearchTokenRecompute = true;
    }
  }

  if (needsSearchTokenRecompute) {
    const effectiveIsbn = hasNonEmptyString(bookUpdate.isbn)
      ? bookUpdate.isbn
      : hasNonEmptyString(rawDoc.isbn)
        ? rawDoc.isbn
        : book.isbn;
    const effectiveSeries = hasNonEmptyString(bookUpdate.series)
      ? bookUpdate.series
      : hasNonEmptyString(rawDoc.series)
        ? rawDoc.series
        : undefined;
    const updatedTokens = computeBookSearchTokens({
      title: book.title,
      author: book.author,
      isbn: effectiveIsbn,
      series: effectiveSeries,
    });
    if (updatedTokens.length > 0) {
      bookUpdate.searchTokens = updatedTokens;
    }
  }

  const alreadyHasSynopsis =
    Boolean(nextDetailsMeta.hasSynopsis) ||
    hasNonEmptyString(book.synopsis) ||
    hasNonEmptyString(detailsUpdate?.synopsis);

  if (
    primaryStatusKey !== 'synopsis' &&
    !alreadyHasSynopsis &&
    hasNonEmptyString(bonusCatalog.synopsis)
  ) {
    const cleanSynopsis = bonusCatalog.synopsis.trim().slice(0, 50000);
    if (cleanSynopsis.length > 0) {
      detailsUpdate = {
        ...(detailsUpdate ?? {}),
        synopsis: cleanSynopsis,
        updatedAt: nowIso,
      };
      nextDetailsMeta.hasSynopsis = true;
      bookUpdate.bookDetailsMetadata = nextDetailsMeta;
      resultPreview.bookDetailsMetadata = nextDetailsMeta;
      nextStatus.synopsis = 'completed';
      bonusUpdatedFields.push('synopsis');
    }
  }

  if (bonusUpdatedFields.length > 0) {
    bookUpdate.enrichmentStatus = nextStatus;
  }

  return {
    patch: {
      bookUpdate,
      ...(detailsUpdate ? {detailsUpdate} : {}),
      resultPreview,
    },
    bonusUpdatedFields,
  };
}
