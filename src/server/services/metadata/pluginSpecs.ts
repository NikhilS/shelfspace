import type {z} from 'zod';
import {computeBookSearchTokens} from '../../../lib/duplicateDetection';
import type {
  BookGeoMetadata,
  BookTemporalMetadata,
} from '../../../schemas/book';
import {
  type BookGenreData,
  type CanonicalEnrichmentType,
  MetadataKey,
  type MetadataPersistenceContext,
  type MetadataPersistencePatch,
} from '../../../types/metadata';

export interface MetadataPluginSpec<Output = unknown> {
  readonly statusKey: CanonicalEnrichmentType;
  readonly needsSynopsis: boolean;
  readonly supportsHybridAiFallback: boolean;
  readonly outputSchema?: z.ZodType<Output>;
  toPersistencePatch(
    context: MetadataPersistenceContext<Output>,
  ): MetadataPersistencePatch;
}

const BUILT_IN_PLUGIN_SPECS: Readonly<
  Partial<Record<MetadataKey, MetadataPluginSpec<unknown>>>
> = {
  [MetadataKey.GEO]: {
    statusKey: 'geo',
    needsSynopsis: true,
    supportsHybridAiFallback: false,
    toPersistencePatch({book, value, existingStatus}) {
      const geoVal = value as BookGeoMetadata | null | undefined;
      const resolvedStatus = geoVal?.isNonEarth ? 'unsupported' : 'completed';
      return {
        bookUpdate: {
          geoMetadata: value,
          enrichmentStatus: {
            ...existingStatus,
            geo: resolvedStatus,
          },
        },
        resultPreview: {
          id: book.id,
          geoMetadata: value,
        },
      };
    },
  },
  [MetadataKey.TEMPORAL]: {
    statusKey: 'temporal',
    needsSynopsis: true,
    supportsHybridAiFallback: false,
    toPersistencePatch({book, value, existingStatus}) {
      const tempVal = value as BookTemporalMetadata | null | undefined;
      const resolvedStatus = tempVal?.isNonHistorical
        ? 'unsupported'
        : 'completed';
      return {
        bookUpdate: {
          temporalMetadata: value,
          enrichmentStatus: {
            ...existingStatus,
            temporal: resolvedStatus,
          },
        },
        resultPreview: {
          id: book.id,
          temporalMetadata: value,
        },
      };
    },
  },
  [MetadataKey.GENRE]: {
    statusKey: 'genre',
    needsSynopsis: true,
    supportsHybridAiFallback: false,
    toPersistencePatch({book, value, existingStatus}) {
      const genreVal = value as BookGenreData;
      const subgenres = genreVal.subgenres || [];
      const isCustomPrimary = Boolean(genreVal.isCustomPrimary);
      return {
        bookUpdate: {
          primaryGenre: genreVal.primaryGenre,
          subgenres,
          isCustomPrimary,
          enrichmentStatus: {
            ...existingStatus,
            genre: 'completed',
          },
        },
        resultPreview: {
          id: book.id,
          primaryGenre: genreVal.primaryGenre,
          subgenres,
          isCustomPrimary,
        },
      };
    },
  },
  [MetadataKey.COVER_IMAGE]: {
    statusKey: 'coverImage',
    needsSynopsis: false,
    supportsHybridAiFallback: false,
    toPersistencePatch({book, value, existingStatus}) {
      return {
        bookUpdate: {
          coverUrl: value,
          enrichmentStatus: {
            ...existingStatus,
            coverImage: 'completed',
          },
        },
        resultPreview: {
          id: book.id,
          coverUrl: value,
        },
      };
    },
  },
  [MetadataKey.SERIES]: {
    statusKey: 'series',
    needsSynopsis: true,
    supportsHybridAiFallback: true,
    toPersistencePatch({book, value, existingStatus}) {
      const updatedSearchTokens = computeBookSearchTokens({
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        series: typeof value === 'string' ? value : undefined,
      });
      return {
        bookUpdate: {
          series: value,
          ...(updatedSearchTokens.length > 0
            ? {searchTokens: updatedSearchTokens}
            : {}),
          enrichmentStatus: {
            ...existingStatus,
            series: 'completed',
          },
        },
        resultPreview: {
          id: book.id,
          series: value,
        },
      };
    },
  },
  [MetadataKey.SYNOPSIS]: {
    statusKey: 'synopsis',
    needsSynopsis: false,
    supportsHybridAiFallback: true,
    toPersistencePatch({
      book,
      value,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    }) {
      const nextDetailsMeta = {
        ...existingDetailsMeta,
        hasSynopsis: true,
      };
      return {
        bookUpdate: {
          bookDetailsMetadata: nextDetailsMeta,
          enrichmentStatus: {
            ...existingStatus,
            synopsis: 'completed',
          },
        },
        detailsUpdate: {
          synopsis: value,
          updatedAt: nowIso,
        },
        resultPreview: {
          id: book.id,
          bookDetailsMetadata: nextDetailsMeta,
        },
      };
    },
  },
  [MetadataKey.AUTHOR_BIO]: {
    statusKey: 'authorBio',
    needsSynopsis: false,
    supportsHybridAiFallback: true,
    toPersistencePatch({
      book,
      value,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    }) {
      const nextDetailsMeta = {
        ...existingDetailsMeta,
        hasAuthorBio: true,
      };
      return {
        bookUpdate: {
          bookDetailsMetadata: nextDetailsMeta,
          enrichmentStatus: {
            ...existingStatus,
            authorBio: 'completed',
          },
        },
        detailsUpdate: {
          authorBio: value,
          updatedAt: nowIso,
        },
        resultPreview: {
          id: book.id,
          bookDetailsMetadata: nextDetailsMeta,
        },
      };
    },
  },
  [MetadataKey.EMBEDDING]: {
    statusKey: 'embedding',
    needsSynopsis: true,
    supportsHybridAiFallback: false,
    toPersistencePatch({
      book,
      value,
      existingStatus,
      existingDetailsMeta,
      nowIso,
    }) {
      const nextDetailsMeta = {
        ...existingDetailsMeta,
        hasEmbedding: true,
      };
      return {
        bookUpdate: {
          bookDetailsMetadata: nextDetailsMeta,
          enrichmentStatus: {
            ...existingStatus,
            embedding: 'completed',
          },
        },
        detailsUpdate: {
          embedding: value,
          updatedAt: nowIso,
        },
        resultPreview: {
          id: book.id,
          bookDetailsMetadata: nextDetailsMeta,
        },
      };
    },
  },
};

export function getBuiltInMetadataPluginSpec(
  key: MetadataKey,
): MetadataPluginSpec<unknown> | undefined {
  return BUILT_IN_PLUGIN_SPECS[key];
}
