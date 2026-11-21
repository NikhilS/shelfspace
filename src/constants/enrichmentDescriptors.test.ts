import {describe, expect, it} from 'vitest';
import type {Book} from '../types';
import {MetadataKey} from '../types/metadata';
import {
  ENRICHMENT_DESCRIPTORS,
  findEnrichmentDescriptor,
  formatEnrichmentProviderList,
  formatEnrichmentProviderName,
  isEnrichmentMetadataPresent,
  requiresAiPlanForEnrichment,
} from './enrichmentDescriptors';

function createSampleBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('enrichmentDescriptors isomorphic manifest', () => {
  it('resolves canonical statusKeys and MetadataKey enums while rejecting unknown or deprecated tokens', () => {
    expect(ENRICHMENT_DESCRIPTORS).toHaveLength(8);
    for (const descriptor of ENRICHMENT_DESCRIPTORS) {
      expect(descriptor.key).toBe(descriptor.statusKey);
    }
    expect(findEnrichmentDescriptor('geo')?.statusKey).toBe('geo');
    expect(findEnrichmentDescriptor(MetadataKey.GEO)?.statusKey).toBe('geo');
    expect(findEnrichmentDescriptor(MetadataKey.TEMPORAL)?.statusKey).toBe(
      'temporal',
    );
    expect(findEnrichmentDescriptor(MetadataKey.GENRE)?.statusKey).toBe(
      'genre',
    );
    expect(findEnrichmentDescriptor(MetadataKey.COVER_IMAGE)?.statusKey).toBe(
      'coverImage',
    );
    expect(findEnrichmentDescriptor(MetadataKey.EMBEDDING)?.statusKey).toBe(
      'embedding',
    );
    expect(findEnrichmentDescriptor(MetadataKey.AUTHOR_BIO)?.statusKey).toBe(
      'authorBio',
    );
    expect(findEnrichmentDescriptor('geoMetadata')).toBeUndefined();
    expect(findEnrichmentDescriptor('temporalMetadata')).toBeUndefined();
    expect(findEnrichmentDescriptor('primaryGenre')).toBeUndefined();
    expect(findEnrichmentDescriptor('embeddings')).toBeUndefined();
    expect(findEnrichmentDescriptor('coverUrl')).toBeUndefined();
    expect(findEnrichmentDescriptor('sanitize')).toBeUndefined();
    expect(findEnrichmentDescriptor('heavyDetails')).toBeUndefined();
    expect(findEnrichmentDescriptor('unknown-flow')).toBeUndefined();
  });

  it('flags AI-plan requirements accurately for pure-AI vs catalog-primary dimensions', () => {
    expect(requiresAiPlanForEnrichment('geo')).toBe(true);
    expect(requiresAiPlanForEnrichment('temporal')).toBe(true);
    expect(requiresAiPlanForEnrichment('genre')).toBe(true);
    expect(requiresAiPlanForEnrichment('embedding')).toBe(true);

    expect(requiresAiPlanForEnrichment('synopsis')).toBe(false);
    expect(requiresAiPlanForEnrichment('authorBio')).toBe(false);
    expect(requiresAiPlanForEnrichment('series')).toBe(false);
    expect(requiresAiPlanForEnrichment('coverImage')).toBe(false);
  });

  it('evaluates field presence consistently across book fields and enrichmentStatus markers', () => {
    const bareBook = createSampleBook();
    for (const descriptor of ENRICHMENT_DESCRIPTORS) {
      expect(isEnrichmentMetadataPresent(bareBook, descriptor.key)).toBe(false);
    }

    const enrichedBook = createSampleBook({
      primaryGenre: 'Literary Fiction',
      coverUrl: 'https://example.com/cover.jpg',
      series: 'Calvino Classics #1',
      geoMetadata: {isNonEarth: true, locations: []},
      temporalMetadata: {startYear: 1275, eraName: 'High Middle Ages'},
      bookDetailsMetadata: {
        hasSynopsis: true,
        hasAuthorBio: true,
        hasEmbedding: true,
      },
    });
    for (const descriptor of ENRICHMENT_DESCRIPTORS) {
      expect(isEnrichmentMetadataPresent(enrichedBook, descriptor.key)).toBe(
        true,
      );
    }

    const unsupportedGeoBook = createSampleBook({
      enrichmentStatus: {geo: 'unsupported'},
    });
    expect(
      isEnrichmentMetadataPresent(unsupportedGeoBook, MetadataKey.GEO),
    ).toBe(true);
  });

  it('formats provider identifiers cleanly into display labels', () => {
    expect(formatEnrichmentProviderName('penguin-random-house')).toBe(
      'Penguin Random House',
    );
    expect(formatEnrichmentProviderName('custom_catalog_source')).toBe(
      'Custom Catalog Source',
    );
    expect(
      formatEnrichmentProviderList(
        ['open_library', 'google_books', 'hardcover'],
        2,
      ),
    ).toBe('Open Library, Google Books +1 more');
  });

  it('computes Shelf Care core completeness without requiring series or embeddings', async () => {
    const {isBookMissingCoreEnrichment} =
      await import('./enrichmentDescriptors');
    expect(isBookMissingCoreEnrichment(createSampleBook())).toBe(true);

    const coreCompleteBook = createSampleBook({
      coverUrl: 'https://example.com/cover.jpg',
      primaryGenre: 'History',
      geoMetadata: {isNonEarth: true, locations: []},
      temporalMetadata: {startYear: 1920, eraName: 'Interwar'},
      bookDetailsMetadata: {
        hasSynopsis: true,
        hasAuthorBio: true,
        hasEmbedding: false,
      },
    });
    expect(isBookMissingCoreEnrichment(coreCompleteBook)).toBe(false);
  });
});
