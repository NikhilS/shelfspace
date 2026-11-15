import {GENRE_CONFIDENCE_THRESHOLD} from '../../../constants/enrichment';
import {
  type BookGenreData,
  type CoreBookData,
  MetadataKey,
  type MetadataPlugin,
  type MetadataProvider,
} from '../../../types/metadata';
import {catalogOrchestrator} from '../catalog';
import * as geminiService from '../gemini';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {AuthorBioMetadataProvider} from './providers/AuthorBioMetadataProvider';
import {CoverImageMetadataProvider} from './providers/CoverImageMetadataProvider';
import {EmbeddingMetadataProvider} from './providers/EmbeddingMetadataProvider';
import {GenreMetadataProvider} from './providers/GenreMetadataProvider';
import {GeoMetadataProvider} from './providers/GeoMetadataProvider';
import {SeriesMetadataProvider} from './providers/SeriesMetadataProvider';
import {SynopsisMetadataProvider} from './providers/SynopsisMetadataProvider';
import {TemporalMetadataProvider} from './providers/TemporalMetadataProvider';
import {getOptionalModuleFunction} from './stageRunner';
import {registerSynopsisProviderResolver} from './utils';

export interface OnCreateEnrichmentOptions {
  allowAiFallback?: boolean;
  customGenres?: string[];
  priority?: SchedulePriority;
  signal?: AbortSignal;
}

export interface FastTierOnCreateResult {
  workingBooks: CoreBookData[];
  updatesByBookId: Map<string, Record<string, unknown>>;
  standaloneSeriesBookIds: Set<string>;
  lowConfidenceGenreBookIds: Set<string>;
}

export function mergeOnCreateUpdateMaps(
  first: ReadonlyMap<string, Record<string, unknown>>,
  second: ReadonlyMap<string, Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const allIds = new Set<string>([...first.keys(), ...second.keys()]);

  for (const bookId of allIds) {
    const a = first.get(bookId) ?? {};
    const b = second.get(bookId) ?? {};
    const combined: Record<string, unknown> = {...a, ...b};

    const statusA =
      a.enrichmentStatus && typeof a.enrichmentStatus === 'object'
        ? (a.enrichmentStatus as Record<string, unknown>)
        : undefined;
    const statusB =
      b.enrichmentStatus && typeof b.enrichmentStatus === 'object'
        ? (b.enrichmentStatus as Record<string, unknown>)
        : undefined;

    if (statusA || statusB) {
      combined.enrichmentStatus = {
        ...(statusA ?? {}),
        ...(statusB ?? {}),
      };
    }

    merged.set(bookId, combined);
  }

  return merged;
}

function isMetadataPlugin<Output = unknown>(
  provider: MetadataProvider<Output> | MetadataPlugin<Output>,
): provider is MetadataPlugin<Output> {
  return (
    typeof (provider as MetadataPlugin<Output>).toPersistencePatch ===
    'function'
  );
}

export class MetadataRegistry {
  private static instance: MetadataRegistry;
  private readonly providers = new Map<
    MetadataKey,
    MetadataProvider<unknown>
  >();
  private defaultsInitialized = false;

  private constructor() {
    registerSynopsisProviderResolver(() =>
      this.getProvider<string | null>(MetadataKey.SYNOPSIS),
    );
  }

  static getInstance(): MetadataRegistry {
    if (!MetadataRegistry.instance) {
      MetadataRegistry.instance = new MetadataRegistry();
    }
    return MetadataRegistry.instance;
  }

  private ensureDefaultsRegistered(): void {
    if (this.defaultsInitialized) {
      return;
    }
    this.defaultsInitialized = true;
    const defaultPlugins: Array<MetadataPlugin<unknown>> = [
      new CoverImageMetadataProvider(),
      new SynopsisMetadataProvider(),
      new AuthorBioMetadataProvider(),
      new GenreMetadataProvider(),
      new GeoMetadataProvider(),
      new TemporalMetadataProvider(),
      new EmbeddingMetadataProvider(),
      new SeriesMetadataProvider(),
    ];
    for (const plugin of defaultPlugins) {
      if (!this.providers.has(plugin.getKey())) {
        this.providers.set(plugin.getKey(), plugin);
      }
    }
  }

  register<Output>(provider: MetadataProvider<Output>): void {
    this.ensureDefaultsRegistered();
    this.providers.set(provider.getKey(), provider);
  }

  getProvider<Output = unknown>(
    key: MetadataKey,
  ): MetadataProvider<Output> | undefined {
    this.ensureDefaultsRegistered();
    return this.providers.get(key) as MetadataProvider<Output> | undefined;
  }

  getPlugin<Output = unknown>(
    key: MetadataKey,
  ): MetadataPlugin<Output> | undefined {
    const provider = this.getProvider<Output>(key);
    if (provider && isMetadataPlugin(provider)) {
      return provider;
    }
    return undefined;
  }

  getAllProviders(): Array<MetadataProvider<unknown>> {
    this.ensureDefaultsRegistered();
    return Array.from(this.providers.values());
  }

  getAllPlugins(): Array<MetadataPlugin<unknown>> {
    return this.getAllProviders().filter((p): p is MetadataPlugin<unknown> =>
      isMetadataPlugin(p),
    );
  }

  /**
   * Executes Tier-0 fast coalesced Decisions (`Genre` taxonomy + `Series` standalone gate)
   * on newly created books without blocking on external catalog HTTP calls.
   */
  async enrichBooksOnCreateFastTier(
    books: CoreBookData[],
    options?: OnCreateEnrichmentOptions,
  ): Promise<FastTierOnCreateResult> {
    this.ensureDefaultsRegistered();
    const workingBooks: CoreBookData[] = books.map(b => ({...b}));
    const updatesByBookId = new Map<string, Record<string, unknown>>();
    const standaloneSeriesBookIds = new Set<string>();
    const lowConfidenceGenreBookIds = new Set<string>();

    for (const b of workingBooks) {
      updatesByBookId.set(b.id, {});
    }

    const registeredGenreProvider = this.getProvider(MetadataKey.GENRE);
    const useBuiltInCoalescedGenre =
      registeredGenreProvider instanceof GenreMetadataProvider &&
      registeredGenreProvider.isAvailable();

    const coalescedDecisionsFn = getOptionalModuleFunction<
      typeof geminiService.evaluateGenreAndSeriesGateCoalesced
    >(geminiService, 'evaluateGenreAndSeriesGateCoalesced');
    const canRunCoalescedDecisions =
      options?.allowAiFallback !== false &&
      Boolean(process.env.GEMINI_API_KEY) &&
      Boolean(coalescedDecisionsFn) &&
      !options?.signal?.aborted;

    if (!canRunCoalescedDecisions || !coalescedDecisionsFn) {
      return {
        workingBooks,
        updatesByBookId,
        standaloneSeriesBookIds,
        lowConfidenceGenreBookIds,
      };
    }

    const eligibleBooks = workingBooks.filter(b => {
      if (!b.title || !b.title.trim()) {
        return false;
      }
      const existingStatus =
        b.enrichmentStatus && typeof b.enrichmentStatus === 'object'
          ? (b.enrichmentStatus as Record<string, unknown>)
          : undefined;
      const needsGenre = useBuiltInCoalescedGenre && !b.primaryGenre;
      const needsSeriesGate =
        !b.series && existingStatus?.series !== 'unsupported';
      return needsGenre || needsSeriesGate;
    });

    if (eligibleBooks.length === 0) {
      return {
        workingBooks,
        updatesByBookId,
        standaloneSeriesBookIds,
        lowConfidenceGenreBookIds,
      };
    }

    const genreConfidenceThreshold = GENRE_CONFIDENCE_THRESHOLD;

    try {
      const coalesced = await coalescedDecisionsFn(
        eligibleBooks.map(b => ({
          id: b.id,
          title: b.title,
          author: b.author || 'Unknown Author',
          synopsis:
            typeof b.synopsis === 'string' && b.synopsis.trim()
              ? b.synopsis.trim()
              : typeof b.description === 'string' && b.description.trim()
                ? b.description.trim()
                : undefined,
        })),
        {
          customGenres: options?.customGenres,
          priority: options?.priority ?? 'INTERACTIVE',
          signal: options?.signal,
          maxBooksPerChunk: 15,
        },
      );

      for (const book of eligibleBooks) {
        const current = updatesByBookId.get(book.id) || {};
        const existingStatus =
          book.enrichmentStatus && typeof book.enrichmentStatus === 'object'
            ? {...(book.enrichmentStatus as Record<string, unknown>)}
            : {};
        const nextStatus: Record<string, unknown> = {
          ...existingStatus,
          ...((current.enrichmentStatus as
            Record<string, unknown> | undefined) ?? {}),
        };
        let statusChanged = false;

        if (useBuiltInCoalescedGenre && !book.primaryGenre) {
          const genreMatch = coalesced.genresByBookId.get(book.id);
          if (genreMatch?.primaryGenre) {
            current.primaryGenre = genreMatch.primaryGenre;
            current.subgenres = genreMatch.subgenres || [];
            current.isCustomPrimary = Boolean(genreMatch.isCustomPrimary);
            nextStatus.genre = 'completed';
            statusChanged = true;

            book.primaryGenre = genreMatch.primaryGenre;
            book.subgenres = genreMatch.subgenres || [];

            const hasSavedSynopsis = Boolean(
              (typeof book.synopsis === 'string' && book.synopsis.trim()) ||
              (typeof book.description === 'string' && book.description.trim()),
            );
            if (
              !hasSavedSynopsis &&
              typeof genreMatch.confidence === 'number' &&
              genreMatch.confidence < genreConfidenceThreshold
            ) {
              lowConfidenceGenreBookIds.add(book.id);
            }
          }
        }

        if (!book.series && nextStatus.series !== 'unsupported') {
          const seriesGate = coalesced.seriesGateByBookId.get(book.id);
          if (seriesGate && !seriesGate.isSeriesCandidate) {
            standaloneSeriesBookIds.add(book.id);
            nextStatus.series = 'unsupported';
            statusChanged = true;
          }
        }

        if (statusChanged) {
          current.enrichmentStatus = nextStatus;
          book.enrichmentStatus = nextStatus;
        }
        updatesByBookId.set(book.id, current);
      }
    } catch (err) {
      console.warn(
        '[MetadataRegistry] Coalesced fast-tier Decision pass failed, falling back to slow tier:',
        err,
      );
    }

    return {
      workingBooks,
      updatesByBookId,
      standaloneSeriesBookIds,
      lowConfidenceGenreBookIds,
    };
  }

  /**
   * Executes Tier-1/2 slow enrichment on create (unified catalog hydration,
   * targeted Genre re-pass when low-confidence books gain a catalog synopsis,
   * and remaining on-create providers such as embeddings).
   */
  async enrichBooksOnCreateSlowTier(
    fastState: FastTierOnCreateResult,
    options?: OnCreateEnrichmentOptions,
  ): Promise<Map<string, Record<string, unknown>>> {
    this.ensureDefaultsRegistered();
    const slowUpdates = new Map<string, Record<string, unknown>>();
    const workingBooks = fastState.workingBooks;

    for (const b of workingBooks) {
      slowUpdates.set(b.id, {});
    }

    await Promise.all(
      workingBooks.map(async book => {
        if (options?.signal?.aborted) {
          return;
        }
        const hasCover = Boolean(book.coverUrl);
        const hasSynopsis = Boolean(book.synopsis || book.description);
        const isStandaloneSeries = fastState.standaloneSeriesBookIds.has(
          book.id,
        );
        const needsGenreRepassSynopsis =
          !hasSynopsis && fastState.lowConfidenceGenreBookIds.has(book.id);

        if (
          hasCover &&
          hasSynopsis &&
          (Boolean(book.series) || isStandaloneSeries) &&
          !needsGenreRepassSynopsis
        ) {
          return;
        }

        try {
          let match = null;
          if (book.isbn) {
            match = await catalogOrchestrator.searchByIsbn(book.isbn, {
              priority: 'BATCH',
              verifyCovers: !hasCover,
              signal: options?.signal,
            });
          }
          if (!match && book.title) {
            const searchRes = await catalogOrchestrator.searchByQuery(
              {
                title: book.title,
                author: book.author || '',
                isbn: book.isbn,
                limit: 3,
              },
              {
                priority: 'BATCH',
                verifyCovers: !hasCover,
                signal: options?.signal,
              },
            );
            match =
              searchRes.books.find(b => Boolean(b.coverUrl)) ||
              searchRes.books[0] ||
              null;
          }

          if (match) {
            const current = slowUpdates.get(book.id) || {};
            if (!book.coverUrl && match.coverUrl) {
              current[MetadataKey.COVER_IMAGE] = match.coverUrl;
              book.coverUrl = match.coverUrl;
            }
            if (!hasSynopsis && match.synopsis) {
              current[MetadataKey.SYNOPSIS] = match.synopsis;
              book.synopsis = match.synopsis;
            }
            if (!book.isbn && match.isbn) {
              current.isbn = match.isbn;
              book.isbn = match.isbn;
            }
            if (!book.publishedDate && match.publishedDate) {
              current.publishedDate = match.publishedDate;
              book.publishedDate = match.publishedDate;
            }
            if (!book.series && !isStandaloneSeries && match.series) {
              current.series = match.series;
              book.series = match.series;
            }
            if (
              !book.primaryGenre &&
              match.primaryGenre &&
              !match.isCustomPrimary
            ) {
              current.primaryGenre = match.primaryGenre;
              current.subgenres = match.subgenres || [];
              current.isCustomPrimary = false;
              book.primaryGenre = match.primaryGenre;
              book.subgenres = match.subgenres || [];
            }
            slowUpdates.set(book.id, current);
          }
        } catch (err) {
          console.warn(
            `[MetadataRegistry] Unified catalog pre-hydration failed for "${book.title}":`,
            err,
          );
        }
      }),
    );

    if (options?.allowAiFallback === false || options?.signal?.aborted) {
      return slowUpdates;
    }

    const classifyBooksFn = getOptionalModuleFunction<
      typeof geminiService.classifyBooks
    >(geminiService, 'classifyBooks');

    if (
      fastState.lowConfidenceGenreBookIds.size > 0 &&
      Boolean(process.env.GEMINI_API_KEY) &&
      classifyBooksFn
    ) {
      const repassBooks = workingBooks.filter(
        b =>
          fastState.lowConfidenceGenreBookIds.has(b.id) &&
          typeof b.synopsis === 'string' &&
          b.synopsis.trim().length > 0,
      );

      if (repassBooks.length > 0) {
        try {
          const refreshedGenres = await classifyBooksFn(
            repassBooks.map(b => ({
              id: b.id,
              title: b.title,
              author: b.author || 'Unknown Author',
              synopsis: b.synopsis?.trim(),
            })),
            {
              priority: 'BATCH',
              signal: options?.signal,
              customGenres: options?.customGenres,
              includeConfidence: true,
            },
          );

          if (Array.isArray(refreshedGenres)) {
            for (const refreshed of refreshedGenres) {
              if (!refreshed.id || !refreshed.primaryGenre) {
                continue;
              }
              const current = slowUpdates.get(refreshed.id) || {};
              current.primaryGenre = refreshed.primaryGenre;
              current.subgenres = refreshed.subgenres || [];
              current.isCustomPrimary = Boolean(refreshed.isCustomPrimary);
              const targetBook = workingBooks.find(
                wb => wb.id === refreshed.id,
              );
              if (targetBook) {
                targetBook.primaryGenre = refreshed.primaryGenre;
                targetBook.subgenres = refreshed.subgenres || [];
              }
              slowUpdates.set(refreshed.id, current);
            }
          }
        } catch (err) {
          console.warn(
            '[MetadataRegistry] Targeted low-confidence Genre re-pass failed:',
            err,
          );
        }
      }
    }

    const createProviders = this.getAllProviders().filter(
      p => p.shouldFetchOnCreate() && p.isAvailable(),
    );

    for (const provider of createProviders) {
      if (options?.signal?.aborted) {
        break;
      }
      const key = provider.getKey();
      const booksNeedingField = workingBooks.filter(b => {
        if (key === MetadataKey.COVER_IMAGE) {
          return !b.coverUrl;
        }
        if (key === MetadataKey.GENRE) {
          return !b.primaryGenre;
        }
        return !b[key];
      });
      if (booksNeedingField.length === 0) {
        continue;
      }

      try {
        const batchRes = await provider.bulkFetch(booksNeedingField, {
          allowAiFallback: options?.allowAiFallback,
          customGenres: options?.customGenres,
          signal: options?.signal,
        });
        for (const [bookId, value] of Object.entries(batchRes)) {
          if (value === null || value === undefined) {
            continue;
          }
          const current = slowUpdates.get(bookId) || {};
          const targetBook = workingBooks.find(wb => wb.id === bookId);
          if (key === MetadataKey.GENRE) {
            const genreVal = value as BookGenreData;
            if (genreVal.primaryGenre) {
              current.primaryGenre = genreVal.primaryGenre;
              current.subgenres = genreVal.subgenres || [];
              current.isCustomPrimary = Boolean(genreVal.isCustomPrimary);
              if (targetBook) {
                targetBook.primaryGenre = genreVal.primaryGenre;
                targetBook.subgenres = genreVal.subgenres || [];
              }
            }
          } else {
            current[key] = value;
            if (targetBook) {
              (targetBook as Record<string, unknown>)[key] = value;
            }
          }
          slowUpdates.set(bookId, current);
        }
      } catch (err) {
        console.warn(
          `[MetadataRegistry] On-create provider ${key} encountered error:`,
          err,
        );
      }
    }

    return slowUpdates;
  }

  /**
   * Enriches newly created books across all available on-create providers,
   * running Tier-0 coalesced Decisions first followed by Tier-1/2 catalog and embedding hydration.
   */
  async enrichBooksOnCreate(
    books: CoreBookData[],
    options?: OnCreateEnrichmentOptions,
  ): Promise<Map<string, Record<string, unknown>>> {
    const fastState = await this.enrichBooksOnCreateFastTier(books, options);
    const slowUpdates = await this.enrichBooksOnCreateSlowTier(
      fastState,
      options,
    );
    return mergeOnCreateUpdateMaps(fastState.updatesByBookId, slowUpdates);
  }
}

export const metadataRegistry = MetadataRegistry.getInstance();
