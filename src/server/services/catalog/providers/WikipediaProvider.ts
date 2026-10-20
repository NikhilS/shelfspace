import {
  ProviderQuotaScheduler,
  SchedulePriority,
} from '../../scheduler/providerQuotaScheduler';
import {globalProviderGovernor} from '../../scheduler/globalProviderGovernor';
import {fetchWithProviderTimeout} from '../types';

export function sanitizeAuthorName(rawAuthor: string): string[] {
  if (
    !rawAuthor ||
    rawAuthor.trim() === '' ||
    rawAuthor.toLowerCase() === 'unknown' ||
    rawAuthor.toLowerCase() === 'unknown author' ||
    rawAuthor.toLowerCase() === 'anonymous' ||
    rawAuthor.toLowerCase() === 'n/a'
  ) {
    return [];
  }

  const cleaned = rawAuthor
    .replace(/^(edited|translated|written|illustrated|compiled)\s+by\s+/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();

  if (!cleaned) return [];

  const candidates: string[] = [cleaned];

  const splitAuthors = cleaned
    .split(/,|\/|\s+&\s+|\s+and\s+/i)
    .map(a => a.trim())
    .filter(a => a.length > 1 && a.toLowerCase() !== 'unknown');

  if (splitAuthors.length > 1 && splitAuthors[0] !== cleaned) {
    candidates.push(splitAuthors[0]);
  }

  return Array.from(new Set(candidates));
}

export class WikipediaProvider {
  private static instance: WikipediaProvider;
  public readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'wikipedia',
    maxConcurrent: 3,
    minSpacingMs: 200,
    maxRequestsPerMinute: 60,
    burstCapacity: 6,
    defaultCooldownMs: 10_000,
  });

  private readonly bioCache = new Map<string, string>();

  constructor() {
    globalProviderGovernor.registerProvider(this.scheduler);
  }

  public static getInstance(): WikipediaProvider {
    if (!WikipediaProvider.instance) {
      WikipediaProvider.instance = new WikipediaProvider();
    }
    return WikipediaProvider.instance;
  }

  private async fetchSingleCandidate(
    name: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const cacheKey = name.toLowerCase().trim();
    if (this.bioCache.has(cacheKey)) {
      return this.bioCache.get(cacheKey)!;
    }

    const query = encodeURIComponent(name);
    const response = await fetchWithProviderTimeout(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&titles=${query}`,
      {
        signal,
        headers: {
          'User-Agent': 'bookish-archival-library/1.0',
        },
      },
      5000,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      query?: {pages?: Record<string, {extract?: string}>};
    };
    const pages = data?.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (!pageId || pageId === '-1') return null;

    const extract = pages[pageId]?.extract;
    if (
      extract &&
      typeof extract === 'string' &&
      extract.trim() !== '' &&
      !extract.toLowerCase().includes('may refer to:')
    ) {
      const cleaned = extract.trim();
      this.bioCache.set(cacheKey, cleaned);
      return cleaned;
    }

    return null;
  }

  public async fetchAuthorBio(
    authorName: string,
    options?: {
      priority?: SchedulePriority;
      maxWaitMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<string | null> {
    const candidates = sanitizeAuthorName(authorName);
    if (candidates.length === 0) {
      return null;
    }

    const priority = options?.priority ?? 'BATCH';
    const maxWaitMs = options?.maxWaitMs ?? 4500;

    for (const candidate of candidates) {
      try {
        const bio = await this.scheduler.schedule(
          {priority, maxWaitMs, signal: options?.signal},
          () => this.fetchSingleCandidate(candidate, options?.signal),
        );
        if (bio) {
          return bio;
        }
      } catch {
        // Proceed to next author candidate or return null
      }
    }

    return null;
  }
}

export const wikipediaProvider = WikipediaProvider.getInstance();

export async function fetchAuthorBioFromWikipedia(
  authorName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  return wikipediaProvider.fetchAuthorBio(authorName, {signal});
}
