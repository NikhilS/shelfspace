import {
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
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

interface InventaireEntity {
  uri?: string;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  image?: {url?: string};
  claims?: {
    'wdt:P50'?: string[]; // author URI
    'wdt:P179'?: string[]; // part of the series
    'wdt:P1545'?: string[]; // series ordinal
    'wdt:P577'?: string[]; // publication date
    'wdt:P212'?: string[]; // ISBN-13
    'wdt:P957'?: string[]; // ISBN-10
  };
}

function resolveInventaireImageUrl(rawPath?: string): string {
  if (!rawPath) {
    return '';
  }
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    return rawPath;
  }
  if (rawPath.startsWith('/')) {
    return `https://inventaire.io${rawPath}`;
  }
  return `https://inventaire.io/img/entities/${rawPath}`;
}

function pickEnglishOrFirst(dict?: Record<string, string>): string {
  if (!dict) {
    return '';
  }
  return (
    dict.en || dict['en-us'] || dict['en-gb'] || Object.values(dict)[0] || ''
  );
}

export class InventaireWikidataProvider implements ICatalogSourceProvider {
  readonly id = 'inventaire-wikidata' as const;
  readonly name = 'Inventaire · Wikidata';
  readonly authorityWeight = 82;
  readonly capabilities: ProviderCapabilities = {
    isbnSearch: true,
    titleSearch: true,
    coverResolution: true,
    synopsis: true,
    series: true,
    genre: false,
  };

  readonly scheduler = new ProviderQuotaScheduler({
    providerId: 'inventaire-wikidata',
    maxConcurrent: 2,
    minSpacingMs: 350,
    maxRequestsPerMinute: 30,
    burstCapacity: 4,
    defaultCooldownMs: 15_000,
  });

  isAvailable(): boolean {
    return true;
  }

  async searchByIsbn(
    isbn: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit | null> {
    const cleanIsbn = normalizeIsbn(isbn);
    if (!cleanIsbn) {
      return null;
    }

    const url = `https://inventaire.io/api/entities?action=by-uris&uris=isbn:${encodeURIComponent(cleanIsbn)}`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3200);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      entities?: Record<string, InventaireEntity>;
    };
    const entities = data?.entities ? Object.values(data.entities) : [];
    if (entities.length === 0) {
      return null;
    }

    const entity = entities[0];
    const title = pickEnglishOrFirst(entity.labels);
    if (!title) {
      return null;
    }

    const coverUrl = resolveInventaireImageUrl(entity.image?.url);
    const pubDate = entity.claims?.['wdt:P577']?.[0]?.slice(0, 10) || '';
    const seriesOrdinal = entity.claims?.['wdt:P1545']?.[0];
    const desc = pickEnglishOrFirst(entity.descriptions);

    const additionalCovers: CoverCandidate[] = coverUrl
      ? [
          {
            url: coverUrl,
            source: this.name,
            resolutionTier: 'high',
            widthHint: 600,
            label: 'Inventaire · Commons Cover',
          },
        ]
      : [];

    return {
      providerId: this.id,
      providerName: this.name,
      title: normalizeTitle(title),
      author: 'Unknown Author',
      isbn: cleanIsbn,
      coverUrl,
      coverResolutionTier: coverUrl ? 'high' : undefined,
      additionalCovers,
      publishedDate: pubDate,
      series: seriesOrdinal ? `Book #${seriesOrdinal}` : undefined,
      synopsis: desc ? normalizeText(desc) : undefined,
    };
  }

  async searchByQuery(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<ProviderBookHit[]> {
    const searchStr = [query.title, query.author, query.rawQuery]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!searchStr) {
      return [];
    }

    const url = `https://inventaire.io/api/entities?action=search&types=works&search=${encodeURIComponent(searchStr)}&limit=5`;
    const response = await fetchWithProviderTimeout(url, {signal}, 3200);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      results?: Array<{
        label?: string;
        description?: string;
        image?: string;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results
      .filter(r => Boolean(r.label))
      .map(r => {
        const coverUrl = resolveInventaireImageUrl(r.image);
        const additionalCovers: CoverCandidate[] = coverUrl
          ? [
              {
                url: coverUrl,
                source: this.name,
                resolutionTier: 'high',
                widthHint: 600,
                label: 'Inventaire · Wikidata',
              },
            ]
          : [];
        return {
          providerId: this.id,
          providerName: this.name,
          title: normalizeTitle(r.label || 'Unknown Title'),
          author: normalizeName(query.author || 'Unknown Author'),
          isbn: normalizeIsbn(query.isbn || ''),
          coverUrl,
          coverResolutionTier: coverUrl ? 'high' : undefined,
          additionalCovers,
          synopsis: r.description ? normalizeText(r.description) : undefined,
        };
      });
  }
}
