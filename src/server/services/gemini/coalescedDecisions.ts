import {Decisions} from '@google/genai';
import type {DecisionAnswerPayload} from '../../../schemas/decisions';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {
  decideWithLimiter,
  handleGeminiError,
  isApiKeyError,
  MAX_DECISION_QUESTIONS,
} from './client';
import {
  appendGenreDecisionQuestions,
  appendSeriesGateDecisionQuestions,
  buildGenreDecisionRubricContext,
  type ClassifiedBookGenre,
  formatCompactBookCatalog,
  resolveGenreDecisionFromAnswers,
  resolveSeriesGateDecisionFromAnswers,
  SERIES_STANDALONE_NOUL_THRESHOLD,
} from './decisionsEnrichment';

export interface CoalescedDecisionBookInput {
  id: string;
  title: string;
  author: string;
  synopsis?: string;
}

/**
 * Generic, pluggable contributor contract allowing multiple metadata domains
 * (e.g., Genre taxonomy + Series standalone gate, or future multi-field rubrics)
 * to pack namespaced questions into a single `gemini-decision-1` forward pass.
 */
export interface DecisionQuestionContributor<Result> {
  readonly id: string;
  readonly estimatedQuestionsPerBook: number;
  appendQuestions(
    questions: Record<string, Decisions.Question>,
    book: CoalescedDecisionBookInput,
    bookIndex: number,
    questionPrefix: string,
  ): void;
  resolveBookResult(
    book: CoalescedDecisionBookInput,
    bookIndex: number,
    answers: Record<string, DecisionAnswerPayload>,
    questionPrefix: string,
  ): Result;
}

export interface CoalescedDecisionRunOptions {
  priority?: SchedulePriority;
  signal?: AbortSignal;
  maxBooksPerChunk?: number;
  operation?: string;
}

export async function runCoalescedDecisionsBatch(
  books: CoalescedDecisionBookInput[],
  contributors: ReadonlyArray<DecisionQuestionContributor<unknown>>,
  options?: CoalescedDecisionRunOptions,
): Promise<Map<string, Map<string, unknown>>> {
  const resultsByContributor = new Map<string, Map<string, unknown>>();
  for (const contributor of contributors) {
    resultsByContributor.set(contributor.id, new Map());
  }

  if (!books || books.length === 0 || contributors.length === 0) {
    return resultsByContributor;
  }

  const totalQuestionsPerBook = Math.max(
    1,
    contributors.reduce(
      (sum, contributor) =>
        sum + Math.max(1, contributor.estimatedQuestionsPerBook),
      0,
    ),
  );
  const maxSafeBooksByLimit = Math.max(
    1,
    Math.floor(MAX_DECISION_QUESTIONS / totalQuestionsPerBook),
  );
  const chunkSize = Math.min(
    options?.maxBooksPerChunk ?? 15,
    maxSafeBooksByLimit,
  );

  for (let offset = 0; offset < books.length; offset += chunkSize) {
    const chunk = books.slice(offset, offset + chunkSize);
    const questions: Record<string, Decisions.Question> = {};

    chunk.forEach((book, idx) => {
      for (const contributor of contributors) {
        const prefix = `b${idx}_${contributor.id}`;
        contributor.appendQuestions(questions, book, idx, prefix);
      }
    });

    const sharedInput = `You are an expert bibliographer and library cataloger evaluating multiple calibrated metadata rubrics for each book.\n\nBooks to evaluate:\n${formatCompactBookCatalog(chunk, 320)}`;

    let answers: Record<string, DecisionAnswerPayload>;
    try {
      answers = await decideWithLimiter(
        {
          input: sharedInput,
          questions,
          operation: options?.operation ?? 'gemini.runCoalescedDecisionsBatch',
        },
        {
          priority: options?.priority ?? 'INTERACTIVE',
          signal: options?.signal,
        },
      );
    } catch (err) {
      if (isApiKeyError(err)) {
        console.info(
          'Coalesced Decisions evaluation is pending valid GEMINI_API_KEY configuration.',
        );
        return resultsByContributor;
      }
      handleGeminiError(err);
    }

    chunk.forEach((book, idx) => {
      for (const contributor of contributors) {
        const prefix = `b${idx}_${contributor.id}`;
        const resolved = contributor.resolveBookResult(
          book,
          idx,
          answers,
          prefix,
        );
        resultsByContributor.get(contributor.id)?.set(book.id, resolved);
      }
    });
  }

  return resultsByContributor;
}

export function createGenreDecisionContributor(options?: {
  customGenres?: string[];
  includeConfidence?: boolean;
}): DecisionQuestionContributor<ClassifiedBookGenre> {
  const rubricContext = buildGenreDecisionRubricContext(options?.customGenres);
  return {
    id: 'genre',
    estimatedQuestionsPerBook: 3,
    appendQuestions(questions, book, bookIndex, questionPrefix) {
      appendGenreDecisionQuestions(
        questions,
        book,
        bookIndex,
        questionPrefix,
        rubricContext,
      );
    },
    resolveBookResult(book, _bookIndex, answers, questionPrefix) {
      return resolveGenreDecisionFromAnswers(
        book.id,
        answers,
        questionPrefix,
        rubricContext,
        {includeConfidence: options?.includeConfidence ?? true},
      );
    },
  };
}

export interface SeriesGateDecisionResult {
  isSeriesCandidate: boolean;
  noul: number;
}

export function createSeriesGateDecisionContributor(options?: {
  threshold?: number;
}): DecisionQuestionContributor<SeriesGateDecisionResult> {
  const threshold = options?.threshold ?? SERIES_STANDALONE_NOUL_THRESHOLD;
  return {
    id: 'seriesGate',
    estimatedQuestionsPerBook: 1,
    appendQuestions(questions, book, bookIndex, questionPrefix) {
      appendSeriesGateDecisionQuestions(
        questions,
        book,
        bookIndex,
        questionPrefix,
      );
    },
    resolveBookResult(_book, _bookIndex, answers, questionPrefix) {
      return resolveSeriesGateDecisionFromAnswers(
        answers,
        questionPrefix,
        threshold,
      );
    },
  };
}

export interface CoalescedGenreAndSeriesGateResult {
  genresByBookId: Map<string, ClassifiedBookGenre>;
  seriesGateByBookId: Map<string, SeriesGateDecisionResult>;
}

export async function evaluateGenreAndSeriesGateCoalesced(
  books: CoalescedDecisionBookInput[],
  options?: {
    customGenres?: string[];
    priority?: SchedulePriority;
    signal?: AbortSignal;
    maxBooksPerChunk?: number;
  },
): Promise<CoalescedGenreAndSeriesGateResult> {
  const genreContributor = createGenreDecisionContributor({
    customGenres: options?.customGenres,
    includeConfidence: true,
  });
  const seriesContributor = createSeriesGateDecisionContributor();

  const rawMap = await runCoalescedDecisionsBatch(
    books,
    [genreContributor, seriesContributor],
    {
      priority: options?.priority ?? 'INTERACTIVE',
      signal: options?.signal,
      maxBooksPerChunk: options?.maxBooksPerChunk ?? 15,
      operation: 'gemini.coalescedGenreAndSeriesGate',
    },
  );

  const genresByBookId = new Map<string, ClassifiedBookGenre>();
  const seriesGateByBookId = new Map<string, SeriesGateDecisionResult>();

  const rawGenres = rawMap.get(genreContributor.id);
  if (rawGenres) {
    for (const [bookId, value] of rawGenres.entries()) {
      genresByBookId.set(bookId, value as ClassifiedBookGenre);
    }
  }

  const rawSeries = rawMap.get(seriesContributor.id);
  if (rawSeries) {
    for (const [bookId, value] of rawSeries.entries()) {
      seriesGateByBookId.set(bookId, value as SeriesGateDecisionResult);
    }
  }

  return {
    genresByBookId,
    seriesGateByBookId,
  };
}
