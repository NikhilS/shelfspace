import {TRPCError} from '@trpc/server';
import {
  type EnrichmentStageProgressLabel,
  type EnrichmentTier,
  TIER_EXECUTION_PROFILES,
} from '../../constants/enrichment';
import {findEnrichmentDescriptor} from '../../constants/enrichmentDescriptors';
import {SchemaValidationError} from '../../schemas/common';
import type {
  CoreBookData,
  EnrichmentPipelineStage,
  MetadataBulkFetchOptions,
  MetadataPlugin,
  MetadataProvider,
  StageEscalationState,
} from '../../types/metadata';
import {
  bookDetailsDocConverter,
  bookDocConverter,
} from './book/bookPartitioner';
import {formatFirestoreAdminError, getAdminDb} from './firebaseAdmin';
import {LibraryService} from './library';
import {MetadataRegistry} from './metadata';
import {mergeBonusCatalogFields} from './metadata/bonusCatalogPatcher';
import {
  commitPendingEnrichmentWrites,
  createEnrichmentWriteCollector,
  isNonEmptyMetadataValue,
} from './metadata/enrichmentWriteBuilder';
import {
  getBuiltInMetadataPluginSpec,
  type MetadataPluginSpec,
} from './metadata/pluginSpecs';
import {executePluginStagesHorizontally} from './metadata/stageRunner';

export type PerBookJobStage =
  | 'queued'
  | 'evaluating_decisions'
  | 'fetching_catalog'
  | 'fetching_ai'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface PerBookProgressUpdate {
  bookId: string;
  stage: PerBookJobStage;
  winningProviders?: Record<string, string>;
  updatedFields?: string[];
  error?: string;
}

export interface BatchEnrichmentCallbacks {
  signal?: AbortSignal;
  onBookProgress?: (update: PerBookProgressUpdate) => void;
}

export interface TriggerBatchEnrichmentInput {
  libraryId: string;
  enrichmentType?: string;
  bookIds: string[];
  overwrite?: boolean;
  customGenres?: string[];
  allowAiFallback?: boolean;
}

export interface PipelineStageDescriptor {
  readonly stageIndex: number;
  readonly id: string;
  readonly tier: EnrichmentTier;
  readonly microBatchSize: number;
  readonly progressStage: EnrichmentStageProgressLabel;
}

export interface EscalatedBookContext {
  bookId: string;
  state: StageEscalationState<unknown>;
}

export interface TriggerBatchEnrichmentOptions {
  skipAccessCheck?: boolean;
  stageIndex?: number;
  priorEscalations?: ReadonlyMap<string, StageEscalationState<unknown>>;
  callbacks?: BatchEnrichmentCallbacks;
}

export interface TriggerBatchEnrichmentResult {
  status: 'success';
  enrichmentType: string;
  processedCount: number;
  results: Array<Record<string, unknown>>;
  escalatedBooks?: EscalatedBookContext[];
  prunedCount?: number;
}

function resolvePluginCapabilities(
  provider: MetadataProvider<unknown>,
  fallbackSpec?: MetadataPluginSpec<unknown>,
): MetadataPluginSpec<unknown> | undefined {
  const candidate = provider as Partial<MetadataPlugin<unknown>>;
  if (
    typeof candidate.toPersistencePatch === 'function' &&
    candidate.statusKey
  ) {
    return {
      statusKey: candidate.statusKey,
      needsSynopsis: Boolean(candidate.needsSynopsis),
      supportsHybridAiFallback: Boolean(candidate.supportsHybridAiFallback),
      outputSchema: candidate.outputSchema,
      toPersistencePatch: context => candidate.toPersistencePatch!(context),
    };
  }
  return fallbackSpec;
}

function getPluginStages(
  provider?: MetadataProvider<unknown>,
): ReadonlyArray<EnrichmentPipelineStage<unknown>> | undefined {
  const stages = (provider as Partial<MetadataPlugin<unknown>> | undefined)
    ?.stages;
  return stages && stages.length > 0 ? stages : undefined;
}

export class EnrichmentService {
  /**
   * Introspects the declarative `EnrichmentPipelineStage[]` registered on a
   * `MetadataPlugin` so job coordinators derive wave order, micro-batch sizes,
   * and SSE progress labels generically without per-field branching.
   */
  static getPipelineStages(rawType: string): PipelineStageDescriptor[] {
    const descriptor = findEnrichmentDescriptor(rawType);
    if (!descriptor) {
      const fallbackProfile = TIER_EXECUTION_PROFILES.decision;
      return [
        {
          stageIndex: 0,
          id: 'default-decision',
          tier: 'decision',
          microBatchSize: fallbackProfile.microBatchSize,
          progressStage: fallbackProfile.progressStage,
        },
      ];
    }

    const registry = MetadataRegistry.getInstance();
    const provider = registry?.getProvider?.(descriptor.key);
    const stages = getPluginStages(provider);

    if (stages) {
      return stages.map((stage, stageIndex) => {
        const profile = TIER_EXECUTION_PROFILES[stage.tier];
        return {
          stageIndex,
          id: stage.id,
          tier: stage.tier,
          microBatchSize: Math.max(1, profile.microBatchSize),
          progressStage: profile.progressStage,
        };
      });
    }

    const fallbackTier: EnrichmentTier =
      descriptor.statusKey === 'embedding'
        ? 'embedding'
        : descriptor.isCatalogPrimary
          ? 'catalog'
          : 'decision';
    const fallbackProfile = TIER_EXECUTION_PROFILES[fallbackTier];
    return [
      {
        stageIndex: 0,
        id: `${descriptor.statusKey}-${fallbackTier}`,
        tier: fallbackTier,
        microBatchSize: Math.max(1, fallbackProfile.microBatchSize),
        progressStage: fallbackProfile.progressStage,
      },
    ];
  }

  /**
   * Executes server-orchestrated batch metadata enrichment for a set of books
   * using the unified MetadataRegistry and typed MetadataPlugin contracts.
   * Supports both single-wave execution (`options.stageIndex`) for streaming
   * horizontal sieve jobs and full multi-stage execution for direct RPC calls.
   */
  static async triggerBatchEnrichment(
    userId: string,
    userEmail: string | undefined,
    input: TriggerBatchEnrichmentInput,
    options?: TriggerBatchEnrichmentOptions,
  ): Promise<TriggerBatchEnrichmentResult> {
    const {libraryId, bookIds} = input;
    const rawType = input.enrichmentType || 'genre';
    const callbacks = options?.callbacks;

    if (!options?.skipAccessCheck) {
      await LibraryService.verifyLibraryAccess(
        userId,
        userEmail,
        libraryId,
        'editor',
      );
    }

    const descriptor = findEnrichmentDescriptor(rawType);
    if (!descriptor) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported enrichment type: '${rawType}'`,
      });
    }

    const {
      key: metadataKey,
      statusKey,
      providerLabel,
      isCatalogPrimary,
    } = descriptor;

    if (!bookIds || bookIds.length === 0) {
      return {
        status: 'success',
        enrichmentType: statusKey,
        processedCount: 0,
        results: [],
      };
    }

    const registry = MetadataRegistry.getInstance();
    const provider = registry.getProvider(metadataKey);

    if (!provider || !provider.isAvailable()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Metadata provider for '${statusKey}' is currently unavailable.`,
      });
    }

    const pluginSpec = resolvePluginCapabilities(
      provider,
      getBuiltInMetadataPluginSpec(metadataKey),
    );
    if (!pluginSpec) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `No persistence specification registered for '${statusKey}'.`,
      });
    }

    const pluginStages = getPluginStages(provider);

    try {
      const db = getAdminDb();
      const booksCollection = db
        .collection('libraries')
        .doc(libraryId)
        .collection('books');
      const detailsCollection = db
        .collection('libraries')
        .doc(libraryId)
        .collection('bookDetails');

      const validBooks: Array<{
        bookData: CoreBookData;
        rawDoc: Record<string, unknown>;
      }> = [];

      if (callbacks?.signal?.aborted) {
        return {
          status: 'success',
          enrichmentType: statusKey,
          processedCount: 0,
          results: [],
        };
      }

      const bookRefs = bookIds.map(bookId => booksCollection.doc(bookId));
      const bookSnaps = await db.getAll(...bookRefs);

      const missingSynopsisIndices: Array<{
        bookId: string;
        validIndex: number;
      }> = [];

      for (let i = 0; i < bookIds.length; i++) {
        if (callbacks?.signal?.aborted) {
          break;
        }
        const bookId = bookIds[i];
        const snap = bookSnaps[i];
        if (!snap?.exists) {
          callbacks?.onBookProgress?.({
            bookId,
            stage: 'skipped',
          });
          continue;
        }

        const rawDoc = (snap.data?.() || {}) as Record<string, unknown>;
        const parsedBook = bookDocConverter.fromFirestore(
          bookId,
          rawDoc,
          `/libraries/${libraryId}/books/${bookId}`,
        );
        const title =
          typeof rawDoc.title === 'string' ? rawDoc.title.trim() : '';
        if (!title) {
          callbacks?.onBookProgress?.({
            bookId,
            stage: 'skipped',
          });
          continue;
        }

        const priorEscalation = options?.priorEscalations?.get(bookId);
        const baseBookData: CoreBookData = {
          ...parsedBook,
          id: bookId,
          title,
          author: parsedBook.author,
          isbn: parsedBook.isbn,
          primaryGenre: parsedBook.primaryGenre ?? undefined,
          subgenres: parsedBook.subgenres,
        };
        const mergedBookData: CoreBookData = priorEscalation?.enrichedBook
          ? {
              ...baseBookData,
              ...priorEscalation.enrichedBook,
              id: bookId,
            }
          : baseBookData;

        const validIndex = validBooks.length;
        validBooks.push({
          rawDoc: parsedBook,
          bookData: mergedBookData,
        });

        if (!mergedBookData.synopsis && pluginSpec.needsSynopsis) {
          missingSynopsisIndices.push({bookId, validIndex});
        }
      }

      if (missingSynopsisIndices.length > 0 && !callbacks?.signal?.aborted) {
        try {
          const detailRefs = missingSynopsisIndices.map(item =>
            detailsCollection.doc(item.bookId),
          );
          const detailSnaps = await db.getAll(...detailRefs);

          for (let i = 0; i < missingSynopsisIndices.length; i++) {
            const detailSnap = detailSnaps[i];
            if (detailSnap?.exists) {
              const detailBookId = missingSynopsisIndices[i].bookId;
              const detailData = bookDetailsDocConverter.fromFirestore(
                detailBookId,
                detailSnap.data?.() || {},
                `/libraries/${libraryId}/bookDetails/${detailBookId}`,
              );
              const detailSyn =
                typeof detailData.synopsis === 'string' &&
                detailData.synopsis.trim()
                  ? detailData.synopsis.trim()
                  : undefined;
              if (detailSyn) {
                const target = validBooks[missingSynopsisIndices[i].validIndex];
                if (target) {
                  target.bookData.synopsis = detailSyn;
                }
              }
            }
          }
        } catch (err) {
          if (err instanceof SchemaValidationError) {
            throw err;
          }
        }
      }

      if (validBooks.length === 0 || callbacks?.signal?.aborted) {
        return {
          status: 'success',
          enrichmentType: statusKey,
          processedCount: 0,
          results: [],
        };
      }

      const fetchOptions: MetadataBulkFetchOptions = {
        signal: callbacks?.signal,
        allowAiFallback: input.allowAiFallback,
        customGenres: input.customGenres,
      };

      const escalatedBooks: EscalatedBookContext[] = [];
      const collector = createEnrichmentWriteCollector({
        libraryId,
        statusKey,
        providerLabel,
        allowAiFallback: input.allowAiFallback,
        pluginSpec,
        booksCollection,
        detailsCollection,
        nowIso: new Date().toISOString(),
      });

      if (pluginStages && typeof options?.stageIndex === 'number') {
        const targetStage = pluginStages[options.stageIndex];
        if (!targetStage) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
            escalatedBooks: [],
            prunedCount: 0,
          };
        }

        const stageProfile = TIER_EXECUTION_PROFILES[targetStage.tier];
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: stageProfile.progressStage,
            });
          }
        }

        const stageOutcomes = await targetStage.execute({
          books: validBooks.map(v => v.bookData),
          options: fetchOptions,
          priorEscalations: options.priorEscalations,
        });

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        const hasRunnableSubsequentStage = pluginStages
          .slice(options.stageIndex + 1)
          .some(
            nextStage =>
              !(
                input.allowAiFallback === false &&
                TIER_EXECUTION_PROFILES[nextStage.tier].requiresAi
              ),
          );

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const prior = options.priorEscalations?.get(bookId);
          const outcome = stageOutcomes.get(bookId);
          const mergedBonus = mergeBonusCatalogFields(
            prior?.bonusCatalog,
            outcome?.bonusCatalog,
          );

          if (
            outcome?.status === 'resolved' &&
            isNonEmptyMetadataValue(outcome.value)
          ) {
            collector.commitResolvedBook({
              bookData,
              rawDoc,
              value: outcome.value,
              winningProvider: outcome.winningProvider,
              bonusCatalog: mergedBonus,
            });
          } else if (outcome?.status === 'pruned') {
            collector.commitPrunedBook({
              bookData,
              rawDoc,
              bonusCatalog: mergedBonus,
            });
          } else if (outcome?.status === 'escalate') {
            const nextFallback =
              outcome.fallbackValue !== undefined
                ? outcome.fallbackValue
                : prior?.fallbackValue;
            const mergedEnrichedPatch =
              prior?.enrichedBook || outcome.enrichedBook
                ? {
                    ...(prior?.enrichedBook ?? {}),
                    ...(outcome.enrichedBook ?? {}),
                  }
                : undefined;

            if (hasRunnableSubsequentStage) {
              escalatedBooks.push({
                bookId,
                state: {
                  ...(mergedEnrichedPatch
                    ? {enrichedBook: mergedEnrichedPatch}
                    : {}),
                  ...(nextFallback !== undefined
                    ? {fallbackValue: nextFallback}
                    : {}),
                  ...(mergedBonus ? {bonusCatalog: mergedBonus} : {}),
                },
              });
            } else if (isNonEmptyMetadataValue(nextFallback)) {
              collector.commitResolvedBook({
                bookData,
                rawDoc,
                value: nextFallback,
                bonusCatalog: mergedBonus,
              });
            } else {
              collector.commitUnresolvedBook({
                bookData,
                rawDoc,
                bonusCatalog: mergedBonus,
              });
            }
          } else if (isNonEmptyMetadataValue(prior?.fallbackValue)) {
            collector.commitResolvedBook({
              bookData,
              rawDoc,
              value: prior!.fallbackValue,
              bonusCatalog: mergedBonus,
            });
          } else {
            collector.commitUnresolvedBook({
              bookData,
              rawDoc,
              bonusCatalog: mergedBonus,
            });
          }
        }
      } else if (pluginStages) {
        const firstStageProfile = TIER_EXECUTION_PROFILES[pluginStages[0].tier];
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: firstStageProfile.progressStage,
            });
          }
        }

        const horizontalRun = await executePluginStagesHorizontally(
          pluginStages,
          validBooks.map(v => v.bookData),
          fetchOptions,
        );

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const outcome = horizontalRun.outcomes.get(bookId);

          if (
            outcome?.status === 'resolved' &&
            isNonEmptyMetadataValue(outcome.value)
          ) {
            collector.commitResolvedBook({
              bookData,
              rawDoc,
              value: outcome.value,
              winningProvider: outcome.winningProvider,
              bonusCatalog: outcome.bonusCatalog,
            });
          } else if (outcome?.status === 'pruned') {
            collector.commitPrunedBook({
              bookData,
              rawDoc,
              bonusCatalog: outcome.bonusCatalog,
            });
          } else {
            collector.commitUnresolvedBook({
              bookData,
              rawDoc,
              bonusCatalog:
                outcome?.bonusCatalog ??
                horizontalRun.unresolvedBonusByBookId.get(bookId),
            });
          }
        }
      } else {
        if (callbacks?.onBookProgress) {
          for (const item of validBooks) {
            callbacks.onBookProgress({
              bookId: item.bookData.id,
              stage: isCatalogPrimary ? 'fetching_catalog' : 'fetching_ai',
            });
          }
        }

        const extractedMap = await provider.bulkFetch(
          validBooks.map(v => v.bookData),
          fetchOptions,
        );

        if (callbacks?.signal?.aborted) {
          return {
            status: 'success',
            enrichmentType: statusKey,
            processedCount: 0,
            results: [],
          };
        }

        for (const {bookData, rawDoc} of validBooks) {
          if (callbacks?.signal?.aborted) {
            break;
          }
          const bookId = bookData.id;
          const value = extractedMap ? extractedMap[bookId] : undefined;

          if (isNonEmptyMetadataValue(value)) {
            collector.commitResolvedBook({
              bookData,
              rawDoc,
              value,
            });
          } else {
            collector.commitUnresolvedBook({
              bookData,
              rawDoc,
            });
          }
        }
      }

      if (collector.pendingWrites.length > 0 && !callbacks?.signal?.aborted) {
        await commitPendingEnrichmentWrites(db, collector.pendingWrites);
      }

      if (callbacks?.onBookProgress && !callbacks?.signal?.aborted) {
        for (const progressUpdate of collector.pendingProgressUpdates) {
          callbacks.onBookProgress(progressUpdate);
        }
      }

      return {
        status: 'success',
        enrichmentType: statusKey,
        processedCount: collector.getProcessedCount(),
        results: collector.results,
        ...(typeof options?.stageIndex === 'number'
          ? {escalatedBooks, prunedCount: collector.getPrunedCount()}
          : {}),
      };
    } catch (err: unknown) {
      if (err instanceof TRPCError || err instanceof SchemaValidationError) {
        throw err;
      }
      const errMsg = formatFirestoreAdminError(err);
      console.error(
        `[EnrichmentService] Error in triggerBatchEnrichment (${statusKey}):`,
        errMsg,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to enrich metadata (${statusKey}): ${errMsg}`,
      });
    }
  }
}
