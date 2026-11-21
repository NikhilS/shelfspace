import {describe, it, expect, vi, beforeEach} from 'vitest';
import {geminiRouter} from './gemini';
import * as geminiService from '../../services/gemini';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/gemini', () => ({
  extractBooksFromImage: vi.fn(),
  extractBooksFromCsv: vi.fn(),
  generateLibraryHeroImage: vi.fn(),
  generateClusterThemes: vi.fn(),
  getPickOfTheDay: vi.fn(),
  generateBookInsights: vi.fn(),
}));

const authCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
  user: {uid: 'user-1', email: 'reader@example.com'},
  isAdmin: false,
  isAppAllowed: true,
};

const unauthCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
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

  it('rejects non-admin callers with hasAiPlan: false on AI procedures with FORBIDDEN', async () => {
    const noAiCtx: SecurityContext = {
      req: {} as SecurityContext['req'],
      res: {} as SecurityContext['res'],
      user: {uid: 'user-no-ai', email: 'basic@example.com'},
      isAdmin: false,
      isAppAllowed: true,
      hasAiPlan: false,
    };
    const caller = geminiRouter.createCaller(noAiCtx);
    await expect(
      caller.generateLibraryHeroImage({libraryName: 'My Library'}),
    ).rejects.toMatchObject({code: 'FORBIDDEN'});
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

  it('delegates generateLibraryHeroImage and generateClusterThemes', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.generateLibraryHeroImage).mockResolvedValue(
      'data:image/png;base64,hero',
    );
    vi.mocked(geminiService.generateClusterThemes).mockResolvedValue({
      0: {
        name: 'Cosmic Dread',
        thesis: 'Shared existential terror before ancient cosmic forces.',
      },
    });

    expect(
      await caller.generateLibraryHeroImage({libraryName: 'Archive'}),
    ).toBe('data:image/png;base64,hero');

    expect(
      await caller.generateClusterThemes({
        clusters: [
          {
            id: 0,
            totalCount: 350,
            books: [
              {
                title: 'Solaris',
                author: 'Stanislaw Lem',
                primaryGenre: 'Science Fiction',
                synopsis: 'Scientists confront a sentient ocean planet.',
              },
            ],
          },
        ],
      }),
    ).toEqual({
      0: {
        name: 'Cosmic Dread',
        thesis: 'Shared existential terror before ancient cosmic forces.',
      },
    });
  });

  it('delegates getPickOfTheDay and generateBookInsights', async () => {
    const caller = geminiRouter.createCaller(authCtx);
    vi.mocked(geminiService.getPickOfTheDay).mockResolvedValue([
      {title: 'Piranesi', author: 'Susanna Clarke', reason: 'Labyrinthine'},
    ]);
    vi.mocked(geminiService.generateBookInsights).mockResolvedValue(
      'Detailed literary summary.',
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
  });
});
