import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as clientMod from './client';
import {
  generateClusterNames,
  generateClusterThemes,
  generateBookEmbeddings,
} from './embeddings';
import {
  classifyBooks,
  extractBookGeoMetadataBatch,
  extractBookTemporalMetadataBatch,
  generateBookSynopsesBatch,
  generateAuthorBiosBatch,
  extractBookSeriesBatch,
  getPickOfTheDay,
} from './enrichment';
import {generateLibraryHeroImage} from './covers';
import {extractBooksFromCsv, extractBooksFromImage} from './vision';

describe('gemini service unit suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects API key errors and normalizes 429 / generic errors in handleGeminiError', () => {
    expect(clientMod.isApiKeyError(new Error('GEMINI_API_KEY missing'))).toBe(
      true,
    );
    expect(clientMod.isApiKeyError(new Error('Normal network timeout'))).toBe(
      false,
    );

    expect(() =>
      clientMod.handleGeminiError({status: 429, message: 'Rate limit'}),
    ).toThrow(/exceeded its quota limit/);

    expect(() =>
      clientMod.handleGeminiError(new Error('Upstream reset')),
    ).toThrow(/Failed to communicate with the AI service/);
  });

  it('parses markdown-fenced JSON in batchGeminiOperation and returns null on API key error', async () => {
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: '```json\n[{"id":"b1","synopsis":"A classic tale."}]\n```',
    } as never);

    const synopses = await generateBookSynopsesBatch([
      {id: 'b1', title: 'Moby-Dick', author: 'Herman Melville'},
    ]);
    expect(synopses).toEqual({b1: 'A classic tale.'});

    // Returns null gracefully when API key is missing
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockRejectedValueOnce(new Error('GEMINI_API_KEY not valid'));

    const bios = await generateAuthorBiosBatch([
      {id: 'b1', title: 'Moby-Dick', author: 'Herman Melville'},
    ]);
    expect(bios).toEqual({});
  });

  it('parses array and object formats in generateClusterNames/generateClusterThemes and handles generateBookEmbeddings progress', async () => {
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify([
        {
          id: 0,
          name: '  Cosmic Dread  ',
          thesis: '  Expeditions into incomprehensible ancient frontiers.  ',
        },
      ]),
    } as never);

    const themes = await generateClusterThemes([
      {
        id: 0,
        totalCount: 12,
        books: [
          {
            title: 'At the Mountains of Madness',
            author: 'H.P. Lovecraft',
            primaryGenre: 'Horror',
            synopsis: 'An Antarctic expedition uncovers ancient ruins.',
          },
        ],
      },
    ]);
    expect(themes).toEqual({
      0: {
        name: 'Cosmic Dread',
        thesis: 'Expeditions into incomprehensible ancient frontiers.',
      },
    });

    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify([{id: 0, name: '  Cosmic Dread  ', thesis: ''}]),
    } as never);

    const names = await generateClusterNames([
      {id: 0, books: [{title: 'At the Mountains of Madness'}]},
    ]);
    expect(names).toEqual({0: 'Cosmic Dread'});

    vi.spyOn(clientMod.geminiEmbeddingProvider, 'embedText').mockResolvedValue([
      0.25, 0.75,
    ]);
    const progressCalls: Array<[number, number]> = [];
    const embeddings = await generateBookEmbeddings(
      ['Book A', 'Book B'],
      (done, total) => progressCalls.push([done, total]),
    );
    expect(embeddings).toEqual([
      [0.25, 0.75],
      [0.25, 0.75],
    ]);
    expect(progressCalls).toHaveLength(2);
  });

  it('sanitizes taxonomy genres in classifyBooks and populates default endYear in extractBookTemporalMetadataBatch', async () => {
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify([
        {
          id: 'b1',
          primaryGenre: 'Science Fiction',
          subgenres: ['Cyberpunk', 'NonExistentSubgenre'],
        },
      ]),
    } as never);

    const classified = await classifyBooks([
      {id: 'b1', title: 'Neuromancer', author: 'William Gibson'},
    ]);
    expect(classified).toEqual([
      {
        id: 'b1',
        primaryGenre: 'Science Fiction',
        subgenres: ['Cyberpunk'],
        isCustomPrimary: false,
      },
    ]);

    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify({
        enrichment: [
          {
            id: 'b1',
            isNonHistorical: false,
            startYear: 1922,
            eraName: 'Jazz Age',
          },
        ],
      }),
    } as never);

    const temporal = await extractBookTemporalMetadataBatch([
      {id: 'b1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald'},
    ]);
    expect(temporal?.enrichment[0].endYear).toBe(1922);
  });

  it('extracts geo metadata, series batch, and pick of the day', async () => {
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify({
        enrichment: [
          {
            id: 'b1',
            isNonEarth: false,
            locations: [
              {
                name: 'Dublin, Ireland',
                adminLevel: 'city',
                rationale: 'Setting of Ulysses',
              },
            ],
          },
        ],
      }),
    } as never);

    const geo = await extractBookGeoMetadataBatch([
      {id: 'b1', title: 'Ulysses', author: 'James Joyce'},
    ]);
    expect(geo?.enrichment[0].locations[0].name).toBe('Dublin, Ireland');

    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify([
        {id: 'b1', isPartOfSeries: true, series: 'Dune Chronicles #1'},
        {id: 'b2', isPartOfSeries: false, series: ''},
      ]),
    } as never);

    const series = await extractBookSeriesBatch([
      {id: 'b1', title: 'Dune', author: 'Frank Herbert'},
      {id: 'b2', title: 'Solaris', author: 'Stanislaw Lem'},
    ]);
    expect(series).toEqual({b1: 'Dune Chronicles #1'});

    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify([
        {
          title: 'Invisible Cities',
          author: 'Italo Calvino',
          reason: 'Poetic architecture',
        },
      ]),
    } as never);

    const picks = await getPickOfTheDay([
      {title: 'Ficciones', author: 'Borges'},
    ]);
    expect(picks).toEqual([
      {
        title: 'Invisible Cities',
        author: 'Italo Calvino',
        reason: 'Poetic architecture',
      },
    ]);
  });

  it('extracts base64 hero image, CSV rows with format/ISBN normalization, and vision image books', async () => {
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {inlineData: {mimeType: 'image/png', data: 'iVBORw0KGgo='}},
            ],
          },
        },
      ],
    } as never);

    const hero = await generateLibraryHeroImage('Sanctuary');
    expect(hero).toBe('data:image/png;base64,iVBORw0KGgo=');

    // Zero-token deterministic fast-path for standard headers (does not call Gemini)
    const csvBooks = await extractBooksFromCsv(
      'Title,Author,ISBN,Binding\nDune,Frank Herbert,978-0-441-17271-9,Kindle Edition\nFoundation,Isaac Asimov,0553293354,Hardcover',
    );
    expect(csvBooks).toEqual([
      {
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        format: 'digital',
      },
      {
        title: 'Foundation',
        author: 'Isaac Asimov',
        isbn: '0553293354',
        format: 'physical',
      },
    ]);

    // Gemini fallback when headers are non-standard
    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: JSON.stringify({
        hasHeaderRow: false,
        columnMap: {title: 0, author: 1, isbn: 2, format: 3},
      }),
    } as never);

    const headerlessCsvBooks = await extractBooksFromCsv(
      'Solaris,Stanislaw Lem,9780156027601,Paperback',
    );
    expect(headerlessCsvBooks).toEqual([
      {
        title: 'Solaris',
        author: 'Stanislaw Lem',
        isbn: '9780156027601',
        format: 'physical',
      },
    ]);

    vi.spyOn(
      clientMod.geminiStructuredProvider,
      'generateContent',
    ).mockResolvedValueOnce({
      text: '```json\n[{"title":"Hyperion","author":"Dan Simmons"}]\n```',
    } as never);

    const imageBooks = await extractBooksFromImage(
      'data:image/jpeg;base64,R0lGODlh',
      'image/jpeg',
    );
    expect(imageBooks).toEqual([{title: 'Hyperion', author: 'Dan Simmons'}]);
  });
});
