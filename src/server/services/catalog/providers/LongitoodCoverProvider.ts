import {
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
} from '../../../../lib/utils';
import {ProviderQuotaScheduler} from '../../scheduler/providerQuotaScheduler';
import {
  CatalogQuery,
  ICatalogSourceProvider,
  ProviderBookHit,
  ProviderCapabilities,
  fetchWithProviderTimeout,
} from '../types';
import type {CoverCandidate} from '../../../../schemas/book';

export class LongitoodCoverProvider implements ICatalogSourceProvider {
  public readonly id = 'longitood-cover' as const;
  public readonly name = 'Longitood Cover Archive';
  public readonly authorityWeight = 88;
  public readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: false,
    series: false,
    genre: false,
  };

  public readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'longitood-cover',
    maxConcurrent: 2,
    minSpacingMs: 350,
    maxRequestsPerMinute: 30,
    burstCapacity: 4,
    defaultCooldownMs: 15_000,
  });

  public isAvailable(): boolean {
    return true;
  }

  public async searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null> {
    const cleanIsbn = normalizeIsbn(isbn);
    if (cleanIsbn.length !== 13) return null;

    const url = `https://bookcover.longitood.com/bookcover/${encodeURIComponent(cleanIsbn)}`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3000);
    if (!response.ok) return null;

    const data = (await response.json()) as {url?: string};
    if (!data?.url) return null;

    const coverUrl = data.url.replace('http:', 'https:');
    return {
      providerId: this.id,
      providerName: this.name,
      title: '',
      author: '',
      isbn: cleanIsbn,
      coverUrl,
      coverResolutionTier: 'high',
      additionalCovers: [
        {
          url: coverUrl,
          source: this.name,
          resolutionTier: 'high',
          widthHint: 700,
          label: 'Longitood · Goodreads High-Res',
        },
      ],
    };
  }

  public async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    if (!query.title || !query.author) return [];

    const url = `https://bookcover.longitood.com/bookcover?book_title=${encodeURIComponent(query.title)}&author_name=${encodeURIComponent(query.author)}`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3000);
    if (!response.ok) return [];

    const data = (await response.json()) as {url?: string};
    if (!data?.url) return [];

    const coverUrl = data.url.replace('http:', 'https:');
    return [
      {
        providerId: this.id,
        providerName: this.name,
        title: normalizeTitle(query.title),
        author: normalizeName(query.author),
        isbn: normalizeIsbn(query.isbn || ''),
        coverUrl,
        coverResolutionTier: 'high',
        additionalCovers: [
          {
            url: coverUrl,
            source: this.name,
            resolutionTier: 'high',
            widthHint: 700,
            label: 'Longitood · Goodreads High-Res',
          },
        ],
      },
    ];
  }

  public async resolveCovers(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<CoverCandidate[]> {
    if (query.isbn && normalizeIsbn(query.isbn).length === 13) {
      const hit = await this.searchByIsbn(query.isbn, signal);
      if (hit?.additionalCovers?.length) return hit.additionalCovers;
    }
    if (query.title && query.author) {
      const hits = await this.searchByQuery(query, signal);
      if (hits[0]?.additionalCovers?.length) return hits[0].additionalCovers;
    }
    return [];
  }
}
