import {describe, it, expect, vi, beforeEach} from 'vitest';
import {geminiRouter} from './gemini';
import * as geminiService from '../../services/gemini';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/gemini', () => ({
  extractBooksFromImage: vi.fn(),
  extractBooksFromCsv: vi.fn(),
  generateLibraryHeroImage: vi.fn(),
  generateClusterNames: vi.fn(),
  generateBookEmbeddings: vi.fn(),
  getPickOfTheDay: vi.fn(),
  generateBookInsights: vi.fn(),
  generateLibraryRecommendations: vi.fn(),
  classifyBooks: vi.fn(),
  extractBookGeoMetadataBatch: vi.fn(),
  extractBookTemporalMetadataBatch: vi.fn(),
}));

const authCtx: SecurityContext = {
  user: {uid: 'user-1', email: 'reader@example.com'},
  isAdmin: false,
  isAppAllowed: true,
};

const unauthCtx: SecurityContext = {
  user: null,
  isAdmin: false,
  isAppAllowed: false,
};

describe('geminiRouter tRPC procedures & security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers with UNAUTHORIZED', async () => {
    const caller = geminiRouter.createCaller(unauthCtx);
    await expect(
      caller.generateLibraryHeroImage({libraryName: 'My Library'}),
    ).rejects.toMatchObject({code: 'UNAUTHORIZED'});
  });

  it('enforces MIME allowlist and 15MB cap on extractBooksFromImage', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.extractBooksFromImage).mockResolvedValue([
      {title: 'Dune', author: 'Frank Herbert'},
    ]);

    const res = await caller.extractBooksFromImage({
      base64Image: 'data:image/jpeg;base64,abc',
      mimeType: 'image/jpeg',
    });
    expect(res).toEqual([{title: 'Dune', author: 'Frank Herbert'}]);

    // Reject disallowed SVG MIME type
    await expect(
      caller.extractBooksFromImage({
        base64Image: 'abc',
        mimeType: 'image/svg+xml' as 'image/png',
      }),
    ).rejects.toThrow();
  });

  it('delegates extractBooksFromCsv and enforces 500KB limit', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.extractBooksFromCsv).mockResolvedValue([
      {title: 'Neuromancer', author: 'William Gibson'},
    ]);

    const res = await caller.extractBooksFromCsv({
      csvText: 'Title,Author\nNeuromancer,William Gibson',
    });
    expect(res).toEqual([{title: 'Neuromancer', author: 'William Gibson'}]);

    await expect(
      caller.extractBooksFromCsv({csvText: 'x'.repeat(500_005)}),
    ).rejects.toThrow(/500KB/);
  });

  it('delegates generateLibraryHeroImage, generateClusterNames, and generateBookEmbeddings', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.generateLibraryHeroImage).mockResolvedValue(
      'data:image/png;base64,hero',
    );
    vi.mocked(geminiService.generateClusterNames).mockResolvedValue({
      0: 'Cosmic Dread',
    });
    vi.mocked(geminiService.generateBookEmbeddings).mockResolvedValue([
      [0.1, 0.2],
    ]);

    expect(
      await caller.generateLibraryHeroImage({libraryName: 'Archive'}),
    ).toBe('data:image/png;base64,hero');

    expect(
      await caller.generateClusterNames({
        clusters: [
          {id: 0, books: [{title: 'Solaris', author: 'Stanislaw Lem'}]},
        ],
      }),
    ).toEqual({0: 'Cosmic Dread'});

    expect(
      await caller.generateBookEmbeddings({texts: ['Solaris by Lem']}),
    ).toEqual([[0.1, 0.2]]);

    // Reject > 100 embedding texts
    await expect(
      caller.generateBookEmbeddings({
        texts: Array.from({length: 101}, (_, i) => `Text ${i}`),
      }),
    ).rejects.toThrow(/Maximum 100/);
  });

  it('delegates getPickOfTheDay, generateBookInsights, and generateLibraryRecommendations', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.getPickOfTheDay).mockResolvedValue([
      {title: 'Piranesi', author: 'Susanna Clarke', reason: 'Labyrinthine'},
    ]);
    vi.mocked(geminiService.generateBookInsights).mockResolvedValue(
      'Detailed literary summary.',
    );
    vi.mocked(geminiService.generateLibraryRecommendations).mockResolvedValue(
      '## Recommended Book',
    );

    expect(
      await caller.getPickOfTheDay({
        books: [{title: 'The Starless Sea', author: 'Erin Morgenstern'}],
      }),
    ).toHaveLength(1);

    expect(
      await caller.generateBookInsights({
        title: 'Piranesi',
        author: 'Susanna Clarke',
        type: 'summary',
      }),
    ).toBe('Detailed literary summary.');

    expect(
      await caller.generateLibraryRecommendations({
        books: [{title: 'Piranesi', author: 'Susanna Clarke'}],
      }),
    ).toBe('## Recommended Book');
  });

  it('delegates classifyBooks, extractBookGeoMetadataBatch, and extractBookTemporalMetadataBatch', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.classifyBooks).mockResolvedValue([
      {id: 'book-1', primaryGenre: 'Science Fiction', subgenres: ['Cyberpunk']},
    ]);
    vi.mocked(geminiService.extractBookGeoMetadataBatch).mockResolvedValue({
      enrichment: [{id: 'book-1', isNonEarth: false, locations: []}],
    });
    vi.mocked(geminiService.extractBookTemporalMetadataBatch).mockResolvedValue(
      {
        enrichment: [{id: 'book-1', isNonHistorical: false, startYear: 1984}],
      },
    );

    const sampleBatch = [
      {id: 'book-1', title: 'Neuromancer', author: 'William Gibson'},
    ];

    expect(await caller.classifyBooks({books: sampleBatch})).toEqual([
      {id: 'book-1', primaryGenre: 'Science Fiction', subgenres: ['Cyberpunk']},
    ]);
    expect(
      await caller.extractBookGeoMetadataBatch({books: sampleBatch}),
    ).toEqual({
      enrichment: [{id: 'book-1', isNonEarth: false, locations: []}],
    });
    expect(
      await caller.extractBookTemporalMetadataBatch({books: sampleBatch}),
    ).toEqual({
      enrichment: [{id: 'book-1', isNonHistorical: false, startYear: 1984}],
    });
  });
});
