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

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  first_publish_year?: number;
  subject?: string[];
  first_sentence?: string | string[];
}

interface OpenLibraryResponse {
  docs?: OpenLibraryDoc[];
}

export class OpenLibraryProvider implements ICatalogSourceProvider {
  readonly id = 'open-library' as const;
  readonly name = 'Open Library';
  readonly authorityWeight = 75;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: false,
    genre: true,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'open-library',
    maxConcurrent: 3,
    minSpacingMs: 200,
    maxRequestsPerMinute: 60,
    burstCapacity: 6,
    defaultCooldownMs: 12_000,
  });

  isAvailable(): boolean {
    return true;
  }

  private mapDocToHit(
    doc: OpenLibraryDoc,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const isbn = normalizeIsbn(doc.isbn?.[0] || fallbackIsbn || '');
    const coverById = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : '';
    const coverByIsbn =
      !coverById && isbn
        ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
        : '';
    const coverUrl = coverById || coverByIsbn;

    const additionalCovers: CoverCandidate[] = [];
    if (coverUrl) {
      additionalCovers.push({
        url: coverUrl,
        source: this.name,
        resolutionTier: 'standard',
        widthHint: 500,
        label: 'Open Library · Archive Cover',
      });
    }

    const firstSubject = doc.subject?.[0];
    const mappedGenre = firstSubject
      ? mapLegacyGenreToTaxonomy(firstSubject)
      : undefined;

    const sentence = Array.isArray(doc.first_sentence)
      ? doc.first_sentence[0]
      : doc.first_sentence;

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(doc.title || 'Unknown Title'),
      author: normalizeName(doc.author_name?.join(', ') || 'Unknown Author'),
      isbn,
      coverUrl,
      coverResolutionTier: coverUrl ? 'standard' : undefined,
      additionalCovers,
      publishedDate: doc.first_publish_year?.toString() || '',
      ...(mappedGenre || {}),
      synopsis: sentence ? normalizeText(sentence) : undefined,
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

    let response = await fetchWithProviderTimeout(
      `https://openlibrary.org/search.json?isbn=${encodeURIComponent(cleanIsbn)}&limit=1`,
      {signal},
      3500,
    );

    if (response.ok) {
      let data = (await response.json()) as OpenLibraryResponse;
      if (!data.docs || data.docs.length === 0) {
        response = await fetchWithProviderTimeout(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanIsbn)}&limit=1`,
          {signal},
          3500,
        );
        if (response.ok) {
          data = (await response.json()) as OpenLibraryResponse;
        }
      }

      if (data.docs && data.docs.length > 0) {
        return this.mapDocToHit(data.docs[0], cleanIsbn);
      }
    }

    return null;
  }

  async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const limit = Math.min(10, query.limit ?? 6);
    let url = '';
    if (query.title && query.author) {
      url = `https://openlibrary.org/search.json?title=${encodeURIComponent(query.title)}&author=${encodeURIComponent(query.author)}&limit=${limit}`;
    } else if (query.title) {
      url = `https://openlibrary.org/search.json?title=${encodeURIComponent(query.title)}&limit=${limit}`;
    } else if (query.rawQuery) {
      url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query.rawQuery)}&limit=${limit}`;
    } else {
      return [];
    }

    const response = await fetchWithProviderTimeout(url, {signal}, 3500);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as OpenLibraryResponse;
    if (!data.docs || data.docs.length === 0) {
      return [];
    }

    return data.docs.map(doc => this.mapDocToHit(doc, query.isbn));
  }
}
