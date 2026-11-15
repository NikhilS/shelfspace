import type {
  BonusCatalogFields,
  CoreBookData,
  EnrichmentPipelineStage,
  MetadataBulkFetchOptions,
  StageBookOutcome,
  StageEscalationState,
} from '../../../types/metadata';
import {mergeBonusCatalogFields} from './bonusCatalogPatcher';

export interface HorizontalPipelineRunResult<Output> {
  outcomes: Map<string, StageBookOutcome<Output>>;
  residualEscalations: Map<string, StageEscalationState<Output>>;
  unresolvedBonusByBookId: Map<string, BonusCatalogFields>;
}

/**
 * Safely resolves a named function export from a module namespace without
 * crashing when tests supply partial ESM mocks (`vi.mock('./module', () => ...)`).
 */
export function getOptionalModuleFunction<Fn>(
  mod: object,
  exportName: string,
): Fn | undefined {
  try {
    const candidate = (mod as Record<string, unknown>)[exportName];
    return typeof candidate === 'function' ? (candidate as Fn) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes a plugin's declarative `EnrichmentPipelineStage[]` horizontally:
 * Stage 0 runs across all eligible books first; Stage 1 runs strictly on the
 * residual books that returned `{status: 'escalate'}`, and so on.
 */
export async function executePluginStagesHorizontally<Output>(
  stages: ReadonlyArray<EnrichmentPipelineStage<Output>>,
  books: CoreBookData[],
  options?: MetadataBulkFetchOptions,
): Promise<HorizontalPipelineRunResult<Output>> {
  const outcomes = new Map<string, StageBookOutcome<Output>>();
  const unresolvedBonusByBookId = new Map<string, BonusCatalogFields>();

  if (books.length === 0 || stages.length === 0 || options?.signal?.aborted) {
    return {
      outcomes,
      residualEscalations: new Map(),
      unresolvedBonusByBookId,
    };
  }

  let activeBooks: CoreBookData[] = [...books];
  let priorEscalations = new Map<string, StageEscalationState<Output>>();

  for (const stage of stages) {
    if (activeBooks.length === 0 || options?.signal?.aborted) {
      break;
    }

    const stageOutcomes = await stage.execute({
      books: activeBooks,
      options,
      priorEscalations,
    });

    const nextBooks: CoreBookData[] = [];
    const nextEscalations = new Map<string, StageEscalationState<Output>>();

    for (const book of activeBooks) {
      const outcome = stageOutcomes.get(book.id);
      const prior = priorEscalations.get(book.id);

      if (!outcome) {
        if (prior && prior.fallbackValue !== undefined) {
          outcomes.set(book.id, {
            status: 'resolved',
            value: prior.fallbackValue,
            ...(prior.bonusCatalog ? {bonusCatalog: prior.bonusCatalog} : {}),
          });
        } else if (prior?.bonusCatalog) {
          unresolvedBonusByBookId.set(book.id, prior.bonusCatalog);
        }
        continue;
      }

      const mergedBonus = mergeBonusCatalogFields(
        prior?.bonusCatalog,
        outcome.bonusCatalog,
      );

      if (outcome.status === 'resolved') {
        outcomes.set(book.id, {
          ...outcome,
          ...(mergedBonus ? {bonusCatalog: mergedBonus} : {}),
        });
      } else if (outcome.status === 'pruned') {
        outcomes.set(book.id, {
          ...outcome,
          ...(mergedBonus ? {bonusCatalog: mergedBonus} : {}),
        });
      } else {
        const mergedEnrichedPatch: Partial<CoreBookData> | undefined =
          prior?.enrichedBook || outcome.enrichedBook
            ? {
                ...(prior?.enrichedBook ?? {}),
                ...(outcome.enrichedBook ?? {}),
              }
            : undefined;
        const mergedBook: CoreBookData = mergedEnrichedPatch
          ? {...book, ...mergedEnrichedPatch}
          : book;

        nextBooks.push(mergedBook);
        nextEscalations.set(book.id, {
          ...(mergedEnrichedPatch ? {enrichedBook: mergedEnrichedPatch} : {}),
          ...(outcome.fallbackValue !== undefined
            ? {fallbackValue: outcome.fallbackValue}
            : prior?.fallbackValue !== undefined
              ? {fallbackValue: prior.fallbackValue}
              : {}),
          ...(mergedBonus ? {bonusCatalog: mergedBonus} : {}),
        });
      }
    }

    activeBooks = nextBooks;
    priorEscalations = nextEscalations;
  }

  if (!options?.signal?.aborted && activeBooks.length > 0) {
    for (const book of activeBooks) {
      const prior = priorEscalations.get(book.id);
      if (prior && prior.fallbackValue !== undefined) {
        outcomes.set(book.id, {
          status: 'resolved',
          value: prior.fallbackValue,
          ...(prior.bonusCatalog ? {bonusCatalog: prior.bonusCatalog} : {}),
        });
        priorEscalations.delete(book.id);
      } else if (prior?.bonusCatalog) {
        unresolvedBonusByBookId.set(book.id, prior.bonusCatalog);
      }
    }
  }

  return {
    outcomes,
    residualEscalations: priorEscalations,
    unresolvedBonusByBookId,
  };
}

/**
 * Helper so `MetadataPlugin.bulkFetch(books, options)` delegates directly to
 * the plugin's declarative `stages` with zero duplicated logic.
 */
export async function runPluginStagesToRecord<Output>(
  stages: ReadonlyArray<EnrichmentPipelineStage<Output>>,
  books: CoreBookData[],
  options?: MetadataBulkFetchOptions,
  recordOptions?: {
    hasDefaultUnresolvedValue?: boolean;
    defaultUnresolvedValue?: Output;
  },
): Promise<Record<string, Output>> {
  const results: Record<string, Output> = {};

  if (recordOptions?.hasDefaultUnresolvedValue) {
    for (const book of books) {
      results[book.id] = recordOptions.defaultUnresolvedValue as Output;
    }
  }

  if (books.length === 0 || options?.signal?.aborted) {
    return results;
  }

  const {outcomes} = await executePluginStagesHorizontally(
    stages,
    books,
    options,
  );
  for (const [bookId, outcome] of outcomes.entries()) {
    if (outcome.status === 'resolved') {
      results[bookId] = outcome.value;
    }
  }

  return results;
}
