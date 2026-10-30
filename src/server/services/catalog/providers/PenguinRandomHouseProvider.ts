import {
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
} from '../../../../lib/utils';
import {mapLegacyGenreToTaxonomy} from '../../../../constants/taxonomy';
import {ProviderQuotaScheduler} from '../../scheduler/providerQuotaScheduler';
import {
  CatalogQuery,
  ICatalogSourceProvider,
  ProviderBookHit,
  ProviderCapabilities,
  fetchWithProviderTimeout,
  stripHtmlTags,
} from '../types';
import type {CoverCandidate} from '../../../../schemas/book';

interface PrhTitleRecord {
  isbn?: number | string;
  titleweb?: string;
  authorweb?: string;
  onsaledate?: string;
  flapcopy?: string;
  jacketquotes?: string;
  seriesname?: string;
  themes?: string[];
  subjectcategorydescription1?: string;
}

export class PenguinRandomHouseProvider implements ICatalogSourceProvider {
  readonly id = 'penguin-random-house' as const;
  readonly name = 'Penguin Random House';
  readonly authorityWeight = 92;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: true,
    genre: true,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'penguin-random-house',
    maxConcurrent: 4,
    minSpacingMs: 150,
    maxRequestsPerMinute: 60,
    burstCapacity: 10,
    defaultCooldownMs: 15_000,
  });

  private getApiKey(): string {
    return (
      (typeof process !== 'undefined' && process.env?.PRH_API_KEY) ||
      ''
    ).trim();
  }

  isAvailable(): boolean {
    // PRH direct ISBN-13 cover CDN is always available without an API key;
    // full REST catalog metadata activates when PRH_API_KEY is configured.
    return true;
  }

  static buildPrhCoverCdnUrl(isbn: string): string {
    const clean = normalizeIsbn(isbn);
    if (clean.length !== 13 || !clean.startsWith('978')) {
      return '';
    }
    return `https://images.randomhouse.com/cover/${clean}`;
  }

  private mapPrhRecordToHit(
    record: PrhTitleRecord,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const isbn = normalizeIsbn(String(record.isbn || fallbackIsbn || ''));
    const coverUrl = PenguinRandomHouseProvider.buildPrhCoverCdnUrl(isbn);
    const mappedGenre = record.subjectcategorydescription1
      ? mapLegacyGenreToTaxonomy(record.subjectcategorydescription1)
      : undefined;

    const additionalCovers: CoverCandidate[] = coverUrl
      ? [
          {
            url: coverUrl,
            source: this.name,
            resolutionTier: 'high',
            widthHint: 800,
            label: 'Penguin Random House · Publisher Jacket',
          },
        ]
      : [];

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(record.titleweb || 'Unknown Title'),
      author: normalizeName(record.authorweb || 'Unknown Author'),
      isbn,
      coverUrl,
      coverResolutionTier: coverUrl ? 'high' : undefined,
      additionalCovers,
      publishedDate: record.onsaledate || '',
      ...(mappedGenre || {}),
      series: record.seriesname ? normalizeText(record.seriesname) : undefined,
      synopsis: normalizeText(stripHtmlTags(record.flapcopy)),
    };
  }

  async searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null> {
    const cleanIsbn = normalizeIsbn(isbn);
    if (!cleanIsbn) {
      return null;
    }

    const apiKey = this.getApiKey();
    if (apiKey) {
      try {
        const url = `https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/titles/${encodeURIComponent(cleanIsbn)}?api_key=${encodeURIComponent(apiKey)}`;
        const response = await fetchWithProviderTimeout(
          url,
          {
            signal,
            headers: {Accept: 'application/json'},
          },
          3200,
        );
        if (response.ok) {
          const data = (await response.json()) as {
            data?: {titles?: PrhTitleRecord[]};
            titleweb?: string;
          };
          const record = data?.data?.titles?.[0] || (data as PrhTitleRecord);
          if (record && record.titleweb) {
            return this.mapPrhRecordToHit(record, cleanIsbn);
          }
        }
      } catch {
        // Fall through to direct ISBN cover resolution
      }
    }

    return null;
  }

  async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return [];
    }

    const searchStr = Array.from(
      new Set(
        [query.title, query.author, query.rawQuery]
          .map(s => s?.trim())
          .filter((s): s is string => Boolean(s)),
      ),
    )
      .join(' ')
      .trim();
    if (!searchStr) {
      return [];
    }

    const url = `https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/titles?q=${encodeURIComponent(searchStr)}&rows=5&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetchWithProviderTimeout(
      url,
      {
        signal,
        headers: {Accept: 'application/json'},
      },
      3200,
    );
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      data?: {titles?: PrhTitleRecord[]};
    };
    const titles = data?.data?.titles || [];
    return titles
      .filter(t => Boolean(t.titleweb))
      .map(t => this.mapPrhRecordToHit(t, query.isbn));
  }

  async resolveCovers(query: CatalogQuery): Promise<CoverCandidate[]> {
    if (!query.isbn) {
      return [];
    }
    const cdnUrl = PenguinRandomHouseProvider.buildPrhCoverCdnUrl(query.isbn);
    if (!cdnUrl) {
      return [];
    }
    return [
      {
        url: cdnUrl,
        source: this.name,
        resolutionTier: 'high',
        widthHint: 800,
        label: 'Penguin Random House · Publisher CDN',
      },
    ];
  }
}
