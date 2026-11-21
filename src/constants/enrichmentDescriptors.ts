import type {Book} from '../types';
import {type CanonicalEnrichmentType, MetadataKey} from '../types/metadata';

export interface EnrichmentDescriptor {
  readonly key: MetadataKey;
  readonly statusKey: CanonicalEnrichmentType;
  readonly label: string;
  readonly providerLabel: string;
  readonly requiresAiPlan: boolean;
  readonly isCatalogPrimary: boolean;
  isPresent(book: Book): boolean;
}

export const ENRICHMENT_DESCRIPTORS: readonly EnrichmentDescriptor[] = [
  {
    key: MetadataKey.GEO,
    statusKey: 'geo',
    label: 'Settings & Places',
    providerLabel: 'Gemini Decisions + Catalog',
    requiresAiPlan: true,
    isCatalogPrimary: false,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        book.geoMetadata?.isNonEarth ||
        (Array.isArray(book.geoMetadata?.locations) &&
          book.geoMetadata.locations.length > 0) ||
        status.geo === 'completed' ||
        status.geo === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.TEMPORAL,
    statusKey: 'temporal',
    label: 'Historical Eras',
    providerLabel: 'Gemini Decisions + Catalog',
    requiresAiPlan: true,
    isCatalogPrimary: false,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        (book.temporalMetadata &&
          (book.temporalMetadata.isNonHistorical ||
            book.temporalMetadata.startYear !== undefined ||
            book.temporalMetadata.eraName ||
            book.temporalMetadata.rationale)) ||
        status.temporal === 'completed' ||
        status.temporal === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.GENRE,
    statusKey: 'genre',
    label: 'Genres',
    providerLabel: 'Gemini Decisions + Catalog',
    requiresAiPlan: true,
    isCatalogPrimary: false,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        (book.primaryGenre && book.primaryGenre.trim().length > 0) ||
        status.genre === 'completed' ||
        status.genre === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.SERIES,
    statusKey: 'series',
    label: 'Series',
    providerLabel: 'Decisions + Catalog + AI',
    requiresAiPlan: false,
    isCatalogPrimary: true,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        (book.series && book.series.trim().length > 0) ||
        status.series === 'completed' ||
        status.series === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.SYNOPSIS,
    statusKey: 'synopsis',
    label: 'Summaries',
    providerLabel: 'Catalog + Gemini AI',
    requiresAiPlan: false,
    isCatalogPrimary: true,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        book.bookDetailsMetadata?.hasSynopsis ||
        status.synopsis === 'completed' ||
        status.synopsis === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.AUTHOR_BIO,
    statusKey: 'authorBio',
    label: 'Author Bios',
    providerLabel: 'Wikipedia + Gemini AI',
    requiresAiPlan: false,
    isCatalogPrimary: true,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        book.bookDetailsMetadata?.hasAuthorBio ||
        status.authorBio === 'completed' ||
        status.authorBio === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.EMBEDDING,
    statusKey: 'embedding',
    label: 'Embeddings',
    providerLabel: 'Gemini Embeddings',
    requiresAiPlan: true,
    isCatalogPrimary: false,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        book.embedding?.length ||
        book.bookDetailsMetadata?.hasEmbedding ||
        status.embedding === 'completed' ||
        status.embedding === 'unsupported',
      );
    },
  },
  {
    key: MetadataKey.COVER_IMAGE,
    statusKey: 'coverImage',
    label: 'Cover Art',
    providerLabel: 'Multi-Source Catalog',
    requiresAiPlan: false,
    isCatalogPrimary: true,
    isPresent(book: Book): boolean {
      const status = book.enrichmentStatus || {};
      return Boolean(
        book.coverUrl ||
        book.coverUrlRaw ||
        status.coverImage === 'completed' ||
        status.coverImage === 'unsupported',
      );
    },
  },
];

const DESCRIPTOR_BY_TOKEN = new Map<string, EnrichmentDescriptor>();
for (const descriptor of ENRICHMENT_DESCRIPTORS) {
  DESCRIPTOR_BY_TOKEN.set(descriptor.key, descriptor);
}

export function findEnrichmentDescriptor(
  rawType?: string,
): EnrichmentDescriptor | undefined {
  if (!rawType) {
    return undefined;
  }
  return DESCRIPTOR_BY_TOKEN.get(rawType);
}

export function requiresAiPlanForEnrichment(rawType?: string): boolean {
  const matched = findEnrichmentDescriptor(rawType);
  return Boolean(matched?.requiresAiPlan);
}

export function isEnrichmentMetadataPresent(
  book: Book,
  key: MetadataKey,
): boolean {
  const descriptor = DESCRIPTOR_BY_TOKEN.get(key);
  if (descriptor) {
    return descriptor.isPresent(book);
  }
  const fallbackVal: unknown = Reflect.get(book, key);
  if (Array.isArray(fallbackVal)) {
    return fallbackVal.length > 0;
  }
  if (typeof fallbackVal === 'object' && fallbackVal !== null) {
    return Object.keys(fallbackVal).length > 0;
  }
  return Boolean(fallbackVal);
}

/**
 * Core enrichment dimensions checked by Shelf Care's missing-metadata badge counter.
 */
export const SHELF_CARE_COMPLETENESS_KEYS: readonly MetadataKey[] = [
  MetadataKey.COVER_IMAGE,
  MetadataKey.GENRE,
  MetadataKey.SYNOPSIS,
  MetadataKey.AUTHOR_BIO,
  MetadataKey.GEO,
  MetadataKey.TEMPORAL,
];

export function isBookMissingCoreEnrichment(book: Book): boolean {
  return SHELF_CARE_COMPLETENESS_KEYS.some(
    key => !isEnrichmentMetadataPresent(book, key),
  );
}

export const ENRICHMENT_PROVIDER_DISPLAY_NAMES: Readonly<
  Record<string, string>
> = {
  open_library: 'Open Library',
  'open-library': 'Open Library',
  google_books: 'Google Books',
  'google-books': 'Google Books',
  apple_books: 'Apple Books',
  'apple-books': 'Apple Books',
  penguin_random_house: 'Penguin Random House',
  'penguin-random-house': 'Penguin Random House',
  isbn_db: 'ISBNdb',
  library_of_congress: 'Library of Congress',
  'library-of-congress': 'Library of Congress',
  worldcat_classify: 'WorldCat',
  inventaire_wikidata: 'Inventaire',
  'inventaire-wikidata': 'Inventaire',
  longitood_cover: 'Longitood',
  'longitood-cover': 'Longitood',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  hardcover: 'Hardcover',
  crossref: 'Crossref',
  gemini_structured: 'Gemini AI',
  gemini_generative: 'Gemini AI',
  gemini_decisions: 'Gemini Decisions',
  gemini_embedding: 'Gemini Embeddings',
};

export function formatEnrichmentProviderName(rawId: string): string {
  if (ENRICHMENT_PROVIDER_DISPLAY_NAMES[rawId]) {
    return ENRICHMENT_PROVIDER_DISPLAY_NAMES[rawId];
  }
  return rawId
    .split(/[_-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatEnrichmentProviderList(
  ids: readonly string[],
  maxVisible = 2,
): string {
  const formatted = ids.map(formatEnrichmentProviderName);
  if (formatted.length <= maxVisible) {
    return formatted.join(', ');
  }
  const visible = formatted.slice(0, maxVisible).join(', ');
  return `${visible} +${formatted.length - maxVisible} more`;
}
