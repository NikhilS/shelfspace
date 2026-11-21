import type {BookDetails, CoverCandidate} from '../../../schemas/book';
import {
  normalizeBookDetails,
  normalizeIsbn,
  normalizeName,
  normalizeText,
  normalizeTitle,
} from '../../../lib/utils';
import {
  type CatalogSourceProvider,
  type ProviderBookHit,
  fetchWithProviderTimeout,
} from './types';

export const GOOGLE_BOOKS_PLACEHOLDER_BYTE_LENGTH = 9103;

const COVER_TIER_SCORE: Record<'ultra' | 'high' | 'standard', number> = {
  ultra: 300,
  high: 200,
  standard: 100,
};

export interface CatalogCacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

export function scoreCoverCandidate(
  candidate: CoverCandidate,
  coverAuthorityBySource: ReadonlyMap<string, number>,
): number {
  const tierScore = COVER_TIER_SCORE[candidate.resolutionTier ?? 'high'];
  const authority = coverAuthorityBySource.get(candidate.source) ?? 50;
  return tierScore + authority;
}

export function normalizeProviderHits(list: unknown): ProviderBookHit[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter(
    (item): item is ProviderBookHit =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as ProviderBookHit).title === 'string' &&
      (item as ProviderBookHit).title.trim().length > 0,
  );
}

function isPlaceholderCoverByteSize(bytes: number): boolean {
  return (
    Number.isFinite(bytes) &&
    bytes > 0 &&
    (bytes < 800 || bytes === GOOGLE_BOOKS_PLACEHOLDER_BYTE_LENGTH)
  );
}

/**
 * Verifies cover URLs from CDNs that may return 404, 1x1 blank pixel images,
 * or Google Books' 9,103-byte grey "image not available" placeholder PNG.
 */
export async function verifyCatalogCoverUrl(
  url: string,
  coverValidityCache: Map<string, CatalogCacheEntry<boolean>>,
  coverValidityTtlMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!url || !url.startsWith('http')) {
    return false;
  }
  const cached = coverValidityCache.get(url);
  if (cached && Date.now() <= cached.expiresAt) {
    return cached.value;
  }

  const isGoogleBooksCover =
    url.includes('books.google.com') ||
    url.includes('books.googleusercontent.com');
  const needsVerification =
    isGoogleBooksCover ||
    url.includes('images.randomhouse.com') ||
    url.includes('covers.openlibrary.org');

  if (!needsVerification) {
    coverValidityCache.set(url, {
      value: true,
      expiresAt: Date.now() + coverValidityTtlMs,
    });
    return true;
  }

  try {
    const response = await fetchWithProviderTimeout(
      url,
      {
        method: 'HEAD',
        signal,
      },
      1800,
    );
    if (!response.ok) {
      coverValidityCache.set(url, {
        value: false,
        expiresAt: Date.now() + coverValidityTtlMs,
      });
      return false;
    }
    const contentLengthHeader =
      response.headers?.get?.('content-length') ||
      response.headers?.get?.('x-goog-stored-content-length');
    if (contentLengthHeader) {
      const byteLength = Number(contentLengthHeader);
      if (isPlaceholderCoverByteSize(byteLength)) {
        coverValidityCache.set(url, {
          value: false,
          expiresAt: Date.now() + coverValidityTtlMs,
        });
        return false;
      }
    } else if (isGoogleBooksCover) {
      const getResponse = await fetchWithProviderTimeout(
        url,
        {
          method: 'GET',
          signal,
        },
        2200,
      );
      if (!getResponse.ok) {
        coverValidityCache.set(url, {
          value: false,
          expiresAt: Date.now() + coverValidityTtlMs,
        });
        return false;
      }
      const getLengthHeader =
        getResponse.headers?.get?.('content-length') ||
        getResponse.headers?.get?.('x-goog-stored-content-length');
      if (
        getLengthHeader &&
        isPlaceholderCoverByteSize(Number(getLengthHeader))
      ) {
        coverValidityCache.set(url, {
          value: false,
          expiresAt: Date.now() + coverValidityTtlMs,
        });
        return false;
      }
      if (!getLengthHeader && typeof getResponse.arrayBuffer === 'function') {
        const buf = await getResponse.arrayBuffer();
        if (isPlaceholderCoverByteSize(buf.byteLength)) {
          coverValidityCache.set(url, {
            value: false,
            expiresAt: Date.now() + coverValidityTtlMs,
          });
          return false;
        }
      }
    }
    coverValidityCache.set(url, {
      value: true,
      expiresAt: Date.now() + coverValidityTtlMs,
    });
    return true;
  } catch {
    return false;
  }
}

export function canonicalBookGroupKey(hit: ProviderBookHit): string {
  const cleanTitle = normalizeTitle(hit.title)
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const primaryAuthorLastName =
    normalizeName(hit.author)
      .toLowerCase()
      .split(',')[0]
      .trim()
      .split(/\s+/)
      .pop() || 'unknown';

  if (cleanTitle && cleanTitle !== 'unknown title') {
    return `ta:${cleanTitle}::${primaryAuthorLastName}`;
  }
  if (hit.isbn) {
    return `isbn:${normalizeIsbn(hit.isbn)}`;
  }
  return `raw:${Math.random().toString(36).slice(2)}`;
}

export interface StitchBookHitsContext {
  providers: readonly CatalogSourceProvider[];
  coverAuthorityBySource: ReadonlyMap<string, number>;
  structuredSeriesProviderIds: ReadonlySet<string>;
  verifyCoverUrl: (url: string, signal?: AbortSignal) => Promise<boolean>;
}

export interface StitchBookHitsOptions {
  fallbackIsbn?: string;
  verifyCovers?: boolean;
  signal?: AbortSignal;
}

export async function stitchProviderBookHits(
  hits: Array<ProviderBookHit | null | undefined> | null | undefined,
  context: StitchBookHitsContext,
  options: StitchBookHitsOptions = {},
): Promise<BookDetails[]> {
  const safeHits = normalizeProviderHits(hits);
  const groups = new Map<string, ProviderBookHit[]>();

  for (const hit of safeHits) {
    if (!hit.title || hit.title === 'Unknown Title') {
      continue;
    }
    const key = canonicalBookGroupKey(hit);
    const existing = groups.get(key) ?? [];
    existing.push(hit);
    groups.set(key, existing);
  }

  const mergedBooks: Array<{book: BookDetails; totalAuthority: number}> = [];

  for (const groupHits of groups.values()) {
    const sortedHits = [...groupHits].sort((a, b) => {
      const weightA =
        context.providers.find(p => p.id === a.providerId)?.authorityWeight ??
        50;
      const weightB =
        context.providers.find(p => p.id === b.providerId)?.authorityWeight ??
        50;
      return weightB - weightA;
    });

    const primaryHit =
      sortedHits.find(
        h =>
          h.author &&
          h.author !== 'Unknown Author' &&
          h.title &&
          h.title !== 'Unknown Title',
      ) ?? sortedHits[0];

    const title = normalizeTitle(primaryHit.title);
    const author = normalizeName(
      sortedHits.find(h => h.author && h.author !== 'Unknown Author')?.author ??
        primaryHit.author,
    );

    const isbns = sortedHits
      .map(h => (h.isbn ? normalizeIsbn(h.isbn) : ''))
      .filter(Boolean);
    const isbn =
      isbns.find(i => i.length === 13) ||
      isbns[0] ||
      options.fallbackIsbn ||
      undefined;

    const candidateMap = new Map<string, CoverCandidate>();
    for (const hit of sortedHits) {
      if (hit.coverUrl) {
        candidateMap.set(hit.coverUrl, {
          url: hit.coverUrl,
          source: hit.providerName,
          resolutionTier: hit.coverResolutionTier ?? 'high',
        });
      }
      if (hit.additionalCovers) {
        for (const extra of hit.additionalCovers) {
          if (!candidateMap.has(extra.url)) {
            candidateMap.set(extra.url, extra);
          }
        }
      }
    }

    let coverCandidates = Array.from(candidateMap.values()).sort(
      (a, b) =>
        scoreCoverCandidate(b, context.coverAuthorityBySource) -
        scoreCoverCandidate(a, context.coverAuthorityBySource),
    );

    if (options.verifyCovers && coverCandidates.length > 0) {
      const verifiedResults = await Promise.all(
        coverCandidates.map(async candidate => {
          const ok = await context.verifyCoverUrl(
            candidate.url,
            options.signal,
          );
          return ok ? candidate : null;
        }),
      );
      coverCandidates = verifiedResults.filter(
        (c): c is CoverCandidate => c !== null,
      );
    }

    const coverUrl = coverCandidates[0]?.url;
    const coverSource = coverCandidates[0]?.source;

    const synopsisEntries = sortedHits
      .map(h => ({
        text: h.synopsis ? normalizeText(h.synopsis) : '',
        source: h.providerName,
      }))
      .filter(s => s.text.length >= 40)
      .sort(
        (a, b) => Math.min(b.text.length, 1200) - Math.min(a.text.length, 1200),
      );
    const synopsis = synopsisEntries[0]?.text || undefined;
    const synopsisSource = synopsisEntries[0]?.source;

    const seriesHit =
      sortedHits.find(
        h =>
          context.structuredSeriesProviderIds.has(h.providerId) &&
          Boolean(h.series),
      ) || sortedHits.find(h => Boolean(h.series));
    const series = seriesHit?.series || undefined;
    const seriesSource = seriesHit?.providerName;

    const publishedDateHit =
      sortedHits.find(
        h => h.publishedDate && /^\d{4}-\d{2}-\d{2}/.test(h.publishedDate),
      ) || sortedHits.find(h => Boolean(h.publishedDate));
    const publishedDate = publishedDateHit?.publishedDate || undefined;

    const genreHit = sortedHits.find(h => Boolean(h.primaryGenre));
    const subgenreSet = new Set<string>();
    for (const hit of sortedHits) {
      if (hit.subgenres) {
        for (const sg of hit.subgenres) {
          if (sg) {
            subgenreSet.add(sg);
          }
        }
      }
    }

    const fieldSources: Record<string, string> = {};
    if (coverUrl && coverSource) {
      fieldSources.coverImage = coverSource;
    }
    if (synopsis && synopsisSource) {
      fieldSources.synopsis = synopsisSource;
    }
    if (series && seriesSource) {
      fieldSources.series = seriesSource;
    }
    if (genreHit?.primaryGenre) {
      fieldSources.genre = genreHit.providerName;
    }
    if (publishedDate && publishedDateHit) {
      fieldSources.publishedDate = publishedDateHit.providerName;
    }

    const sources = Array.from(new Set(sortedHits.map(h => h.providerName)));
    const totalAuthority = sortedHits.reduce((acc, h) => {
      const w =
        context.providers.find(p => p.id === h.providerId)?.authorityWeight ??
        50;
      return acc + w;
    }, 0);

    const details = normalizeBookDetails({
      title,
      author,
      isbn,
      coverUrl,
      coverCandidates: coverCandidates.length > 0 ? coverCandidates : undefined,
      publishedDate,
      primaryGenre: genreHit?.primaryGenre,
      subgenres:
        subgenreSet.size > 0 ? Array.from(subgenreSet).slice(0, 6) : undefined,
      isCustomPrimary: genreHit?.isCustomPrimary,
      series,
      synopsis,
      sources,
      fieldSources:
        Object.keys(fieldSources).length > 0 ? fieldSources : undefined,
    });

    mergedBooks.push({book: details, totalAuthority});
  }

  mergedBooks.sort((a, b) => b.totalAuthority - a.totalAuthority);
  return mergedBooks.map(m => m.book);
}
