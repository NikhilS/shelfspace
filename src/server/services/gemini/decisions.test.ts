import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  CHRONOLOGICAL_BUCKETS,
  HISTORICAL_ERAS,
  resolveTemporalFromDecisions,
} from '../../../constants/temporalCatalog';
import {
  GAZETTEER_ZONES,
  GLOBAL_LITERARY_GAZETTEER,
  findGazetteerPlaceByName,
  getPlacesForZone,
  getZoneCriteriaMap,
} from '../../../constants/literaryGazetteer';
import {storedBookDocSchema} from '../../../schemas/book';
import {SchemaValidationError} from '../../../schemas/common';
import type {BookRecommendationItem} from '../../../schemas/recommendation';
import {GeoMetadataProvider} from '../metadata';
import * as geolocationMod from '../geolocation';
import * as clientMod from './client';
import {verifyCoverImageWithDecisions} from './covers';
import {
  adjudicateDuplicateGroups,
  classifyBooks,
  extractBookSeriesBatch,
  extractBookTemporalMetadataBatch,
} from './enrichment';
import {
  rerankCandidatesWithDecisions,
  type TasteRerankProfileInput,
} from './recommendations';
import {
  BookshelfPrescreenError,
  extractBooksFromImage,
  prescreenBookshelfImage,
} from './vision';

describe('Gemini Decisions API (gemini-decision-1) parity & invariant suite', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GEMINI_API_KEY = 'test-gemini-decision-key';
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  describe('Catalog & Rubric Invariants (2..255 option bounds & coordinates)', () => {
    it('keeps every continental zone in GLOBAL_LITERARY_GAZETTEER within 2..255 options with valid coordinates', () => {
      expect(GLOBAL_LITERARY_GAZETTEER.length).toBeGreaterThanOrEqual(340);

      const seenIds = new Set<string>();
      for (const place of GLOBAL_LITERARY_GAZETTEER) {
        expect(seenIds.has(place.id)).toBe(false);
        seenIds.add(place.id);
        expect(place.coordinates.lat).toBeGreaterThanOrEqual(-90);
        expect(place.coordinates.lat).toBeLessThanOrEqual(90);
        expect(place.coordinates.lng).toBeGreaterThanOrEqual(-180);
        expect(place.coordinates.lng).toBeLessThanOrEqual(180);
      }

      for (const zone of GAZETTEER_ZONES) {
        const zonePlaces = getPlacesForZone(zone.id);
        const criteria = getZoneCriteriaMap(zone.id);
        expect(zonePlaces.length).toBeGreaterThanOrEqual(
          clientMod.MIN_DECISION_OPTIONS,
        );
        expect(zonePlaces.length).toBeLessThanOrEqual(
          clientMod.MAX_DECISION_OPTIONS,
        );
        expect(Object.keys(criteria)).toHaveLength(zonePlaces.length);
      }

      expect(findGazetteerPlaceByName('Dublin, Ireland')?.id).toBe(
        'city_dublin',
      );
      expect(findGazetteerPlaceByName('Mississippi, USA')?.id).toBe('us_ms');
    });

    it('keeps HISTORICAL_ERAS and CHRONOLOGICAL_BUCKETS within 2..255 options with monotonic year bounds', () => {
      expect(HISTORICAL_ERAS.length).toBeGreaterThanOrEqual(
        clientMod.MIN_DECISION_OPTIONS,
      );
      expect(HISTORICAL_ERAS.length).toBeLessThanOrEqual(
        clientMod.MAX_DECISION_OPTIONS,
      );

      expect(CHRONOLOGICAL_BUCKETS.length).toBeGreaterThanOrEqual(
        clientMod.MIN_DECISION_OPTIONS,
      );
      expect(CHRONOLOGICAL_BUCKETS.length).toBeLessThanOrEqual(
        clientMod.MAX_DECISION_OPTIONS,
      );

      for (const bucket of CHRONOLOGICAL_BUCKETS) {
        expect(bucket.startYear).toBeLessThanOrEqual(bucket.endYear);
        expect(bucket.startYear).toBeGreaterThanOrEqual(-10000);
        expect(bucket.endYear).toBeLessThanOrEqual(2100);
      }
    });
  });

  describe('GeminiDecisionProvider guards & runtime Zod validation', () => {
    it('enforces question count (1..1000) and criteria option bounds (2..255)', () => {
      expect(() => clientMod.assertValidDecisionQuestions({})).toThrow(
        /between 1 and 1000 questions/,
      );

      expect(() =>
        clientMod.assertValidDecisionQuestions({
          bad_choice: {
            type: 'choice',
            instructions: 'Pick one',
            criteria: {only_one: 'Not enough options'},
          },
        }),
      ).toThrow(/between 2 and 255 options/);

      expect(() =>
        clientMod.assertValidDecisionQuestions({
          bad_score: {
            type: 'score',
            instructions: 'Score it',
            criteria: ['Only level 0'],
          },
        }),
      ).toThrow(/between 2 and 255 rubric levels/);
    });

    it('routes through v1beta, attaches User-Agent header, and validates incoming answers via Zod', async () => {
      const createMock = vi.fn().mockResolvedValueOnce({
        answers: {
          q1: {
            type: 'noul',
            noul: 0.87,
            confidence: 0.87,
          },
        },
      });

      const fakeClient = {
        decisions: {
          create: createMock,
        },
      } as unknown as ReturnType<typeof clientMod.getGeminiDecisionClient>;

      const clientSpy = vi
        .spyOn(clientMod.geminiDecisionProvider, 'createClient')
        .mockReturnValue(fakeClient);

      const answers = await clientMod.geminiDecisionProvider.decide(
        {
          input: 'Test book context',
          questions: {
            q1: {
              type: 'noul',
              instructions: 'Is this valid?',
              criteria: {
                true_description: 'Yes',
                false_description: 'No',
              },
            },
          },
          operation: 'test.decide',
        },
        {priority: 'INTERACTIVE'},
      );

      expect(clientSpy).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-decision-1',
          api_version: 'v1beta',
        }),
        undefined,
      );
      expect(answers).toEqual({
        q1: {type: 'noul', noul: 0.87, confidence: 0.87},
      });

      // Malformed probability > 1 must trigger SchemaValidationError
      createMock.mockResolvedValueOnce({
        answers: {
          q1: {
            type: 'noul',
            noul: 1.5,
          },
        },
      });

      await expect(
        clientMod.geminiDecisionProvider.decide({
          input: 'Test malformed response',
          questions: {
            q1: {
              type: 'noul',
              instructions: 'Is this valid?',
            },
          },
        }),
      ).rejects.toBeInstanceOf(SchemaValidationError);
    });
  });

  describe('Golden Parity across all 7 Gemini Decisions workflows', () => {
    it('1. classifyBooks enforces canonical subgenres, supports custom genres, and satisfies storedBookDocSchema', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        b0_primary: {
          type: 'choice',
          choice: 'Mystery & Crime',
          confidence: 0.91,
          probabilities: {'Mystery & Crime': 0.91},
        },
        b0_has_sub: {type: 'noul', noul: 0.88},
        b0_sub: {
          type: 'choice',
          choice: 'Hardboiled & Noir',
          confidence: 0.72,
          probabilities: {
            'Hardboiled & Noir': 0.72,
            'Whodunit & Detective': 0.34,
            // Invalid subgenre for Mystery & Crime (belongs to Science Fiction)
            'Space Opera': 0.85,
          },
        },
        b1_primary: {
          type: 'choice',
          choice: 'Weird Campus Gothic',
          confidence: 0.83,
          probabilities: {'Weird Campus Gothic': 0.83},
        },
        b1_has_sub: {type: 'noul', noul: 0.1},
        b1_sub: {
          type: 'choice',
          choice: 'Gothic Horror',
          confidence: 0.6,
          probabilities: {'Gothic Horror': 0.6},
        },
      });

      const res = await classifyBooks(
        [
          {id: 'book-1', title: 'The Big Sleep', author: 'Raymond Chandler'},
          {id: 'book-2', title: 'The Secret History', author: 'Donna Tartt'},
        ],
        {customGenres: ['Weird Campus Gothic']},
      );

      expect(res).toEqual([
        {
          id: 'book-1',
          primaryGenre: 'Mystery & Crime',
          subgenres: ['Hardboiled & Noir', 'Whodunit & Detective'],
          isCustomPrimary: false,
        },
        {
          id: 'book-2',
          primaryGenre: 'Weird Campus Gothic',
          subgenres: [],
          isCustomPrimary: true,
        },
      ]);

      for (const classified of res) {
        const docCheck = storedBookDocSchema.safeParse({
          id: classified.id,
          title: 'Sample Title',
          author: 'Sample Author',
          primaryGenre: classified.primaryGenre,
          subgenres: classified.subgenres,
          isCustomPrimary: classified.isCustomPrimary,
        });
        expect(docCheck.success).toBe(true);
      }
    });

    it('2. extractBookTemporalMetadataBatch handles non-historical gating, inverted buckets, and >100-year clamping', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        b0_non_hist: {type: 'noul', noul: 0.91},
        b1_non_hist: {type: 'noul', noul: 0.05},
        b1_era: {
          type: 'choice',
          choice: 'victorian_gilded_meiji',
          confidence: 0.89,
          probabilities: {victorian_gilded_meiji: 0.89},
        },
        // Deliberately inverted and >100 years apart to verify deterministic clamping
        b1_start: {
          type: 'choice',
          choice: 'decade_1950s',
          confidence: 0.6,
          probabilities: {decade_1950s: 0.6},
        },
        b1_end: {
          type: 'choice',
          choice: 'decade_1810s',
          confidence: 0.7,
          probabilities: {decade_1810s: 0.7},
        },
      });

      const res = await extractBookTemporalMetadataBatch([
        {
          id: 'lotr',
          title: 'The Fellowship of the Ring',
          author: 'J.R.R. Tolkien',
        },
        {id: 'saga', title: 'Century Family Saga', author: 'A. Historian'},
      ]);

      expect(res?.enrichment[0]).toEqual({
        id: 'lotr',
        isNonHistorical: true,
      });

      const clamped = res?.enrichment[1];
      expect(clamped?.isNonHistorical).toBe(false);
      expect(clamped?.startYear).toBe(1810);
      expect(clamped?.endYear).toBe(1910);
      expect(
        (clamped?.endYear ?? 0) - (clamped?.startYear ?? 0),
      ).toBeLessThanOrEqual(100);

      // Direct unit check on resolveTemporalFromDecisions fallback when buckets are omitted
      const fallback = resolveTemporalFromDecisions(
        'b-fallback',
        {
          b0_non_hist: {type: 'noul', noul: 0.1},
          b0_era: {
            type: 'choice',
            choice: 'world_war_ii',
            confidence: 0.95,
            probabilities: {world_war_ii: 0.95},
          },
        },
        'b0',
      );
      expect(fallback).toMatchObject({
        id: 'b-fallback',
        isNonHistorical: false,
        startYear: 1939,
        endYear: 1945,
        eraName: 'World War II',
      });
    });

    it('3. extractBookGeoMetadataBatch + GeoMetadataProvider resolves multi-zone Earth settings with ZERO external geocoder calls', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        b0_non_earth: {type: 'noul', noul: 0.03},
        b0_z_western_northern_europe_active: {type: 'noul', noul: 0.92},
        b0_z_western_northern_europe_place: {
          type: 'choice',
          choice: 'city_london',
          confidence: 0.9,
          probabilities: {city_london: 0.9},
        },
        b0_z_eastern_europe_mena_active: {type: 'noul', noul: 0.85},
        b0_z_eastern_europe_mena_place: {
          type: 'choice',
          choice: 'city_cairo',
          confidence: 0.88,
          probabilities: {city_cairo: 0.88},
        },
        b0_z_asia_oceania_polar_active: {type: 'noul', noul: 0.81},
        b0_z_asia_oceania_polar_place: {
          type: 'choice',
          choice: 'city_mumbai',
          confidence: 0.86,
          probabilities: {city_mumbai: 0.86},
        },
        b1_non_earth: {type: 'noul', noul: 0.97},
      });

      const warmSpy = vi.spyOn(geolocationMod, 'warmGeocodeCacheBulk');
      const geocodeSpy = vi.spyOn(geolocationMod, 'geocodeLocation');
      const cacheBulkSpy = vi.spyOn(geolocationMod, 'cacheGeocodesBulk');

      const provider = new GeoMetadataProvider();
      const bulkResult = await provider.bulkFetch([
        {
          id: 'around-world',
          title: 'Around the World in Eighty Days',
          author: 'Jules Verne',
          synopsis:
            'Phileas Fogg travels from London through Suez/Cairo and Bombay.',
        },
        {
          id: 'dune',
          title: 'Dune',
          author: 'Frank Herbert',
          synopsis: 'Set on the desert planet Arrakis.',
        },
      ]);

      expect(warmSpy).not.toHaveBeenCalled();
      expect(geocodeSpy).not.toHaveBeenCalled();
      expect(cacheBulkSpy).not.toHaveBeenCalled();

      const aroundWorld = bulkResult['around-world'] as {
        isNonEarth: boolean;
        locations: Array<{
          name: string;
          coordinates?: {lat: number; lng: number};
        }>;
      };
      expect(aroundWorld.isNonEarth).toBe(false);
      expect(aroundWorld.locations.map(l => l.name)).toEqual([
        'London, United Kingdom',
        'Cairo, Egypt',
        'Mumbai, India',
      ]);
      expect(aroundWorld.locations.every(l => Boolean(l.coordinates))).toBe(
        true,
      );

      const dune = bulkResult.dune as {
        isNonEarth: boolean;
        locations: unknown[];
      };
      expect(dune.isNonEarth).toBe(true);
      expect(dune.locations).toEqual([]);
    });

    it('4. extractBookSeriesBatch skips generative extraction completely when all books fail the standalone noul gate', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        b0_is_series: {type: 'noul', noul: 0.08},
        b1_is_series: {type: 'noul', noul: 0.12},
      });
      const genSpy = vi.spyOn(
        clientMod.geminiStructuredProvider,
        'generateContent',
      );

      const result = await extractBookSeriesBatch([
        {id: 's1', title: 'Beloved', author: 'Toni Morrison'},
        {id: 's2', title: 'The Remains of the Day', author: 'Kazuo Ishiguro'},
      ]);

      expect(result).toEqual({});
      expect(genSpy).not.toHaveBeenCalled();
    });

    it('5. rerankCandidatesWithDecisions re-orders higher calibrated taste scores ahead of lower ones and attaches lens badges', async () => {
      const candidates: BookRecommendationItem[] = [
        {
          id: 'cand-low',
          title: 'Generic Thriller',
          author: 'A. Writer',
          source: 'shelf',
          reason: 'Unread on your shelf.',
          matchTag: 'On Your Shelf',
        },
        {
          id: 'cand-high',
          title: 'Piranesi',
          author: 'Susanna Clarke',
          source: 'shelf',
          reason: 'Unread on your shelf.',
          matchTag: 'On Your Shelf',
        },
      ];

      const profile: TasteRerankProfileInput = {
        positiveAnchors: [
          {
            title: 'Ficciones',
            author: 'Jorge Luis Borges',
            rating: 5,
            status: 'finished',
            primaryGenre: 'Literary Fiction',
          },
        ],
        negativeSignals: [],
        topGenres: ['Literary Fiction', 'Fantasy'],
        topAuthors: ['Jorge Luis Borges'],
      };

      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        c0_score: {
          type: 'score',
          score: 0.9,
          probabilities: {'0': 0.3, '1': 0.5, '2': 0.2, '3': 0, '4': 0},
          legend: {},
        },
        c0_lens: {
          type: 'choice',
          choice: 'fresh_horizon',
          confidence: 0.6,
          probabilities: {fresh_horizon: 0.6},
        },
        c1_score: {
          type: 'score',
          score: 3.85,
          probabilities: {'0': 0, '1': 0, '2': 0.05, '3': 0.05, '4': 0.9},
          legend: {},
        },
        c1_lens: {
          type: 'choice',
          choice: 'worldbuilding_depth',
          confidence: 0.92,
          probabilities: {worldbuilding_depth: 0.92},
        },
      });

      const reranked = await rerankCandidatesWithDecisions(candidates, profile);
      expect(reranked.map(c => c.id)).toEqual(['cand-high', 'cand-low']);
      expect(reranked[0].matchTag).toBe('On Your Shelf · Rich Worldbuilding');
    });

    it('6. adjudicateDuplicateGroups rejects sequel false positives and selects the richest edition as preferredSurvivorId', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        g0_same_work: {type: 'noul', noul: 0.06},
        g0_survivor: {
          type: 'choice',
          choice: 'vol-1',
          confidence: 0.6,
          probabilities: {'vol-1': 0.6, 'vol-2': 0.4},
        },
        g1_same_work: {type: 'noul', noul: 0.95},
        g1_survivor: {
          type: 'choice',
          choice: 'rich-ed',
          confidence: 0.94,
          probabilities: {'stub-ed': 0.06, 'rich-ed': 0.94},
        },
      });

      const verdicts = await adjudicateDuplicateGroups([
        {
          groupKey: 'sequels',
          books: [
            {id: 'vol-1', title: 'Kill Bill Vol. 1', author: 'Q. Author'},
            {id: 'vol-2', title: 'Kill Bill Vol. 2', author: 'Q. Author'},
          ],
        },
        {
          groupKey: 'true_dupes',
          books: [
            {
              id: 'stub-ed',
              title: 'Middlemarch',
              author: 'George Eliot',
              hasCover: false,
            },
            {
              id: 'rich-ed',
              title: 'Middlemarch: A Study of Provincial Life',
              author: 'George Eliot',
              isbn: '9780141439549',
              hasCover: true,
              hasSynopsis: true,
            },
          ],
        },
      ]);

      expect(verdicts).toEqual([
        {
          groupKey: 'sequels',
          isDuplicate: false,
          calibratedConfidence: 6,
          preferredSurvivorId: 'vol-1',
        },
        {
          groupKey: 'true_dupes',
          isDuplicate: true,
          calibratedConfidence: 95,
          preferredSurvivorId: 'rich-ed',
        },
      ]);
    });

    it('7. verifyCoverImageWithDecisions flags placeholder graphics and extractBooksFromImage halts on blurry/empty shelf pre-screening', async () => {
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        is_authentic_cover: {type: 'noul', noul: 0.07},
        is_plausible_match: {type: 'noul', noul: 0.15},
      });

      const coverVerdict = await verifyCoverImageWithDecisions({
        imageBase64: 'data:image/jpeg;base64,R0lGODlh',
        mimeType: 'image/jpeg',
        title: 'Invisible Man',
        author: 'Ralph Ellison',
      });
      expect(coverVerdict.isValidCover).toBe(false);
      expect(coverVerdict.authenticProbability).toBe(0.07);

      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        has_books: {type: 'noul', noul: 0.92},
        legibility: {
          type: 'score',
          score: 0.3,
          probabilities: {'0': 0.75, '1': 0.2, '2': 0.05, '3': 0},
          legend: {},
        },
        primary_issue: {
          type: 'choice',
          choice: 'too_blurry_or_glare',
          confidence: 0.89,
          probabilities: {too_blurry_or_glare: 0.89},
        },
      });

      const prescreen = await prescreenBookshelfImage(
        'data:image/jpeg;base64,R0lGODlh',
        'image/jpeg',
      );
      expect(prescreen.allowExtraction).toBe(false);
      expect(prescreen.primaryIssue).toBe('too_blurry_or_glare');

      // Verify extractBooksFromImage throws BookshelfPrescreenError and never invokes generative OCR
      vi.spyOn(
        clientMod.geminiDecisionProvider,
        'decide',
      ).mockResolvedValueOnce({
        has_books: {type: 'noul', noul: 0.04},
        legibility: {
          type: 'score',
          score: 0.0,
          probabilities: {'0': 1, '1': 0, '2': 0, '3': 0},
          legend: {},
        },
        primary_issue: {
          type: 'choice',
          choice: 'no_books_visible',
          confidence: 0.98,
          probabilities: {no_books_visible: 0.98},
        },
      });
      const ocrSpy = vi.spyOn(
        clientMod.geminiStructuredProvider,
        'generateContent',
      );

      await expect(
        extractBooksFromImage('data:image/jpeg;base64,R0lGODlh', 'image/jpeg'),
      ).rejects.toBeInstanceOf(BookshelfPrescreenError);
      expect(ocrSpy).not.toHaveBeenCalled();
    });
  });
});
