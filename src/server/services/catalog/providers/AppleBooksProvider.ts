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

interface AppleBooksTrack {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  genres?: string[];
  description?: string;
}

interface AppleBooksResponse {
  resultCount?: number;
  results?: AppleBooksTrack[];
}

function upgradeAppleArtworkUrl(url?: string): {
  ultra: string;
  high: string;
} | null {
  if (!url) {
    return null;
  }
  const clean = url.replace('http:', 'https:');
  const ultra = clean.replace(/\/[0-9]+x[0-9]+bb\.jpg/i, '/1000x1000bb.jpg');
  const high = clean.replace(/\/[0-9]+x[0-9]+bb\.jpg/i, '/600x600bb.jpg');
  return {ultra, high};
}

function extractSeriesFromTitle(rawTitle?: string): {
  cleanTitle: string;
  series?: string;
} {
  if (!rawTitle) {
    return {cleanTitle: 'Unknown Title'};
  }
  // Apple Books frequently formats series as "Book Title (Series Name, Book 1)"
  const match = rawTitle.match(
    /^(.*?)\s*\(([^)]+?(?:Book|Vol\.?|Volume|#)\s*\d+[^)]*)\)\s*$/i,
  );
  if (match) {
    return {
      cleanTitle: match[1].trim(),
      series: match[2].trim(),
    };
  }
  return {cleanTitle: rawTitle.trim()};
}

export class AppleBooksProvider implements ICatalogSourceProvider {
  readonly id = 'apple-books' as const;
  readonly name = 'Apple Books';
  readonly authorityWeight = 95;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: true,
    genre: true,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'apple-books',
    maxConcurrent: 2,
    minSpacingMs: 600,
    maxRequestsPerMinute: 20,
    burstCapacity: 4,
    defaultCooldownMs: 20_000,
  });

  isAvailable(): boolean {
    return true;
  }

  private mapTrackToHit(
    track: AppleBooksTrack,
    fallbackIsbn?: string,
  ): ProviderBookHit {
    const {cleanTitle, series} = extractSeriesFromTitle(track.trackName);
    const artwork = upgradeAppleArtworkUrl(
      track.artworkUrl100 || track.artworkUrl60,
    );
    const genreLabel = track.primaryGenreName || track.genres?.[0];
    const mappedGenre = genreLabel
      ? mapLegacyGenreToTaxonomy(genreLabel)
      : undefined;

    const additionalCovers: CoverCandidate[] = [];
    if (artwork) {
      additionalCovers.push({
        url: artwork.ultra,
        source: this.name,
        resolutionTier: 'ultra',
        widthHint: 1000,
        label: 'Apple Books · Ultra HD',
      });
    }

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(cleanTitle),
      author: normalizeName(track.artistName || 'Unknown Author'),
      isbn: normalizeIsbn(fallbackIsbn || ''),
      coverUrl: artwork?.ultra || '',
      coverResolutionTier: artwork ? 'ultra' : undefined,
      additionalCovers,
      publishedDate: track.releaseDate ? track.releaseDate.slice(0, 10) : '',
      ...(mappedGenre || {}),
      series,
      synopsis: normalizeText(stripHtmlTags(track.description)),
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

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanIsbn)}&media=ebook&entity=ebook&limit=3`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3200);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as AppleBooksResponse;
    if (!data.results || data.results.length === 0) {
      return null;
    }

    return this.mapTrackToHit(data.results[0], cleanIsbn);
  }

  async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const parts = [query.title, query.author, query.rawQuery]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!parts) {
      return [];
    }

    const limit = Math.min(10, query.limit ?? 6);
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(parts)}&media=ebook&entity=ebook&limit=${limit}`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3200);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as AppleBooksResponse;
    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results.map(track => this.mapTrackToHit(track, query.isbn));
  }
}
