import type {BookDetails, CoverCandidate} from '../../../schemas/book';
import {
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
} from '../../../lib/utils';
import type {
  CapacitySnapshot,
  SchedulePriority,
} from '../scheduler/providerQuotaScheduler';
import {globalProviderGovernor} from '../scheduler/globalProviderGovernor';
import {
  type CatalogQuery,
  type CatalogSourceProvider,
  type OrchestratorExecutionOptions,
  type OrchestratorSearchResult,
  type ProviderBookHit,
} from './types';
import {
  createDefaultCatalogProviders,
  DEFAULT_WAVE_1_PROVIDER_IDS,
} from './providerManifest';
import {
  type CatalogCacheEntry,
  normalizeProviderHits,
  scoreCoverCandidate,
  stitchProviderBookHits,
  verifyCatalogCoverUrl,
} from './catalogStitcher';

const INTERACTIVE_DEFAULT_MAX_WAIT_MS = 800;
const BATCH_DEFAULT_MAX_WAIT_MS = 4500;
const INTERACTIVE_PROVIDER_TIMEOUT_MS = 3200;
const BATCH_PROVIDER_TIMEOUT_MS = 5500;

function resolveProviderBatchWave(provider: CatalogSourceProvider): 1 | 2 {
  if (provider.capabilities.batchWave) {
    return provider.capabilities.batchWave;
  }
  return DEFAULT_WAVE_1_PROVIDER_IDS.has(provider.id) ? 1 : 2;
}

export class CatalogOrchestrator {
  private readonly providers: CatalogSourceProvider[];
  private readonly coverAuthorityBySource = new Map<string, number>();
  private readonly structuredSeriesProviderIds = new Set<string>([
    'hardcover',
    'inventaire-wikidata',
  ]);
  private readonly searchCache = new Map<
    string,
    CatalogCacheEntry<OrchestratorSearchResult>
  >();
  private readonly coverValidityCache = new Map<
    string,
    CatalogCacheEntry<boolean>
  >();
  private readonly searchCacheTtlMs = 15 * 60 * 1000;
  private readonly coverValidityTtlMs = 60 * 60 * 1000;

  constructor(providers?: CatalogSourceProvider[]) {
    this.providers = providers ?? createDefaultCatalogProviders();
    for (const provider of this.providers) {
      this.coverAuthorityBySource.set(provider.name, provider.authorityWeight);
      this.coverAuthorityBySource.set(provider.id, provider.authorityWeight);
      if (provider.capabilities.structuredSeries) {
        this.structuredSeriesProviderIds.add(provider.id);
      }
      if (provider?.scheduler) {
        globalProviderGovernor.registerProvider(provider.scheduler);
      }
    }
  }

  private getCoverCandidateScore(candidate: CoverCandidate): number {
    return scoreCoverCandidate(candidate, this.coverAuthorityBySource);
  }

  getProviders(): readonly CatalogSourceProvider[] {
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
    if (!entry) {
      return null;
    }
    if (
      Date.now() > entry.expiresAt ||
      !entry.value ||
      !Array.isArray(entry.value.books)
    ) {
      this.searchCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCachedSearch(key: string, value: OrchestratorSearchResult): void {
    if (this.searchCache.size > 500) {
      const oldestKey = this.searchCache.keys().next().value;
      if (oldestKey) {
        this.searchCache.delete(oldestKey);
      }
    }
    this.searchCache.set(key, {
      value: {
        books: Array.isArray(value?.books) ? value.books : [],
        skippedProviders: Array.isArray(value?.skippedProviders)
          ? value.skippedProviders
          : [],
        respondedProviders: Array.isArray(value?.respondedProviders)
          ? value.respondedProviders
          : [],
      },
      expiresAt: Date.now() + this.searchCacheTtlMs,
    });
  }

  /**
   * Verifies cover URLs from CDNs that may return 404, 1x1 blank pixel images,
   * or Google Books' 9,103-byte grey "image not available" placeholder PNG.
   */
  async verifyCoverUrl(url: string, signal?: AbortSignal): Promise<boolean> {
    return verifyCatalogCoverUrl(
      url,
      this.coverValidityCache,
      this.coverValidityTtlMs,
      signal,
    );
  }

  private async runProviderTask<Result>(
    provider: CatalogSourceProvider,
    options: OrchestratorExecutionOptions,
    taskFn: (signal: AbortSignal) => Promise<Result>,
    skippedProviders: string[],
    respondedProviders: string[],
  ): Promise<Result | null> {
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
    if (!cleanIsbn) {
      return null;
    }

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
      const wave1Providers = isbnProviders.filter(
        p => resolveProviderBatchWave(p) === 1,
      );
      const wave2Providers = isbnProviders.filter(
        p => resolveProviderBatchWave(p) !== 1,
      );

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

  async searchByTitleAndAuthor(
    title: string,
    author: string,
    isbn?: string,
    options: OrchestratorExecutionOptions = {},
  ): Promise<BookDetails | null> {
    if (isbn) {
      const byIsbn = await this.searchByIsbn(isbn, options);
      if (byIsbn) {
        return byIsbn;
      }
    }
    const result = await this.searchByQuery(
      {
        title,
        author,
        rawQuery: `${title} ${author}`.trim(),
        limit: 3,
      },
      options,
    );
    return result.books[0] ?? null;
  }

  async searchByQuery(
    query: CatalogQuery | string,
    options: OrchestratorExecutionOptions = {},
  ): Promise<OrchestratorSearchResult> {
    const normalizedQuery: CatalogQuery =
      typeof query === 'string' ? {rawQuery: query} : query || {};
    const cleanTitle = normalizedQuery.title
      ? normalizeTitle(normalizedQuery.title)
      : '';
    const cleanAuthor = normalizedQuery.author
      ? normalizeName(normalizedQuery.author)
      : '';
    const cleanRaw = normalizedQuery.rawQuery
      ? normalizeText(normalizedQuery.rawQuery)
      : '';
    const cleanIsbn = normalizedQuery.isbn
      ? normalizeIsbn(normalizedQuery.isbn)
      : '';

    if (cleanIsbn && !cleanTitle && !cleanRaw) {
      const book = await this.searchByIsbn(cleanIsbn, options);
      return {
        books: book ? [book] : [],
        skippedProviders: [],
        respondedProviders: book?.sources ?? [],
      };
    }

    const cacheKey = `q:${cleanTitle.toLowerCase()}|${cleanAuthor.toLowerCase()}|${cleanRaw.toLowerCase()}|${normalizedQuery.limit ?? 12}`;
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
      const wave1Providers = queryProviders.filter(
        p => resolveProviderBatchWave(p) === 1,
      );
      const wave2Providers = queryProviders.filter(
        p => resolveProviderBatchWave(p) !== 1,
      );

      const wave1Lists = await Promise.all(
        wave1Providers.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByQuery(normalizedQuery, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      for (const list of wave1Lists) {
        hits.push(...normalizeProviderHits(list));
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
              signal => p.searchByQuery(normalizedQuery, signal),
              skippedProviders,
              respondedProviders,
            ),
          ),
        );
        for (const list of wave2Lists) {
          hits.push(...normalizeProviderHits(list));
        }
      }
    } else {
      const resultLists = await Promise.all(
        queryProviders.map(p =>
          this.runProviderTask(
            p,
            options,
            signal => p.searchByQuery(normalizedQuery, signal),
            skippedProviders,
            respondedProviders,
          ),
        ),
      );
      for (const list of resultLists) {
        hits.push(...normalizeProviderHits(list));
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

    const limited = (Array.isArray(stitched) ? stitched : []).slice(
      0,
      normalizedQuery.limit ?? 15,
    );
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

    const resolveFromProvider = (p: CatalogSourceProvider) =>
      this.runProviderTask(
        p,
        {
          ...options,
          priority,
        },
        async signal => {
          if (p.resolveCovers) {
            const resolved = await p.resolveCovers(query, signal);
            return Array.isArray(resolved) ? resolved : [];
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
                ...(Array.isArray(hit.additionalCovers)
                  ? hit.additionalCovers
                  : []),
              ];
            }
          }
          if (p.capabilities.titleSearch && (query.title || query.rawQuery)) {
            const rawHits = await p.searchByQuery({...query, limit: 3}, signal);
            const hits = normalizeProviderHits(rawHits);
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
        if (!Array.isArray(list)) {
          continue;
        }
        for (const candidate of list) {
          if (!candidate || typeof candidate.url !== 'string') {
            continue;
          }
          const normalizedUrl = candidate.url.trim();
          if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
            continue;
          }
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

      verified.sort(
        (a, b) =>
          this.getCoverCandidateScore(b) - this.getCoverCandidateScore(a),
      );

      return verified;
    };

    const seenUrls = new Set<string>();

    if (priority === 'BATCH') {
      const wave1Providers = coverProviders.filter(
        p => resolveProviderBatchWave(p) === 1,
      );
      const wave2Providers = coverProviders.filter(
        p => resolveProviderBatchWave(p) !== 1,
      );

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
      const combined = [...wave1Verified, ...wave2Verified].sort(
        (a, b) =>
          this.getCoverCandidateScore(b) - this.getCoverCandidateScore(a),
      );

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

  private async stitchBookHits(
    hits: Array<ProviderBookHit | null | undefined> | null | undefined,
    options: {
      fallbackIsbn?: string;
      verifyCovers?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<BookDetails[]> {
    return stitchProviderBookHits(
      hits,
      {
        providers: this.providers,
        coverAuthorityBySource: this.coverAuthorityBySource,
        structuredSeriesProviderIds: this.structuredSeriesProviderIds,
        verifyCoverUrl: (url, signal) => this.verifyCoverUrl(url, signal),
      },
      options,
    );
  }
}

export const catalogOrchestrator = new CatalogOrchestrator();
