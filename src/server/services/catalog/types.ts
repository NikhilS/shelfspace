import type {BookDetails, CoverCandidate} from '../../../schemas/book';
import type {
  ProviderQuotaScheduler,
  SchedulePriority,
} from '../scheduler/providerQuotaScheduler';

export type CatalogProviderId =
  | 'apple-books'
  | 'penguin-random-house'
  | 'hardcover'
  | 'google-books'
  | 'open-library'
  | 'inventaire-wikidata'
  | 'longitood-cover'
  | 'library-of-congress';

export interface ProviderCapabilities {
  isbnSearch: boolean;
  titleSearch: boolean;
  coverResolution: boolean;
  synopsis: boolean;
  series: boolean;
  genre: boolean;
}

export interface CatalogQuery {
  isbn?: string;
  title?: string;
  author?: string;
  rawQuery?: string;
  limit?: number;
}

export interface ProviderBookHit {
  providerId: CatalogProviderId;
  providerName: string;
  title: string;
  author: string;
  isbn?: string;
  coverUrl?: string;
  coverResolutionTier?: 'ultra' | 'high' | 'standard';
  additionalCovers?: CoverCandidate[];
  publishedDate?: string;
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  series?: string;
  synopsis?: string;
}

export interface ICatalogSourceProvider {
  readonly id: CatalogProviderId;
  readonly name: string;
  readonly authorityWeight: number;
  readonly capabilities: ProviderCapabilities;
  readonly scheduler: ProviderQuotaScheduler;

  isAvailable(): boolean;
  searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null>;
  searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]>;
  resolveCovers?(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<CoverCandidate[]>;
}

export interface OrchestratorExecutionOptions {
  priority?: SchedulePriority;
  maxWaitMs?: number;
  perProviderTimeoutMs?: number;
  signal?: AbortSignal;
  verifyCovers?: boolean;
}

export interface OrchestratorSearchResult {
  books: BookDetails[];
  skippedProviders: string[];
  respondedProviders: string[];
}

export async function fetchWithProviderTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 3500,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let combinedSignal = controller.signal;
  if (options.signal) {
    if (
      typeof AbortSignal !== 'undefined' &&
      'any' in AbortSignal &&
      typeof AbortSignal.any === 'function'
    ) {
      combinedSignal = AbortSignal.any([options.signal, controller.signal]);
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: combinedSignal,
    });
    if (response.status === 429) {
      const retryAfterHeader = response.headers?.get?.('retry-after');
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const err = new Error(
        `HTTP 429 Too Many Requests from ${new URL(url).hostname}`,
      ) as Error & {status: number; retryAfterMs?: number};
      err.status = 429;
      if (!Number.isNaN(retryAfterSec) && retryAfterSec > 0) {
        err.retryAfterMs = retryAfterSec * 1000;
      }
      throw err;
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export function stripHtmlTags(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
