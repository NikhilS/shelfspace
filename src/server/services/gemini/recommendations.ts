import {Decisions, ThinkingLevel, Type} from '@google/genai';
import type {
  DecisionChoiceAnswer,
  DecisionScoreAnswer,
} from '../../../schemas/decisions';
import type {BookRecommendationItem} from '../../../schemas/recommendation';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {
  decideWithLimiter,
  geminiDecisionProvider,
  generateContentWithLimiter,
  isApiKeyError,
} from './client';

export interface TastePositiveAnchor {
  title: string;
  author: string;
  rating?: number;
  primaryGenre?: string;
  subgenres?: string[];
  series?: string;
  status: 'finished' | 'reading' | 'want_to_read';
}

export interface TasteNegativeSignal {
  title: string;
  author: string;
  rating?: number;
  primaryGenre?: string;
  reason: 'abandoned' | 'low_rating';
}

export interface StructuredTasteCandidate {
  title: string;
  author: string;
  reason: string;
  matchTag: string;
  seedTitle?: string;
}

export interface GenerateStructuredTasteInput {
  positiveAnchors: TastePositiveAnchor[];
  negativeSignals: TasteNegativeSignal[];
  excludedTitles: string[];
  topGenres: string[];
  limit?: number;
  refreshSeed?: number;
}

/**
 * Generates structured literary recommendations using Gemini 3.8 Flash based on weighted
 * positive reading anchors, negative signals (abandoned/low-rated books), and an exclusion list.
 * Returned candidates are subsequently grounded and verified against CatalogOrchestrator.
 */
export async function generateStructuredTasteRecommendations(
  input: GenerateStructuredTasteInput,
): Promise<StructuredTasteCandidate[]> {
  if (!input.positiveAnchors || input.positiveAnchors.length === 0) {
    return [];
  }

  const desiredCount = Math.min(Math.max(input.limit ?? 8, 3), 12);
  const anchorsText = input.positiveAnchors
    .slice(0, 40)
    .map((book, idx) => {
      const ratingBadge =
        typeof book.rating === 'number' ? ` [Rated ${book.rating}/5★]` : '';
      const statusBadge =
        book.status === 'reading'
          ? ' [Currently Reading]'
          : book.status === 'finished'
            ? ' [Finished]'
            : ' [Want to Read]';
      const genreBadge = book.primaryGenre
        ? ` [Genre: ${book.primaryGenre}${
            book.subgenres && book.subgenres.length > 0
              ? ` (${book.subgenres.slice(0, 3).join(', ')})`
              : ''
          }]`
        : '';
      const seriesBadge = book.series ? ` [Series: ${book.series}]` : '';
      return `${idx + 1}. "${book.title}" by ${book.author}${ratingBadge}${statusBadge}${genreBadge}${seriesBadge}`;
    })
    .join('\n');

  const negativeText =
    input.negativeSignals.length > 0
      ? '\nBooks the Reader Abandoned or Disliked (Avoid similar pacing, tropes, or direct style):\n' +
        input.negativeSignals
          .slice(0, 20)
          .map(
            n =>
              `- "${n.title}" by ${n.author} (${
                n.reason === 'abandoned'
                  ? 'Abandoned'
                  : `Rated ${n.rating ?? 1}/5★`
              })`,
          )
          .join('\n')
      : '';

  const exclusionBlock =
    input.excludedTitles.length > 0
      ? `\nStrict Do-Not-Recommend Exclusion List (Already Owned or Tracked):\n${input.excludedTitles
          .slice(0, 300)
          .join(' | ')}`
      : '';

  const variationHint =
    input.refreshSeed && input.refreshSeed > 0
      ? `\nCuratorial Perspective Variation #${input.refreshSeed}: Surface fresh, non-obvious literary connections and distinct titles not commonly repeated.`
      : '';

  const prompt = `Analyze this reader's personal reading ledger and curate ${desiredCount} exceptional, real-world book recommendations tailored to their demonstrated taste.

Reader's Positive Reading Anchors (Weighted by Star Rating & Completion):
${anchorsText}${negativeText}${exclusionBlock}${variationHint}

CRITICAL CURATORIAL DIRECTIVES:
1. NEVER recommend any book that appears in the Reader's Positive Reading Anchors, Negative Signals, or Strict Do-Not-Recommend Exclusion List.
2. Every recommended book MUST be a real, verifiable published book with its accurate real-world author (they will be verified against library catalogs).
3. Prioritize themes, prose styles, and genres from books the reader rated 4★ or 5★, while steering away from characteristics of books they abandoned or rated 1–2★.
4. For each recommendation, provide:
   - "title": Exact published book title (without series suffixes in parentheses).
   - "author": Primary author's full name.
   - "reason": 1 to 2 warm, insightful sentences explaining specifically why this book resonates with their reading history.
   - "matchTag": A crisp provenance tag under 45 characters naming the specific anchor book or theme it connects to (e.g., "Because you loved Piranesi", "Echoes the worldbuilding of Dune").`;

  const responseSchema = {
    type: Type.ARRAY,
    description: 'Curated book recommendations grounded in reader taste',
    items: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Clean published title of the recommended book',
        },
        author: {
          type: Type.STRING,
          description: 'Full name of the book author',
        },
        reason: {
          type: Type.STRING,
          description:
            '1-2 sentence explanation connecting the recommendation to the reader history',
        },
        matchTag: {
          type: Type.STRING,
          description:
            'Short badge under 45 chars, e.g. "Because you loved Project Hail Mary"',
        },
        seedTitle: {
          type: Type.STRING,
          description:
            'Optional title of the specific read book that inspired this pick',
        },
      },
      required: ['title', 'author', 'reason', 'matchTag'],
    },
  };

  try {
    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a warm, erudite literary curator and bookseller who recommends real, verifiable books tailored to a reader’s personal reading history.',
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.6,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

    const rawText = response.text;
    if (!rawText) {
      return [];
    }

    const cleaned = rawText
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const valid: StructuredTasteCandidate[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const author =
        typeof record.author === 'string' ? record.author.trim() : '';
      const reason =
        typeof record.reason === 'string' ? record.reason.trim() : '';
      const matchTag =
        typeof record.matchTag === 'string' ? record.matchTag.trim() : '';
      const seedTitle =
        typeof record.seedTitle === 'string'
          ? record.seedTitle.trim()
          : undefined;

      if (title && author && reason) {
        valid.push({
          title,
          author,
          reason,
          matchTag:
            matchTag ||
            (seedTitle ? `Because you read ${seedTitle}` : 'Curated for You'),
          ...(seedTitle ? {seedTitle} : {}),
        });
      }
    }
    return valid;
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Structured taste recommendations pending valid GEMINI_API_KEY configuration.',
      );
      return [];
    }
    console.warn('Failed to generate structured taste recommendations:', err);
    return [];
  }
}

export interface TasteRerankProfileInput {
  positiveAnchors: TastePositiveAnchor[];
  negativeSignals: TasteNegativeSignal[];
  topGenres: string[];
  topAuthors: string[];
}

const TASTE_SCORE_RUBRIC: string[] = [
  '0: Poor match — echoes books the reader abandoned/disliked or clashes sharply with their taste.',
  '1: Lukewarm match — tangential connection with modest thematic appeal.',
  '2: Solid match — aligns reasonably with the reader’s preferred genres or authors.',
  '3: Strong match — compelling thematic, stylistic, or series resonance with high-rated anchors.',
  '4: Extraordinary match — unputdownable next read deeply aligned with the reader’s 4–5 star favorites.',
];

const CURATORIAL_LENS_CRITERIA: Record<string, string> = {
  thematic_kinship: 'Deep thematic & philosophical kinship with favorite reads',
  narrative_voice: 'Kindred prose style, atmosphere & storytelling voice',
  worldbuilding_depth:
    'Immersive worldbuilding, era, or speculative architecture',
  series_or_author: 'Direct series continuation or beloved author backlist',
  fresh_horizon:
    'Rewarding curatorial bridge into an adjacent literary horizon',
};

const LENS_BADGE_LABELS: Record<string, string> = {
  thematic_kinship: 'Thematic Kinship',
  narrative_voice: 'Kindred Voice',
  worldbuilding_depth: 'Rich Worldbuilding',
  series_or_author: 'Author & Series Continuity',
  fresh_horizon: 'Curator’s Bridge',
};

/**
 * Evaluates and re-orders candidate recommendations (Unread Shelf & Catalog Graph)
 * in a single `gemini-decision-1` forward pass using calibrated `score` (0..4)
 * and `choice` curatorial lens rubrics. Gracefully returns original order if unavailable.
 */
export async function rerankCandidatesWithDecisions(
  candidates: BookRecommendationItem[],
  profile: TasteRerankProfileInput,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<BookRecommendationItem[]> {
  if (
    !candidates ||
    candidates.length <= 1 ||
    profile.positiveAnchors.length === 0 ||
    !geminiDecisionProvider.isAvailable()
  ) {
    return candidates;
  }

  const capped = candidates.slice(0, 16);
  const remainder = candidates.slice(16);

  const anchorsSummary = profile.positiveAnchors
    .slice(0, 20)
    .map(
      (a, idx) =>
        `${idx + 1}. "${a.title}" by ${a.author}${typeof a.rating === 'number' ? ` (${a.rating}/5★)` : ''} [${a.status}]${a.primaryGenre ? ` — ${a.primaryGenre}` : ''}`,
    )
    .join('\n');

  const negativesSummary =
    profile.negativeSignals.length > 0
      ? '\nNegative Signals (Abandoned / Low-Rated):\n' +
        profile.negativeSignals
          .slice(0, 12)
          .map(n => `- "${n.title}" by ${n.author} (${n.reason})`)
          .join('\n')
      : '';

  const candidatesSummary = capped
    .map(
      (c, idx) =>
        `[Candidate #${idx}] "${c.title}" by ${c.author}${c.primaryGenre ? ` | Genre: ${c.primaryGenre}` : ''}${c.series ? ` | Series: ${c.series}` : ''}${c.synopsis ? ` | Synopsis: ${c.synopsis.slice(0, 220)}` : ''}`,
    )
    .join('\n');

  const questions: Record<string, Decisions.Question> = {};
  capped.forEach((candidate, idx) => {
    questions[`c${idx}_score`] = {
      type: 'score',
      instructions: `Score how strongly Candidate #${idx} ("${candidate.title}" by ${candidate.author}) matches this reader's positive anchors while avoiding their negative signals.`,
      criteria: TASTE_SCORE_RUBRIC,
    };
    questions[`c${idx}_lens`] = {
      type: 'choice',
      instructions: `Select the primary curatorial lens explaining why Candidate #${idx} ("${candidate.title}" by ${candidate.author}) appeals to this reader.`,
      criteria: CURATORIAL_LENS_CRITERIA,
    };
  });

  try {
    const answers = await decideWithLimiter(
      {
        input: `Reader Taste Ledger:\nTop Genres: ${profile.topGenres.join(', ') || 'Varied'}\nFavorite Authors: ${profile.topAuthors.join(', ') || 'Varied'}\n\nPositive Reading Anchors:\n${anchorsSummary}${negativesSummary}\n\nCandidate Books to Score:\n${candidatesSummary}`,
        questions,
        operation: 'gemini.rerankCandidatesWithDecisions',
      },
      {
        priority: options?.priority ?? 'INTERACTIVE',
        signal: options?.signal,
      },
    );

    const hasAnyScore = capped.some(
      (_, idx) => answers[`c${idx}_score`]?.type === 'score',
    );
    if (!hasAnyScore) {
      return candidates;
    }

    const decorated = capped.map((item, idx) => {
      const scoreAns = answers[`c${idx}_score`] as
        DecisionScoreAnswer | undefined;
      const lensAns = answers[`c${idx}_lens`] as
        DecisionChoiceAnswer | undefined;
      const expectedScore = scoreAns?.type === 'score' ? scoreAns.score : 2.0;
      const lensLabel =
        lensAns?.type === 'choice'
          ? LENS_BADGE_LABELS[lensAns.choice]
          : undefined;

      const enrichedTag =
        lensLabel && item.matchTag === 'On Your Shelf'
          ? `On Your Shelf · ${lensLabel}`
          : item.matchTag;

      return {
        item: {
          ...item,
          matchTag: enrichedTag,
        },
        expectedScore,
        originalIndex: idx,
      };
    });

    decorated.sort((a, b) => {
      if (Math.abs(b.expectedScore - a.expectedScore) > 0.05) {
        return b.expectedScore - a.expectedScore;
      }
      return a.originalIndex - b.originalIndex;
    });

    return [...decorated.map(d => d.item), ...remainder];
  } catch (err) {
    if (!isApiKeyError(err)) {
      console.warn(
        'Decisions taste re-ranking fell back to deterministic order:',
        err,
      );
    }
    return candidates;
  }
}
