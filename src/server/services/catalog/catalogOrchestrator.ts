import type {BookDetails, CoverCandidate} from '../../../schemas/book';
import {
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
  normalizeBookDetails,
} from '../../../lib/utils';
import type {
  CapacitySnapshot,
  SchedulePriority,
} from '../scheduler/providerQuotaScheduler';
import {globalProviderGovernor} from '../scheduler/globalProviderGovernor';
import {
  type CatalogQuery,
  type ICatalogSourceProvider,
  type OrchestratorExecutionOptions,
  type OrchestratorSearchResult,
  type ProviderBookHit,
  fetchWithProviderTimeout,
} from './types';
import {AppleBooksProvider} from './providers/AppleBooksProvider';
import {PenguinRandomHouseProvider} from './providers/PenguinRandomHouseProvider';
import {HardcoverProvider} from './providers/HardcoverProvider';
import {GoogleBooksProvider} from './providers/GoogleBooksProvider';
import {OpenLibraryProvider} from './providers/OpenLibraryProvider';
import {InventaireWikidataProvider} from './providers/InventaireWikidataProvider';
import {LongitoodCoverProvider} from './providers/LongitoodCoverProvider';
import {LibraryOfCongressProvider} from './providers/LibraryOfCongressProvider';

const INTERACTIVE_DEFAULT_MAX_WAIT_MS = 800;
const BATCH_DEFAULT_MAX_WAIT_MS = 4500;
const INTERACTIVE_PROVIDER_TIMEOUT_MS = 3200;
const BATCH_PROVIDER_TIMEOUT_MS = 5500;

const COVER_TIER_SCORE: Record<'ultra' | 'high' | 'standard', number> = {
  ultra: 300,
  high: 200,
  standard: 100,
};

const SOURCE_COVER_AUTHORITY: Record<string, number> = {
  'Apple Books': 95,
  'Penguin Random House': 92,
  Hardcover: 90,
  Longitood: 84,
  'Google Books': 78,
  Inventaire: 72,
  'Open Library': 68,
  'Library of Congress': 60,
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CatalogOrchestrator {
  private readonly providers: ICatalogSourceProvider[];
  private readonly searchCache = new Map<
    string,
    CacheEntry<OrchestratorSearchResult>
  >();
  private readonly coverValidityCache = new Map<string, CacheEntry<boolean>>();
  private readonly searchCacheTtlMs = 15 * 60 * 1000;
  private readonly coverValidityTtlMs = 60 * 60 * 1000;

  constructor(providers?: ICatalogSourceProvider[]) {
    this.providers = providers ?? [
      new AppleBooksProvider(),
      new PenguinRandomHouseProvider(),
      new HardcoverProvider(),
      new GoogleBooksProvider(),
      new OpenLibraryProvider(),
      new InventaireWikidataProvider(),
      new LongitoodCoverProvider(),
      new LibraryOfCongressProvider(),
    ];
    for (const provider of this.providers) {
      if (provider?.scheduler) {
        globalProviderGovernor.registerProvider(provider.scheduler);
      }
    }
  }

  getProviders(): readonly ICatalogSourceProvider[] {
    return this.providers;
  }

  inspectAllCapacities(
    priority: SchedulePriority = 'INTERACTIVE',
  ): CapacitySnapshot[] {
    return this.providers
      .filter(p => p.isAvailable())
      .map(p => p.scheduler.inspectCapacity(priority));
  }

  clearCaches(): void {
    this.searchCache.clear();
    this.coverValidityCache.clear();
  }

  private getCachedSearch(key: string): OrchestratorSearchResult | null {
    const entry = this.searchCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.searchCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCachedSearch(key: string, value: OrchestratorSearchResult): void {
    if (this.searchCache.size > 500) {
      const oldestKey = this.searchCache.keys().next().value;
      if (oldestKey) this.searchCache.delete(oldestKey);
    }
    this.searchCache.set(key, {
      value,
      expiresAt: Date.now() + this.searchCacheTtlMs,
    });
  }

  /**
   * Verifies cover URLs from CDNs that may return 404 or 1x1 blank pixel images
   * (e.g., Penguin Random House ISBN CDN or Open Library without default=false).
   */
  async verifyCoverUrl(url: string, signal?: AbortSignal): Promise<boolean> {
    if (!url || !url.startsWith('http')) return false;
    const cached = this.coverValidityCache.get(url);
    if (cached && Date.now() <= cached.expiresAt) {
      return cached.value;
    }

    const needsVerification =
      url.includes('images.randomhouse.com') ||
      url.includes('covers.openlibrary.org');

    if (!needsVerification) {
      this.coverValidityCache.set(url, {
        value: true,
        expiresAt: Date.now() + this.coverValidityTtlMs,
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
        this.coverValidityCache.set(url, {
          value: false,
          expiresAt: Date.now() + this.coverValidityTtlMs,
        });
        return false;
      }
      const contentLength = response.headers?.get?.('content-length');
      if (
        contentLength &&
        Number(contentLength) > 0 &&
        Number(contentLength) < 800
      ) {
        // Reject tiny 1x1 transparent GIFs or placeholder icons
        this.coverValidityCache.set(url, {
          value: false,
          expiresAt: Date.now() + this.coverValidityTtlMs,
        });
        return false;
      }
      this.coverValidityCache.set(url, {
        value: true,
        expiresAt: Date.now() + this.coverValidityTtlMs,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async runProviderTask<T>(
    provider: ICatalogSourceProvider,
    options: OrchestratorExecutionOptions,
    taskFn: (signal: AbortSignal) => Promise<T>,
    skippedProviders: string[],
    respondedProviders: string[],
  ): Promise<T | null> {
    if (!provider.isAvailable()) {
      return null;
    }

    const priority: SchedulePriority = options.priority ?? 'INTERACTIVE';
    const maxWaitMs =
      options.maxWaitMs ??
      (priority === 'INTERACTIVE'
        ? INTERACTIVE_DEFAULT_MAX_WAIT_MS
        : BATCH_DEFAULT_MAX_WAIT_MS);
    const perProviderTimeoutMs =
      options.perProviderTimeoutMs ??
      (priority === 'INTERACTIVE'
        ? INTERACTIVE_PROVIDER_TIMEOUT_MS
        : BATCH_PROVIDER_TIMEOUT_MS);

    const snapshot = provider.scheduler.inspectCapacity(priority);
    if (
      snapshot.status === 'COOLDOWN' ||
      snapshot.estimatedWaitMs > maxWaitMs
    ) {
      skippedProviders.push(provider.name);
      return null;
    }

    try {
      const result = await provider.scheduler.schedule(
        {
          priority,
          maxWaitMs,
          signal: options.signal,
        },
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            perProviderTimeoutMs,
          );
          if (options.signal) {
            options.signal.addEventListener('abort', () => controller.abort(), {
              once: true,
            });
          }
          try {
            return await taskFn(controller.signal);
          } finally {
            clearTimeout(timer);
          }
        },
      );
      respondedProviders.push(provider.name);
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (
        errMsg.includes('COOLDOWN') ||
        errMsg.includes('EXHAUSTED') ||
        errMsg.includes('DEADLINE')
      ) {
        if (!skippedProviders.includes(provider.name)) {
          skippedProviders.push(provider.name);
        }
      }
      return null;
    }
  }

  async searchByIsbn(
    rawIsbn: string,
    options: OrchestratorExecutionOptions = {},
  ): Promise<BookDetails | null> {
    const cleanIsbn = normalizeIsbn(rawIsbn);
    if (!cleanIsbn) return null;

    const cacheKey = `isbn:${cleanIsbn}`;
    const cached = this.getCachedSearch(cacheKey);
    if (cached && cached.books.length > 0) {
      return cached.books[0];
    }

    const skippedProviders: string[] = [];
    const respondedProviders: string[] = [];
    const priority = options.priority ?? 'INTERACTIVE';

    const isbnProviders = this.providers.filter(
      p => p.isAvailable() && p.capabilities.isbnSearch,
    );

    let hits: ProviderBookHit[] = [];

    if (priority === 'BATCH') {
      // Two-Wave Batch Strategy:
      // Wave 1: High-capacity primary catalog providers
      const wave1Ids = new Set([
        'apple-books',
        'penguin-random-house',
        'google-books',
        'open-library',
      ]);
      const wave1Providers = isbnProviders.filter(p => wave1Ids.has(p.id));
      const wave2Providers = isbnProviders.filter(p => !wave1Ids.has(p.id));

      const wave1Results = await Promise.all(
        wave1Providers.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByIsbn(cleanIsbn, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      hits = wave1Results.filter((h): h is ProviderBookHit => h !== null);

      const hasVerifiedCover = hits.some(h => Boolean(h.coverUrl));
      const hasSynopsis = hits.some(h =>
        Boolean(h.synopsis && h.synopsis.length >= 60),
      );
      const hasSeries = hits.some(h => Boolean(h.series));

      // Wave 2 only runs if key metadata is still missing
      if (!hasVerifiedCover || !hasSynopsis || !hasSeries) {
        const wave2Results = await Promise.all(
          wave2Providers.map(p =>
            this.runProviderTask(
              p,
              options,
              signal => p.searchByIsbn(cleanIsbn, signal),
              skippedProviders,
              respondedProviders,
            ),
          ),
        );
        hits.push(
          ...wave2Results.filter((h): h is ProviderBookHit => h !== null),
        );
      }
    } else {
      const results = await Promise.all(
        isbnProviders.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByIsbn(cleanIsbn, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      hits = results.filter((h): h is ProviderBookHit => h !== null);
    }

    if (hits.length === 0) {
      return null;
    }

    const stitched = await this.stitchBookHits(hits, {
      fallbackIsbn: cleanIsbn,
      verifyCovers: options.verifyCovers ?? true,
      signal: options.signal,
    });

    if (stitched.length > 0) {
      this.setCachedSearch(cacheKey, {
        books: stitched,
        skippedProviders,
        respondedProviders,
      });
      return stitched[0];
    }
    return null;
  }

  async searchByQuery(
    query: CatalogQuery,
    options: OrchestratorExecutionOptions = {},
  ): Promise<OrchestratorSearchResult> {
    const cleanTitle = query.title ? normalizeTitle(query.title) : '';
    const cleanAuthor = query.author ? normalizeName(query.author) : '';
    const cleanRaw = query.rawQuery ? normalizeText(query.rawQuery) : '';
    const cleanIsbn = query.isbn ? normalizeIsbn(query.isbn) : '';

    if (cleanIsbn && !cleanTitle && !cleanRaw) {
      const book = await this.searchByIsbn(cleanIsbn, options);
      return {
        books: book ? [book] : [],
        skippedProviders: [],
        respondedProviders: book?.sources ?? [],
      };
    }

    const cacheKey = `q:${cleanTitle.toLowerCase()}|${cleanAuthor.toLowerCase()}|${cleanRaw.toLowerCase()}|${query.limit ?? 12}`;
    const cached = this.getCachedSearch(cacheKey);
    if (cached && cached.books.length > 0) {
      return cached;
    }

    const skippedProviders: string[] = [];
    const respondedProviders: string[] = [];
    const priority = options.priority ?? 'INTERACTIVE';

    const queryProviders = this.providers.filter(
      p => p.isAvailable() && p.capabilities.titleSearch,
    );

    const hits: ProviderBookHit[] = [];

    if (priority === 'BATCH') {
      const wave1Ids = new Set([
        'apple-books',
        'google-books',
        'open-library',
        'penguin-random-house',
      ]);
      const wave1Providers = queryProviders.filter(p => wave1Ids.has(p.id));
      const wave2Providers = queryProviders.filter(p => !wave1Ids.has(p.id));

      const wave1Lists = await Promise.all(
        wave1Providers.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByQuery(query, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      for (const list of wave1Lists) {
        if (list) hits.push(...list);
      }

      const hasRichHit = hits.some(
        h =>
          Boolean(h.coverUrl) && Boolean(h.synopsis && h.synopsis.length >= 60),
      );
      if (!hasRichHit) {
        const wave2Lists = await Promise.all(
          wave2Providers.map(p =>
            this.runProviderTask(
              p,
              options,
              signal => p.searchByQuery(query, signal),
              skippedProviders,
              respondedProviders,
            ),
          ),
        );
        for (const list of wave2Lists) {
          if (list) hits.push(...list);
        }
      }
    } else {
      const resultLists = await Promise.all(
        queryProviders.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByQuery(query, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      for (const list of resultLists) {
        if (list) hits.push(...list);
      }
    }

    if (hits.length === 0) {
      return {
        books: [],
        skippedProviders,
        respondedProviders,
      };
    }

    const stitched = await this.stitchBookHits(hits, {
      verifyCovers: options.verifyCovers ?? false,
      signal: options.signal,
    });

    const limited = stitched.slice(0, query.limit ?? 15);
    const response: OrchestratorSearchResult = {
      books: limited,
      skippedProviders,
      respondedProviders,
    };

    if (limited.length > 0) {
      this.setCachedSearch(cacheKey, response);
    }

    return response;
  }

  async fetchCoverCandidates(
    query: CatalogQuery,
    options: OrchestratorExecutionOptions = {},
  ): Promise<{
    candidates: CoverCandidate[];
    skippedProviders: string[];
    respondedProviders: string[];
  }> {
    const skippedProviders: string[] = [];
    const respondedProviders: string[] = [];
    const priority = options.priority ?? 'INTERACTIVE';

    const coverProviders = this.providers.filter(
      p => p.isAvailable() && p.capabilities.coverResolution,
    );

    const resolveFromProvider = (p: ICatalogSourceProvider) =>
      this.runProviderTask(
        p,
        {
          ...options,
          priority,
        },
        async signal => {
          if (p.resolveCovers) {
            return p.resolveCovers(query, signal);
          }
          if (query.isbn && p.capabilities.isbnSearch) {
            const hit = await p.searchByIsbn(query.isbn, signal);
            if (hit?.coverUrl) {
              return [
                {
                  url: hit.coverUrl,
                  source: p.name,
                  resolutionTier: hit.coverResolutionTier ?? 'high',
                } satisfies CoverCandidate,
                ...(hit.additionalCovers ?? []),
              ];
            }
          }
          if (p.capabilities.titleSearch && (query.title || query.rawQuery)) {
            const hits = await p.searchByQuery({...query, limit: 3}, signal);
            const out: CoverCandidate[] = [];
            for (const h of hits) {
              if (h.coverUrl) {
                out.push({
                  url: h.coverUrl,
                  source: p.name,
                  resolutionTier: h.coverResolutionTier ?? 'high',
                  label: h.title,
                });
              }
            }
            return out;
          }
          return [];
        },
        skippedProviders,
        respondedProviders,
      );

    const deduplicateVerifyAndRank = async (
      lists: Array<CoverCandidate[] | null>,
      seenUrls: Set<string>,
    ): Promise<CoverCandidate[]> => {
      const unique: CoverCandidate[] = [];
      for (const list of lists) {
        if (!list) continue;
        for (const candidate of list) {
          const normalizedUrl = candidate.url.trim();
          if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;
          seenUrls.add(normalizedUrl);
          unique.push({
            ...candidate,
            url: normalizedUrl,
          });
        }
      }

      const shouldVerify = options.verifyCovers ?? true;
      const verified = shouldVerify
        ? (
            await Promise.all(
              unique.map(async candidate => {
                const isValid = await this.verifyCoverUrl(
                  candidate.url,
                  options.signal,
                );
                return isValid ? candidate : null;
              }),
            )
          ).filter((c): c is CoverCandidate => c !== null)
        : unique;

      verified.sort((a, b) => {
        const scoreA =
          COVER_TIER_SCORE[a.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[a.source] ?? 50);
        const scoreB =
          COVER_TIER_SCORE[b.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[b.source] ?? 50);
        return scoreB - scoreA;
      });

      return verified;
    };

    const seenUrls = new Set<string>();

    if (priority === 'BATCH') {
      // Two-Wave Early-Exit Strategy for Batch Cover Resolution:
      // Query high-capacity primary cover sources first; if a verified high/ultra
      // cover is found, skip querying slower secondary providers.
      const wave1Ids = new Set([
        'apple-books',
        'penguin-random-house',
        'google-books',
        'open-library',
      ]);
      const wave1Providers = coverProviders.filter(p => wave1Ids.has(p.id));
      const wave2Providers = coverProviders.filter(p => !wave1Ids.has(p.id));

      const wave1Lists = await Promise.all(
        wave1Providers.map(resolveFromProvider),
      );
      const wave1Verified = await deduplicateVerifyAndRank(
        wave1Lists,
        seenUrls,
      );

      const hasHighQualityCover = wave1Verified.some(
        c => (c.resolutionTier ?? 'high') !== 'standard',
      );
      if (hasHighQualityCover || wave2Providers.length === 0) {
        return {
          candidates: wave1Verified,
          skippedProviders,
          respondedProviders,
        };
      }

      const wave2Lists = await Promise.all(
        wave2Providers.map(resolveFromProvider),
      );
      const wave2Verified = await deduplicateVerifyAndRank(
        wave2Lists,
        seenUrls,
      );
      const combined = [...wave1Verified, ...wave2Verified].sort((a, b) => {
        const scoreA =
          COVER_TIER_SCORE[a.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[a.source] ?? 50);
        const scoreB =
          COVER_TIER_SCORE[b.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[b.source] ?? 50);
        return scoreB - scoreA;
      });

      return {
        candidates: combined,
        skippedProviders,
        respondedProviders,
      };
    }

    const candidateLists = await Promise.all(
      coverProviders.map(resolveFromProvider),
    );
    const verifiedCandidates = await deduplicateVerifyAndRank(
      candidateLists,
      seenUrls,
    );

    return {
      candidates: verifiedCandidates,
      skippedProviders,
      respondedProviders,
    };
  }

  private canonicalBookGroupKey(hit: ProviderBookHit): string {
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

  private async stitchBookHits(
    hits: ProviderBookHit[],
    options: {
      fallbackIsbn?: string;
      verifyCovers?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<BookDetails[]> {
    const groups = new Map<string, ProviderBookHit[]>();

    for (const hit of hits) {
      if (!hit.title || hit.title === 'Unknown Title') continue;
      const key = this.canonicalBookGroupKey(hit);
      const existing = groups.get(key) ?? [];
      existing.push(hit);
      groups.set(key, existing);
    }

    const mergedBooks: Array<{book: BookDetails; totalAuthority: number}> = [];

    for (const groupHits of groups.values()) {
      // Sort hits by provider authority weight
      const sortedHits = [...groupHits].sort((a, b) => {
        const weightA =
          this.providers.find(p => p.id === a.providerId)?.authorityWeight ??
          50;
        const weightB =
          this.providers.find(p => p.id === b.providerId)?.authorityWeight ??
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
        sortedHits.find(h => h.author && h.author !== 'Unknown Author')
          ?.author ?? primaryHit.author,
      );

      // Prefer 13-digit ISBN when available
      const isbns = sortedHits
        .map(h => (h.isbn ? normalizeIsbn(h.isbn) : ''))
        .filter(Boolean);
      const isbn =
        isbns.find(i => i.length === 13) ||
        isbns[0] ||
        options.fallbackIsbn ||
        undefined;

      // Aggregate and rank cover candidates across all hits in this group
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

      let coverCandidates = Array.from(candidateMap.values()).sort((a, b) => {
        const scoreA =
          COVER_TIER_SCORE[a.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[a.source] ?? 50);
        const scoreB =
          COVER_TIER_SCORE[b.resolutionTier ?? 'high'] +
          (SOURCE_COVER_AUTHORITY[b.source] ?? 50);
        return scoreB - scoreA;
      });

      if (options.verifyCovers && coverCandidates.length > 0) {
        const verifiedResults = await Promise.all(
          coverCandidates.map(async candidate => {
            const ok = await this.verifyCoverUrl(candidate.url, options.signal);
            return ok ? candidate : null;
          }),
        );
        coverCandidates = verifiedResults.filter(
          (c): c is CoverCandidate => c !== null,
        );
      }

      const coverUrl = coverCandidates[0]?.url;
      const coverSource = coverCandidates[0]?.source;

      // Best synopsis: prefer clean prose between 80 and 2500 chars from high-authority sources
      const synopsisEntries = sortedHits
        .map(h => ({
          text: h.synopsis ? normalizeText(h.synopsis) : '',
          source: h.providerName,
        }))
        .filter(s => s.text.length >= 40)
        .sort(
          (a, b) =>
            Math.min(b.text.length, 1200) - Math.min(a.text.length, 1200),
        );
      const synopsis = synopsisEntries[0]?.text || undefined;
      const synopsisSource = synopsisEntries[0]?.source;

      // Best series: prefer Hardcover or Inventaire/Wikidata structured series first
      const seriesHit =
        sortedHits.find(
          h =>
            (h.providerId === 'hardcover' ||
              h.providerId === 'inventaire-wikidata') &&
            h.series,
        ) || sortedHits.find(h => Boolean(h.series));
      const series = seriesHit?.series || undefined;
      const seriesSource = seriesHit?.providerName;

      // Best publishedDate: prefer full YYYY-MM-DD or earliest valid year
      const publishedDateHit =
        sortedHits.find(
          h => h.publishedDate && /^\d{4}-\d{2}-\d{2}/.test(h.publishedDate),
        ) || sortedHits.find(h => Boolean(h.publishedDate));
      const publishedDate = publishedDateHit?.publishedDate || undefined;

      // Best genre & merged subgenres
      const genreHit = sortedHits.find(h => Boolean(h.primaryGenre));
      const subgenreSet = new Set<string>();
      for (const hit of sortedHits) {
        if (hit.subgenres) {
          for (const sg of hit.subgenres) {
            if (sg) subgenreSet.add(sg);
          }
        }
      }

      const fieldSources: Record<string, string> = {};
      if (coverUrl && coverSource) fieldSources.coverImage = coverSource;
      if (synopsis && synopsisSource) fieldSources.synopsis = synopsisSource;
      if (series && seriesSource) fieldSources.series = seriesSource;
      if (genreHit?.primaryGenre) fieldSources.genre = genreHit.providerName;
      if (publishedDate && publishedDateHit)
        fieldSources.publishedDate = publishedDateHit.providerName;

      const sources = Array.from(new Set(sortedHits.map(h => h.providerName)));
      const totalAuthority = sortedHits.reduce((acc, h) => {
        const w =
          this.providers.find(p => p.id === h.providerId)?.authorityWeight ??
          50;
        return acc + w;
      }, 0);

      const details = normalizeBookDetails({
        title,
        author,
        isbn,
        coverUrl,
        coverCandidates:
          coverCandidates.length > 0 ? coverCandidates : undefined,
        publishedDate,
        primaryGenre: genreHit?.primaryGenre,
        subgenres:
          subgenreSet.size > 0
            ? Array.from(subgenreSet).slice(0, 6)
            : undefined,
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
}

export const catalogOrchestrator = new CatalogOrchestrator();
