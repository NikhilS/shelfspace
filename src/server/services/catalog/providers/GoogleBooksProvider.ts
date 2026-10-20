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
import type {CoverCandidate} from '../../../../schemas/book';

interface IndustryIdentifier {
  type: string;
  identifier: string;
}

interface GoogleBooksItem {
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    industryIdentifiers?: IndustryIdentifier[];
    imageLinks?: {
      extraLarge?: string;
      large?: string;
      medium?: string;
      small?: string;
      thumbnail?: string;
      smallThumbnail?: string;
    };
    publishedDate?: string;
    categories?: string[];
    description?: string;
  };
}

interface GoogleBooksResponse {
  items?: GoogleBooksItem[];
}

function extractIsbn(identifiers?: IndustryIdentifier[]): string {
  if (!identifiers) return '';
  const isbn13 = identifiers.find(id => id.type === 'ISBN_13');
  if (isbn13) return isbn13.identifier;
  const isbn10 = identifiers.find(id => id.type === 'ISBN_10');
  if (isbn10) return isbn10.identifier;
  return '';
}

export function upgradeGoogleCoverUrl(
  url: string | undefined,
  zoomLevel: 1 | 2 | 3 = 2,
): string {
  if (!url) return '';
  let hiResUrl = url.replace('http:', 'https:');
  if (hiResUrl.includes('books.google.com/books/content')) {
    hiResUrl = hiResUrl
      .replace(/&edge=curl/g, '')
      .replace(/&zoom=[0-9]/g, `&zoom=${zoomLevel}`);
  }
  return hiResUrl;
}

export class GoogleBooksProvider implements ICatalogSourceProvider {
  public readonly id = 'google-books' as const;
  public readonly name = 'Google Books';
  public readonly authorityWeight = 85;
  public readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: false,
    genre: true,
  };

  public readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'google-books',
    maxConcurrent: 3,
    minSpacingMs: 200,
    maxRequestsPerMinute: 60,
    burstCapacity: 8,
    defaultCooldownMs: 15_000,
  });

  public isAvailable(): boolean {
    return true;
  }

  private buildUrl(queryParam: string): string {
    const apiKey =
      (typeof process !== 'undefined' &&
        (process.env?.BOOKS_API_KEY || process.env?.VITE_BOOKS_API_KEY)) ||
      '';
    const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${queryParam}`;
    return apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;
  }

  private mapItemToHit(
    item: GoogleBooksItem,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const bookData = item.volumeInfo || {};
    const rawThumb =
      bookData.imageLinks?.extraLarge ||
      bookData.imageLinks?.large ||
      bookData.imageLinks?.medium ||
      bookData.imageLinks?.thumbnail ||
      bookData.imageLinks?.smallThumbnail;

    const coverZoom2 = upgradeGoogleCoverUrl(rawThumb, 2);
    const coverZoom1 = upgradeGoogleCoverUrl(rawThumb, 1);

    const additionalCovers: CoverCandidate[] = [];
    if (coverZoom2) {
      additionalCovers.push({
        url: coverZoom2,
        source: this.name,
        resolutionTier: 'high',
        widthHint: 600,
        label: 'Google Books · High-Res',
      });
    }
    if (coverZoom1 && coverZoom1 !== coverZoom2) {
      additionalCovers.push({
        url: coverZoom1,
        source: this.name,
        resolutionTier: 'standard',
        widthHint: 300,
        label: 'Google Books · Standard',
      });
    }

    const mappedGenre = bookData.categories?.[0]
      ? mapLegacyGenreToTaxonomy(bookData.categories[0])
      : undefined;

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(bookData.title || 'Unknown Title'),
      author: normalizeName(bookData.authors?.join(', ') || 'Unknown Author'),
      isbn: normalizeIsbn(
        extractIsbn(bookData.industryIdentifiers) || fallbackIsbn || '',
      ),
      coverUrl: coverZoom2 || coverZoom1 || '',
      coverResolutionTier: coverZoom2 ? 'high' : 'standard',
      additionalCovers,
      publishedDate: bookData.publishedDate || '',
      ...(mappedGenre || {}),
      synopsis: normalizeText(bookData.description || undefined),
    };
  }

  public async searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null> {
    const cleanIsbn = normalizeIsbn(isbn);
    if (!cleanIsbn) return null;

    let response = await fetchWithProviderTimeout(
      this.buildUrl(`isbn:${encodeURIComponent(cleanIsbn)}`),
      {signal},
      3500,
    );

    if (response.ok) {
      let data = (await response.json()) as GoogleBooksResponse;
      if (!data.items || data.items.length === 0) {
        response = await fetchWithProviderTimeout(
          this.buildUrl(encodeURIComponent(cleanIsbn)),
          {signal},
          3500,
        );
        if (response.ok) {
          data = (await response.json()) as GoogleBooksResponse;
        }
      }

      if (data.items && data.items.length > 0) {
        return this.mapItemToHit(data.items[0], cleanIsbn);
      }
    }

    return null;
  }

  public async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const limit = Math.min(10, query.limit ?? 8);
    let qParam = '';

    if (query.title && query.author) {
      qParam = `${encodeURIComponent(`intitle:"${query.title}"+inauthor:"${query.author}"`)}&maxResults=${limit}`;
    } else if (query.title) {
      qParam = `intitle:${encodeURIComponent(query.title)}&maxResults=${limit}`;
    } else if (query.rawQuery) {
      qParam = `${encodeURIComponent(query.rawQuery)}&maxResults=${limit}`;
    } else {
      return [];
    }

    const hits: ProviderBookHit[] = [];
    const response = await fetchWithProviderTimeout(
      this.buildUrl(qParam),
      {signal},
      3500,
    );

    if (response.ok) {
      const data = (await response.json()) as GoogleBooksResponse;
      if (data.items && data.items.length > 0) {
        hits.push(
          ...data.items.map(item => this.mapItemToHit(item, query.isbn)),
        );
      }
    }

    // If strict intitle: yielded fewer than 3 matches and we only searched by title, do a general query
    if (hits.length < 3 && (query.title || query.rawQuery) && !query.author) {
      const raw = query.rawQuery || query.title || '';
      const fallbackRes = await fetchWithProviderTimeout(
        this.buildUrl(`${encodeURIComponent(raw)}&maxResults=${limit}`),
        {signal},
        3500,
      );
      if (fallbackRes.ok) {
        const fallbackData = (await fallbackRes.json()) as GoogleBooksResponse;
        if (fallbackData.items && fallbackData.items.length > 0) {
          hits.push(
            ...fallbackData.items.map(item =>
              this.mapItemToHit(item, query.isbn),
            ),
          );
        }
      }
    }

    return hits;
  }
}
