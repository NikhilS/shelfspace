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

interface HardcoverBookNode {
  title?: string;
  description?: string;
  release_date?: string;
  image?: {url?: string};
  contributions?: Array<{author?: {name?: string}}>;
  featured_book_series?: {
    position?: number | string;
    series?: {name?: string};
  };
  editions?: Array<{
    isbn_13?: string;
    isbn_10?: string;
    image?: {url?: string};
  }>;
  cached_tags?: {Genre?: Array<{tag?: string}>};
}

export class HardcoverProvider implements ICatalogSourceProvider {
  readonly id = 'hardcover' as const;
  readonly name = 'Hardcover';
  readonly authorityWeight = 90;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: true,
    genre: true,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'hardcover',
    maxConcurrent: 3,
    minSpacingMs: 250,
    maxRequestsPerMinute: 60,
    burstCapacity: 6,
    defaultCooldownMs: 15_000,
  });

  private getApiKey(): string {
    const raw =
      (typeof process !== 'undefined' && process.env?.HARDCOVER_API_KEY) || '';
    return raw.replace(/^Bearer\s+/i, '').trim();
  }

  isAvailable(): boolean {
    return this.getApiKey().length > 0;
  }

  private mapNodeToHit(
    node: HardcoverBookNode,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const editionIsbn =
      node.editions?.find(e => e.isbn_13)?.isbn_13 ||
      node.editions?.find(e => e.isbn_10)?.isbn_10 ||
      fallbackIsbn ||
      '';
    const coverUrl =
      node.image?.url ||
      node.editions?.find(e => e.image?.url)?.image?.url ||
      '';
    const authors = (node.contributions || [])
      .map(c => c.author?.name)
      .filter((n): n is string => Boolean(n));

    let series: string | undefined;
    if (node.featured_book_series?.series?.name) {
      const seriesName = node.featured_book_series.series.name;
      const pos = node.featured_book_series.position;
      series = pos ? `${seriesName} #${pos}` : seriesName;
    }

    const firstGenre = node.cached_tags?.Genre?.[0]?.tag;
    const mappedGenre = firstGenre
      ? mapLegacyGenreToTaxonomy(firstGenre)
      : undefined;

    const additionalCovers: CoverCandidate[] = [];
    if (coverUrl) {
      additionalCovers.push({
        url: coverUrl,
        source: this.name,
        resolutionTier: 'high',
        widthHint: 800,
        label: 'Hardcover · Curated Edition',
      });
    }

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(node.title || 'Unknown Title'),
      author: normalizeName(authors.join(', ') || 'Unknown Author'),
      isbn: normalizeIsbn(editionIsbn),
      coverUrl,
      coverResolutionTier: coverUrl ? 'high' : undefined,
      additionalCovers,
      publishedDate: node.release_date || '',
      ...(mappedGenre || {}),
      series: series ? normalizeText(series) : undefined,
      synopsis: normalizeText(stripHtmlTags(node.description)),
    };
  }

  async searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null> {
    if (!this.isAvailable()) {
      return null;
    }
    const cleanIsbn = normalizeIsbn(isbn);
    if (!cleanIsbn) {
      return null;
    }

    const query = `
      query SearchByIsbn($isbn: String!) {
        editions(where: {_or: [{isbn_13: {_eq: $isbn}}, {isbn_10: {_eq: $isbn}}]}, limit: 1) {
          isbn_13
          isbn_10
          image { url }
          book {
            title
            description
            release_date
            image { url }
            contributions { author { name } }
            featured_book_series {
              position
              series { name }
            }
          }
        }
      }
    `;

    const response = await fetchWithProviderTimeout(
      'https://api.hardcover.app/v1/graphql',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify({query, variables: {isbn: cleanIsbn}}),
      },
      3500,
    );

    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      data?: {
        editions?: Array<{
          isbn_13?: string;
          isbn_10?: string;
          image?: {url?: string};
          book?: HardcoverBookNode;
        }>;
      };
    };

    const edition = payload?.data?.editions?.[0];
    if (!edition?.book) {
      return null;
    }

    const mergedNode: HardcoverBookNode = {
      ...edition.book,
      image: edition.image?.url ? edition.image : edition.book.image,
      editions: [edition],
    };
    return this.mapNodeToHit(mergedNode, cleanIsbn);
  }

  async searchByQuery(
    catalogQuery: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    if (!this.isAvailable()) {
      return [];
    }
    const title = (catalogQuery.title || catalogQuery.rawQuery || '').trim();
    if (!title) {
      return [];
    }

    const query = `
      query SearchBooks($title: String!) {
        books(where: {title: {_ilike: $title}}, limit: 5) {
          title
          description
          release_date
          image { url }
          contributions { author { name } }
          featured_book_series {
            position
            series { name }
          }
          editions(limit: 2) {
            isbn_13
            isbn_10
            image { url }
          }
        }
      }
    `;

    const response = await fetchWithProviderTimeout(
      'https://api.hardcover.app/v1/graphql',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify({query, variables: {title: `%${title}%`}}),
      },
      3500,
    );

    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as {
      data?: {books?: HardcoverBookNode[]};
    };

    const books = payload?.data?.books || [];
    return books.map(node => this.mapNodeToHit(node, catalogQuery.isbn));
  }
}
