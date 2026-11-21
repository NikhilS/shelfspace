import {z} from 'zod';
import {
  type CoreBookData,
  type EnrichmentPipelineStage,
  type MetadataBulkFetchOptions,
  MetadataKey,
  type MetadataPersistenceContext,
  type MetadataPersistencePatch,
  type MetadataPlugin,
  type StageBookOutcome,
} from '../../../../types/metadata';
import {generateBookEmbeddings} from '../../gemini';
import {runPluginStagesToRecord} from '../stageRunner';

const embeddingPluginOutputSchema: z.ZodType<number[]> = z.array(z.number());

export class EmbeddingMetadataProvider implements MetadataPlugin<number[]> {
  readonly statusKey = 'embedding' as const;
  readonly needsSynopsis = true;
  readonly supportsHybridAiFallback = false;
  readonly outputSchema = embeddingPluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<number[]>> = [
    {
      id: 'embedding-vector',
      tier: 'embedding',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<number[]>>();
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false
        ) {
          return outcomes;
        }

        const texts = books.map(b => this.buildEmbeddingText(b));
        const embeddings = await generateBookEmbeddings(texts, undefined, {
          priority: 'BATCH',
          signal: options?.signal,
        });

        if (embeddings && Array.isArray(embeddings)) {
          books.forEach((b, idx) => {
            if (embeddings[idx] && embeddings[idx].length > 0) {
              outcomes.set(b.id, {
                status: 'resolved',
                value: embeddings[idx],
                winningProvider: 'gemini_embedding',
              });
            }
          });
        }

        return outcomes;
      },
    },
  ];

  getKey(): MetadataKey {
    return MetadataKey.EMBEDDING;
  }

  private buildEmbeddingText(book: CoreBookData): string {
    const parts = [book.title];
    if (book.author) {
      parts.push(`by ${book.author}`);
    }
    if (book.primaryGenre) {
      const genreStr =
        book.subgenres && book.subgenres.length > 0
          ? `${book.primaryGenre}: ${book.subgenres.join(', ')}`
          : book.primaryGenre;
      parts.push(`[${genreStr}]`);
    }
    const syn = book.synopsis;
    if (syn && typeof syn === 'string') {
      parts.push(syn);
    }
    return parts.join(' - ');
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<number[]> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || [];
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, number[]>> {
    return runPluginStagesToRecord(this.stages, books, options);
  }

  toPersistencePatch({
    book,
    value,
    existingStatus,
    existingDetailsMeta,
    nowIso,
  }: MetadataPersistenceContext<number[]>): MetadataPersistencePatch {
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
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }
}
