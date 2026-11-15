import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {DecisionAnswerPayload} from '../../../schemas/decisions';
import * as geminiClient from './client';
import {
  createGenreDecisionContributor,
  createSeriesGateDecisionContributor,
  evaluateGenreAndSeriesGateCoalesced,
  runCoalescedDecisionsBatch,
} from './coalescedDecisions';

describe('CoalescedDecisionEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('packs Genre classification and Series standalone gating into a single decideWithLimiter call per chunk', async () => {
    const decideSpy = vi
      .spyOn(geminiClient, 'decideWithLimiter')
      .mockImplementation(async req => {
        expect(Object.keys(req.questions)).toEqual(
          expect.arrayContaining([
            'b0_genre_primary',
            'b0_genre_has_sub',
            'b0_genre_sub',
            'b0_seriesGate_is_series',
            'b1_genre_primary',
            'b1_genre_has_sub',
            'b1_genre_sub',
            'b1_seriesGate_is_series',
          ]),
        );

        const answers: Record<string, DecisionAnswerPayload> = {
          b0_genre_primary: {
            type: 'choice',
            choice: 'Science Fiction',
            confidence: 0.92,
            probabilities: {
              'Science Fiction': 0.92,
              'Literary & Classic Fiction': 0.08,
            },
          },
          b0_genre_has_sub: {
            type: 'noul',
            noul: 0.88,
          },
          b0_genre_sub: {
            type: 'choice',
            choice: 'Space Opera',
            confidence: 0.85,
            probabilities: {'Space Opera': 0.85, 'Hard Sci-Fi': 0.15},
          },
          b0_seriesGate_is_series: {
            type: 'noul',
            noul: 0.94,
          },
          b1_genre_primary: {
            type: 'choice',
            choice: 'Literary & Classic Fiction',
            confidence: 0.84,
            probabilities: {
              'Literary & Classic Fiction': 0.84,
              History: 0.16,
            },
          },
          b1_genre_has_sub: {
            type: 'noul',
            noul: 0.76,
          },
          b1_genre_sub: {
            type: 'choice',
            choice: 'Classics (Pre-1945)',
            confidence: 0.81,
            probabilities: {
              'Classics (Pre-1945)': 0.81,
              'Contemporary Fiction': 0.19,
            },
          },
          b1_seriesGate_is_series: {
            type: 'noul',
            noul: 0.07,
          },
        };
        return answers;
      });

    const result = await evaluateGenreAndSeriesGateCoalesced([
      {id: 'dune-1', title: 'Dune', author: 'Frank Herbert'},
      {id: 'stoner-1', title: 'Stoner', author: 'John Williams'},
    ]);

    expect(decideSpy).toHaveBeenCalledTimes(1);

    const duneGenre = result.genresByBookId.get('dune-1');
    expect(duneGenre?.primaryGenre).toBe('Science Fiction');
    expect(duneGenre?.subgenres).toContain('Space Opera');
    expect(duneGenre?.confidence).toBeCloseTo(0.92, 2);

    const duneSeries = result.seriesGateByBookId.get('dune-1');
    expect(duneSeries?.isSeriesCandidate).toBe(true);
    expect(duneSeries?.noul).toBeCloseTo(0.94, 2);

    const stonerGenre = result.genresByBookId.get('stoner-1');
    expect(stonerGenre?.primaryGenre).toBe('Literary & Classic Fiction');
    expect(stonerGenre?.subgenres).toContain('Classics (Pre-1945)');
    expect(stonerGenre?.confidence).toBeCloseTo(0.84, 2);

    const stonerSeries = result.seriesGateByBookId.get('stoner-1');
    expect(stonerSeries?.isSeriesCandidate).toBe(false);
    expect(stonerSeries?.noul).toBeCloseTo(0.07, 2);
  });

  it('supports arbitrary custom contributors without special-casing', async () => {
    const decideSpy = vi
      .spyOn(geminiClient, 'decideWithLimiter')
      .mockResolvedValue({
        b0_customFlag_check: {type: 'noul', noul: 0.77},
        b0_seriesGate_is_series: {type: 'noul', noul: 0.2},
      });

    const customContributor = {
      id: 'customFlag',
      estimatedQuestionsPerBook: 1,
      appendQuestions(
        questions: Record<string, unknown>,
        book: {title: string},
        idx: number,
        prefix: string,
      ) {
        (questions as Record<string, object>)[`${prefix}_check`] = {
          type: 'noul',
          instructions: `Check ${idx}: ${book.title}`,
          criteria: {
            true_description: 'Yes',
            false_description: 'No',
          },
        };
      },
      resolveBookResult(
        _book: unknown,
        _idx: number,
        answers: Record<string, DecisionAnswerPayload>,
        prefix: string,
      ) {
        const ans = answers[`${prefix}_check`];
        return ans?.type === 'noul' ? ans.noul >= 0.5 : false;
      },
    };

    const map = await runCoalescedDecisionsBatch(
      [{id: 'b-1', title: 'Meditations', author: 'Marcus Aurelius'}],
      [customContributor, createSeriesGateDecisionContributor()],
    );

    expect(decideSpy).toHaveBeenCalledTimes(1);
    expect(map.get('customFlag')?.get('b-1')).toBe(true);
    expect(
      (
        map.get('seriesGate')?.get('b-1') as {
          isSeriesCandidate: boolean;
        }
      ).isSeriesCandidate,
    ).toBe(false);
  });

  it('respects customGenres in createGenreDecisionContributor', async () => {
    vi.spyOn(geminiClient, 'decideWithLimiter').mockResolvedValue({
      b0_genre_primary: {
        type: 'choice',
        choice: 'Weird Archival Fiction',
        confidence: 0.89,
        probabilities: {'Weird Archival Fiction': 0.89, Other: 0.11},
      },
      b0_genre_has_sub: {type: 'noul', noul: 0.1},
      b0_genre_sub: {
        type: 'choice',
        choice: 'Literary',
        confidence: 0.3,
        probabilities: {Literary: 0.3},
      },
    });

    const map = await runCoalescedDecisionsBatch(
      [{id: 'b-weird', title: 'Piranesi', author: 'Susanna Clarke'}],
      [
        createGenreDecisionContributor({
          customGenres: ['Weird Archival Fiction'],
        }),
      ],
    );

    const classified = map.get('genre')?.get('b-weird') as {
      primaryGenre: string;
      isCustomPrimary?: boolean;
      confidence?: number;
    };
    expect(classified.primaryGenre).toBe('Weird Archival Fiction');
    expect(classified.isCustomPrimary).toBe(true);
    expect(classified.confidence).toBeCloseTo(0.89, 2);
  });
});
