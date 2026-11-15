import {Decisions} from '@google/genai';
import {
  GENRE_CONFIDENCE_THRESHOLD,
  GEO_CONFIDENCE_THRESHOLD,
  SERIES_STANDALONE_NOUL_THRESHOLD,
  TEMPORAL_CONFIDENCE_THRESHOLD,
} from '../../../constants/enrichment';
import {
  GAZETTEER_ZONES,
  getZoneCriteriaMap,
  resolveGeoLocationsFromDecisions,
} from '../../../constants/literaryGazetteer';
import {
  BOOK_TAXONOMY,
  type PrimaryGenreKey,
  sanitizeGenrePayload,
} from '../../../constants/taxonomy';
import {
  CHRONOLOGICAL_BUCKET_CRITERIA,
  HISTORICAL_ERA_CRITERIA,
  resolveTemporalFromDecisions,
} from '../../../constants/temporalCatalog';
import type {
  DecisionAnswerPayload,
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
} from '../../../schemas/decisions';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {decideWithLimiter, handleGeminiError, isApiKeyError} from './client';

export interface ClassifiedBookGenre {
  id: string;
  primaryGenre: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  confidence?: number;
}

export interface GenreDecisionRubricContext {
  readonly canonicalGenres: readonly string[];
  readonly validCustomGenres: readonly string[];
  readonly primaryCriteria: Record<string, string>;
}

export {
  GENRE_CONFIDENCE_THRESHOLD,
  GEO_CONFIDENCE_THRESHOLD,
  SERIES_STANDALONE_NOUL_THRESHOLD,
  TEMPORAL_CONFIDENCE_THRESHOLD,
};

const ALL_SUBGENRE_CRITERIA: Record<string, string> = (() => {
  const criteria: Record<string, string> = {};
  for (const [genre, subs] of Object.entries(BOOK_TAXONOMY)) {
    if (genre === 'Other') {
      continue;
    }
    for (const sub of subs) {
      criteria[sub] = `Subgenre under ${genre}`;
    }
  }
  return criteria;
})();

export function formatCompactBookCatalog(
  books: Array<{id: string; title: string; author: string; synopsis?: string}>,
  maxSynopsisLength = 350,
): string {
  return books
    .map((book, idx) => {
      const synopsisLine = book.synopsis
        ? ` | Synopsis: ${book.synopsis.slice(0, maxSynopsisLength).replace(/\s+/g, ' ').trim()}`
        : '';
      return `[Book #${idx}] id="${book.id}" | Title: "${book.title}" | Author: "${book.author}"${synopsisLine}`;
    })
    .join('\n');
}

export function buildGenreDecisionRubricContext(
  customGenres?: string[],
): GenreDecisionRubricContext {
  const canonicalGenres = Object.keys(BOOK_TAXONOMY).filter(k => k !== 'Other');
  const validCustomGenres = Array.from(
    new Set(
      (customGenres || [])
        .map(g => g.trim())
        .filter(g => Boolean(g) && g.length <= 120)
        .slice(0, 50),
    ),
  );

  const primaryCriteria: Record<string, string> = {};
  for (const genre of canonicalGenres) {
    const subs = BOOK_TAXONOMY[genre as PrimaryGenreKey];
    primaryCriteria[genre] =
      `Canonical primary genre (subgenres: ${subs.join(', ')})`;
  }
  for (const custom of validCustomGenres) {
    if (!(custom in primaryCriteria) && custom !== 'Other') {
      primaryCriteria[custom] =
        'Custom user-defined library genre (select when the work specifically fits this category)';
    }
  }
  primaryCriteria.Other =
    'Fallback only when the work genuinely defies all canonical and custom genres above';

  return {
    canonicalGenres,
    validCustomGenres,
    primaryCriteria,
  };
}

export function appendGenreDecisionQuestions(
  questions: Record<string, Decisions.Question>,
  book: {title: string; author: string},
  bookIndex: number,
  prefix: string,
  rubricContext: GenreDecisionRubricContext,
): void {
  questions[`${prefix}_primary`] = {
    type: 'choice',
    instructions: `Select the single best-fitting Primary Genre for Book #${bookIndex} ("${book.title}" by ${book.author}).`,
    criteria: rubricContext.primaryCriteria,
  };
  questions[`${prefix}_has_sub`] = {
    type: 'noul',
    instructions: `Does Book #${bookIndex} ("${book.title}" by ${book.author}) clearly belong to one or more specific canonical subgenres within its primary genre?`,
    criteria: {
      true_description:
        'The book clearly matches at least one canonical subgenre of its primary genre.',
      false_description:
        'The book fits a custom genre, Other, or only the broad primary genre.',
    },
  };
  questions[`${prefix}_sub`] = {
    type: 'choice',
    instructions: `Rank the canonical subgenres that best characterize Book #${bookIndex} ("${book.title}" by ${book.author}).`,
    criteria: ALL_SUBGENRE_CRITERIA,
  };
}

export function resolveGenreDecisionFromAnswers(
  bookId: string,
  answers: Record<string, DecisionAnswerPayload>,
  prefix: string,
  rubricContext: GenreDecisionRubricContext,
  options?: {includeConfidence?: boolean},
): ClassifiedBookGenre {
  const primaryAns = answers[`${prefix}_primary`] as
    DecisionChoiceAnswer | undefined;
  const hasSubAns = answers[`${prefix}_has_sub`] as
    DecisionNoulAnswer | undefined;
  const subAns = answers[`${prefix}_sub`] as DecisionChoiceAnswer | undefined;

  const rawPrimary =
    primaryAns?.type === 'choice' ? primaryAns.choice.trim() : 'Other';
  const rawConfidence =
    primaryAns?.type === 'choice'
      ? (primaryAns.probabilities[primaryAns.choice] ??
        primaryAns.confidence ??
        0.5)
      : 0.2;
  const calibratedConfidence =
    rawPrimary === 'Other'
      ? Math.min(rawConfidence, 0.4)
      : Math.min(1, Math.max(0, rawConfidence));

  if (
    rubricContext.validCustomGenres.includes(rawPrimary) &&
    !rubricContext.canonicalGenres.includes(rawPrimary)
  ) {
    return {
      id: bookId,
      primaryGenre: rawPrimary,
      subgenres: [],
      isCustomPrimary: true,
      ...(options?.includeConfidence ? {confidence: calibratedConfidence} : {}),
    };
  }

  const allowedSubs: readonly string[] =
    rawPrimary in BOOK_TAXONOMY
      ? BOOK_TAXONOMY[rawPrimary as PrimaryGenreKey]
      : [];

  const candidateSubgenres: string[] = [];
  const shouldIncludeSubgenres =
    allowedSubs.length > 0 &&
    (!hasSubAns || hasSubAns.type !== 'noul' || hasSubAns.noul >= 0.35);

  if (shouldIncludeSubgenres && subAns?.type === 'choice') {
    const scoredAllowed = allowedSubs
      .map(sub => ({
        sub,
        prob:
          subAns.probabilities[sub] ??
          (subAns.choice === sub ? Math.max(subAns.confidence, 0.25) : 0),
      }))
      .filter(entry => entry.prob >= 0.1)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 3);

    for (const entry of scoredAllowed) {
      candidateSubgenres.push(entry.sub);
    }
  }

  const sanitized = sanitizeGenrePayload({
    primaryGenre: rawPrimary,
    subgenres: candidateSubgenres,
  });

  const finalConfidence =
    sanitized.primaryGenre === 'Other'
      ? Math.min(calibratedConfidence, 0.4)
      : calibratedConfidence;

  return {
    id: bookId,
    primaryGenre: sanitized.primaryGenre,
    subgenres: sanitized.subgenres,
    isCustomPrimary: sanitized.isCustomPrimary,
    ...(options?.includeConfidence ? {confidence: finalConfidence} : {}),
  };
}

export function appendSeriesGateDecisionQuestions(
  questions: Record<string, Decisions.Question>,
  book: {title: string; author: string},
  bookIndex: number,
  prefix: string,
): void {
  questions[`${prefix}_is_series`] = {
    type: 'noul',
    instructions: `Is Book #${bookIndex} ("${book.title}" by ${book.author}) genuinely an installment in a named multi-book literary series, trilogy, or numbered narrative cycle (NOT a standalone novel, anthology, or publisher classics imprint)?`,
    criteria: {
      true_description:
        'Part of a named multi-volume book series, trilogy, quartet, or recurring-protagonist sequence.',
      false_description:
        'Standalone novel, standalone non-fiction work, essay collection, or generic publisher edition.',
    },
  };
}

export function resolveSeriesGateDecisionFromAnswers(
  answers: Record<string, DecisionAnswerPayload>,
  prefix: string,
  threshold = SERIES_STANDALONE_NOUL_THRESHOLD,
): {isSeriesCandidate: boolean; noul: number} {
  const ans = answers[`${prefix}_is_series`] as DecisionNoulAnswer | undefined;
  const noul = ans?.type === 'noul' ? ans.noul : 0;
  return {
    isSeriesCandidate: ans?.type === 'noul' && noul >= threshold,
    noul,
  };
}

export async function classifyBooks(
  batch: Array<{id: string; title: string; author: string; synopsis?: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
    customGenres?: string[];
    includeConfidence?: boolean;
  },
): Promise<ClassifiedBookGenre[]> {
  try {
    if (!batch || batch.length === 0) {
      return [];
    }

    const rubricContext = buildGenreDecisionRubricContext(
      options?.customGenres,
    );

    const questions: Record<string, Decisions.Question> = {};
    batch.forEach((book, idx) => {
      appendGenreDecisionQuestions(
        questions,
        book,
        idx,
        `b${idx}`,
        rubricContext,
      );
    });

    const sharedInput = `You are an expert library cataloger classifying books into a standardized literary taxonomy.\n\nBooks to classify:\n${formatCompactBookCatalog(batch, 300)}`;

    const answers = await decideWithLimiter(
      {
        input: sharedInput,
        questions,
        operation: 'gemini.classifyBooks',
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

    return batch.map((book, idx) =>
      resolveGenreDecisionFromAnswers(
        book.id,
        answers,
        `b${idx}`,
        rubricContext,
        {
          includeConfidence: options?.includeConfidence,
        },
      ),
    );
  } catch (error) {
    if (isApiKeyError(error)) {
      console.info(
        'Book classification is pending valid GEMINI_API_KEY configuration.',
      );
      throw error;
    }
    handleGeminiError(error);
  }
}

export interface ExtractedGeoLocation {
  name: string;
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;
  coordinates?: {lat: number; lng: number};
}

export interface BatchExtractedGeoBookResult {
  id: string;
  isNonEarth: boolean;
  locations: ExtractedGeoLocation[];
  confidence?: number;
}

export interface BatchExtractedGeoResponse {
  enrichment: BatchExtractedGeoBookResult[];
}

export async function extractBookGeoMetadataBatch(
  books: Array<{id: string; title: string; author: string; synopsis?: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
    includeConfidence?: boolean;
  },
): Promise<BatchExtractedGeoResponse | null> {
  if (!books || books.length === 0) {
    return {enrichment: []};
  }

  try {
    const questions: Record<string, Decisions.Question> = {};
    books.forEach((book, idx) => {
      const prefix = `b${idx}`;
      questions[`${prefix}_non_earth`] = {
        type: 'noul',
        instructions: `Is Book #${idx} ("${book.title}" by ${book.author}) set ENTIRELY outside real-world Earth geography (e.g., fictional fantasy realms like Middle-earth/Westeros, off-world sci-fi planets/deep space, or abstract instructional/philosophical/technical treatises with no geographic setting)? Never count publisher headquarters or author residence.`,
        criteria: {
          true_description:
            'Entirely non-Earth fictional universe, deep space, or abstract/timeless non-fiction without an earthly setting.',
          false_description:
            'Takes place in one or more real-world cities, states, regions, or countries on Earth.',
        },
      };

      for (const zone of GAZETTEER_ZONES) {
        questions[`${prefix}_z_${zone.id}_active`] = {
          type: 'noul',
          instructions: `Does a meaningful part of Book #${idx} ("${book.title}" by ${book.author}) take place in ${zone.label} (${zone.description})?`,
          criteria: {
            true_description: `Core plot, historical events, or biographical narrative of Book #${idx} occurs in ${zone.label}.`,
            false_description: `Book #${idx} does not take place in ${zone.label}.`,
          },
        };
        questions[`${prefix}_z_${zone.id}_place`] = {
          type: 'choice',
          instructions: `If Book #${idx} ("${book.title}" by ${book.author}) has settings in ${zone.label}, select the most specific matching city, state, region, or country (prefer city/region when central to the work, or country when nationwide).`,
          criteria: getZoneCriteriaMap(zone.id),
        };
      }
    });

    const sharedInput = `You are an authoritative literary geographer determining real-world Earth narrative settings (never publisher cities or author residences unless the book itself takes place there).\n\nBooks to analyze:\n${formatCompactBookCatalog(books, 400)}`;

    const answers = await decideWithLimiter(
      {
        input: sharedInput,
        questions,
        operation: 'gemini.extractBookGeoMetadataBatch',
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

    const enrichment: BatchExtractedGeoBookResult[] = books.map((book, idx) =>
      resolveGeoLocationsFromDecisions(
        book.id,
        book.title,
        answers,
        `b${idx}`,
        {includeConfidence: options?.includeConfidence},
      ),
    );

    return {enrichment};
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Geo metadata Decisions extraction is pending valid GEMINI_API_KEY configuration.',
      );
      return null;
    }
    handleGeminiError(err);
  }
}

export interface TemporalBookResult {
  id: string;
  isNonHistorical: boolean;
  startYear?: number;
  endYear?: number;
  eraName?: string;
  rationale?: string;
  confidence?: number;
}

export interface BatchTemporalResponse {
  enrichment: TemporalBookResult[];
}

export async function extractBookTemporalMetadataBatch(
  books: Array<{id: string; title: string; author: string; synopsis?: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
    includeConfidence?: boolean;
  },
): Promise<BatchTemporalResponse | null> {
  if (!books || books.length === 0) {
    return {enrichment: []};
  }

  try {
    const questions: Record<string, Decisions.Question> = {};
    books.forEach((book, idx) => {
      const prefix = `b${idx}`;
      questions[`${prefix}_non_hist`] = {
        type: 'noul',
        instructions: `Is Book #${idx} ("${book.title}" by ${book.author}) devoid of a real-world Earth historical or chronological era (e.g., secondary-world fantasy, far-future deep-space sci-fi after 2100 CE, or timeless technical/reference/philosophical guidebooks)?`,
        criteria: {
          true_description:
            'Secondary-world fantasy, far-future sci-fi, or abstract reference/philosophy/self-help without a chronological narrative era.',
          false_description:
            'Possesses a real-world historical or contemporary Earth timeline between 10,000 BCE and 2099 CE.',
        },
      };
      questions[`${prefix}_era`] = {
        type: 'choice',
        instructions: `Select the primary historical or literary era in which Book #${idx} ("${book.title}" by ${book.author}) takes place (based on story events, NOT publication date unless contemporary).`,
        criteria: HISTORICAL_ERA_CRITERIA,
      };
      questions[`${prefix}_start`] = {
        type: 'choice',
        instructions: `Select the chronological period or decade when the core events of Book #${idx} ("${book.title}" by ${book.author}) BEGIN.`,
        criteria: CHRONOLOGICAL_BUCKET_CRITERIA,
      };
      questions[`${prefix}_end`] = {
        type: 'choice',
        instructions: `Select the chronological period or decade when the core events of Book #${idx} ("${book.title}" by ${book.author}) CONCLUDE (within 100 years of the start).`,
        criteria: CHRONOLOGICAL_BUCKET_CRITERIA,
      };
    });

    const sharedInput = `You are an academic literary historian determining the chronological Earth timeline and historical era of each book's events.\n\nBooks to analyze:\n${formatCompactBookCatalog(books, 400)}`;

    const answers = await decideWithLimiter(
      {
        input: sharedInput,
        questions,
        operation: 'gemini.extractBookTemporalMetadataBatch',
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

    const enrichment: TemporalBookResult[] = books.map((book, idx) =>
      resolveTemporalFromDecisions(book.id, answers, `b${idx}`, {
        includeConfidence: options?.includeConfidence,
      }),
    );

    return {enrichment};
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Temporal metadata Decisions extraction is pending valid GEMINI_API_KEY configuration.',
      );
      return null;
    }
    handleGeminiError(err);
  }
}

export async function gateSeriesCandidatesWithDecisions(
  books: Array<{id: string; title: string; author: string; synopsis?: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Set<string>> {
  if (!books || books.length === 0) {
    return new Set();
  }

  const questions: Record<string, Decisions.Question> = {};
  books.forEach((book, idx) => {
    appendSeriesGateDecisionQuestions(questions, book, idx, `b${idx}`);
  });

  const sharedInput = `You are a meticulous bibliographer identifying which books belong to a named multi-volume series.\n\nBooks to inspect:\n${formatCompactBookCatalog(books, 280)}`;

  const answers = await decideWithLimiter(
    {
      input: sharedInput,
      questions,
      operation: 'gemini.gateSeriesCandidates',
    },
    {
      priority: options?.priority ?? 'BATCH',
      signal: options?.signal,
    },
  );

  const passedIds = new Set<string>();
  books.forEach((book, idx) => {
    const resolved = resolveSeriesGateDecisionFromAnswers(answers, `b${idx}`);
    if (resolved.isSeriesCandidate) {
      passedIds.add(book.id);
    }
  });

  return passedIds;
}

export interface DuplicateAdjudicationBookCandidate {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  series?: string;
  publishedDate?: string;
  pageCount?: number;
  hasCover?: boolean;
  hasSynopsis?: boolean;
}

export interface DuplicateAdjudicationGroupInput {
  groupKey: string;
  books: DuplicateAdjudicationBookCandidate[];
}

export interface AdjudicatedDuplicateGroupResult {
  groupKey: string;
  isDuplicate: boolean;
  calibratedConfidence: number;
  preferredSurvivorId?: string;
}

export async function adjudicateDuplicateGroups(
  groups: DuplicateAdjudicationGroupInput[],
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<AdjudicatedDuplicateGroupResult[]> {
  if (!groups || groups.length === 0) {
    return [];
  }

  const validGroups = groups
    .filter(g => Array.isArray(g.books) && g.books.length >= 2)
    .slice(0, 50);

  if (validGroups.length === 0) {
    return [];
  }

  try {
    const questions: Record<string, Decisions.Question> = {};
    const groupDescriptions = validGroups.map((group, idx) => {
      const prefix = `g${idx}`;
      const survivorCriteria: Record<string, string> = {};
      const lines = group.books.slice(0, 12).map(book => {
        const metaParts = [
          `Title: "${book.title}"`,
          `Author: "${book.author || 'Unknown'}"`,
          book.isbn ? `ISBN: ${book.isbn}` : 'No ISBN',
          book.series ? `Series: ${book.series}` : '',
          book.publishedDate ? `Published: ${book.publishedDate}` : '',
          book.pageCount ? `Pages: ${book.pageCount}` : '',
          book.hasCover ? 'Has Cover' : 'Missing Cover',
          book.hasSynopsis ? 'Has Synopsis' : 'Missing Synopsis',
        ].filter(Boolean);
        const summary = metaParts.join(' | ');
        survivorCriteria[book.id] = summary;
        return `  - [${book.id}] ${summary}`;
      });

      questions[`${prefix}_same_work`] = {
        type: 'noul',
        instructions: `In Candidate Group #${idx}, are ALL listed records editions or duplicate entries of the EXACT SAME underlying book/literary work (as opposed to distinct sequels like Volume 1 vs Volume 2, a companion study guide, a box set vs single volume, or different works by the same author)?`,
        criteria: {
          true_description:
            'Same underlying literary work (e.g., hardcover vs paperback, subtitle variation, or re-imported duplicate record).',
          false_description:
            'Distinct works—such as different numbered volumes in a series, companion books, omnibus vs single volume, or unrelated books.',
        },
      };

      questions[`${prefix}_survivor`] = {
        type: 'choice',
        instructions: `If Candidate Group #${idx} represents duplicate records of the same book, select the single cleanest, most complete canonical edition record ID to keep as the primary survivor.`,
        criteria: survivorCriteria,
      };

      return `Candidate Group #${idx} (groupKey="${group.groupKey}"):\n${lines.join('\n')}`;
    });

    const sharedInput = `You are a precision library catalog deduplication adjudicator.\n\n${groupDescriptions.join('\n\n')}`;

    const answers = await decideWithLimiter(
      {
        input: sharedInput,
        questions,
        operation: 'gemini.adjudicateDuplicateGroups',
      },
      {
        priority: options?.priority ?? 'INTERACTIVE',
        signal: options?.signal,
      },
    );

    return validGroups.map((group, idx) => {
      const prefix = `g${idx}`;
      const sameWorkAns = answers[`${prefix}_same_work`] as
        DecisionNoulAnswer | undefined;
      const survivorAns = answers[`${prefix}_survivor`] as
        DecisionChoiceAnswer | undefined;

      const sameProb = sameWorkAns?.type === 'noul' ? sameWorkAns.noul : 0.88;
      const isDuplicate = sameProb >= 0.5;
      const calibratedConfidence = Math.min(
        99,
        Math.max(1, Math.round(sameProb * 100)),
      );

      const validIds = new Set(group.books.map(b => b.id));
      const preferredSurvivorId =
        survivorAns?.type === 'choice' && validIds.has(survivorAns.choice)
          ? survivorAns.choice
          : group.books[0]?.id;

      return {
        groupKey: group.groupKey,
        isDuplicate,
        calibratedConfidence,
        preferredSurvivorId,
      };
    });
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Duplicate adjudication is pending valid GEMINI_API_KEY configuration.',
      );
      return validGroups.map(group => ({
        groupKey: group.groupKey,
        isDuplicate: true,
        calibratedConfidence: 88,
        preferredSurvivorId: group.books[0]?.id,
      }));
    }
    handleGeminiError(err);
  }
}
