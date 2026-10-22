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
} from '../types';

interface LocResultItem {
  title?: string;
  contributor?: string[];
  date?: string;
  subject?: string[];
  description?: string[];
  aka?: string[];
}

interface LocResponse {
  results?: LocResultItem[];
}

export class LibraryOfCongressProvider implements ICatalogSourceProvider {
  readonly id = 'library-of-congress' as const;
  readonly name = 'Library of Congress';
  readonly authorityWeight = 78;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: false,
    synopsis: true,
    series: false,
    genre: true,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'library-of-congress',
    maxConcurrent: 2,
    minSpacingMs: 750,
    maxRequestsPerMinute: 15,
    burstCapacity: 3,
    defaultCooldownMs: 25_000,
  });

  isAvailable(): boolean {
    return true;
  }

  private mapLocItemToHit(
    item: LocResultItem,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const cleanTitle = (item.title || 'Unknown Title')
      .replace(/\s*\/\s*$/, '')
      .replace(/\.$/, '')
      .trim();
    const rawAuthor = item.contributor?.[0] || 'Unknown Author';
    // Convert "Last, First, 1900-1980" -> "First Last"
    const authorParts = rawAuthor
      .replace(/,\s*\d{4}-\d{0,4}.*$/, '')
      .split(',')
      .map(s => s.trim());
    const formattedAuthor =
      authorParts.length === 2
        ? `${authorParts[1]} ${authorParts[0]}`
        : rawAuthor;

    const firstSubj = item.subject?.[0];
    const mappedGenre = firstSubj
      ? mapLegacyGenreToTaxonomy(firstSubj)
      : undefined;

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(cleanTitle),
      author: normalizeName(formattedAuthor),
      isbn: normalizeIsbn(fallbackIsbn || ''),
      publishedDate: item.date ? item.date.slice(0, 10) : '',
      ...(mappedGenre || {}),
      synopsis: item.description?.[0]
        ? normalizeText(item.description[0])
        : undefined,
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

    const url = `https://www.loc.gov/books/?fo=json&q=${encodeURIComponent(cleanIsbn)}&c=1`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3500);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as LocResponse;
    if (!data.results || data.results.length === 0) {
      return null;
    }

    return this.mapLocItemToHit(data.results[0], cleanIsbn);
  }

  async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const qStr = [query.title, query.author, query.rawQuery]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!qStr) {
      return [];
    }

    const url = `https://www.loc.gov/books/?fo=json&q=${encodeURIComponent(qStr)}&c=4`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3500);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as LocResponse;
    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results
      .filter(r => Boolean(r.title))
      .map(r => this.mapLocItemToHit(r, query.isbn));
  }
}
