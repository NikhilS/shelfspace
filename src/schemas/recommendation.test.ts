import {describe, it, expect} from 'vitest';
import {
  bookRecommendationItemSchema,
  getRecommendationsInputSchema,
  getRecommendationsOutputSchema,
} from './recommendation';

describe('recommendation schemas', () => {
  it('validates a well-formed book recommendation item across all sources', () => {
    const aiItem = bookRecommendationItemSchema.parse({
      id: 'rec-ai-1',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      isbn: '9780441478125',
      coverUrl: 'https://covers.openlibrary.org/b/isbn/9780441478125-L.jpg',
      primaryGenre: 'Science Fiction',
      subgenres: ['Anthropological Sci-Fi'],
      source: 'ai_curator',
      reason:
        'Bridges the ecological worldbuilding of Dune with deep philosophical inquiry.',
      matchTag: 'Because you loved Dune',
    });

    expect(aiItem.source).toBe('ai_curator');
    expect(aiItem.title).toBe('The Left Hand of Darkness');

    const shelfItem = bookRecommendationItemSchema.parse({
      id: 'rec-shelf-1',
      title: 'The Dispossessed',
      author: 'Ursula K. Le Guin',
      source: 'shelf',
      reason: 'Waiting on your shelves in Shared Family Library.',
      matchTag: 'On Your Shelf · Shared Family Library',
      libraryId: 'lib-2',
      libraryName: 'Shared Family Library',
      bookId: 'book-99',
      readingStatus: 'unset',
    });

    expect(shelfItem.source).toBe('shelf');
    expect(shelfItem.libraryId).toBe('lib-2');
  });

  it('applies defaults to getRecommendationsInputSchema', () => {
    const parsed = getRecommendationsInputSchema.parse({});
    expect(parsed).toEqual({
      filter: 'all',
      limit: 12,
      includeAi: true,
      refreshSeed: 0,
    });
  });

  it('validates getRecommendationsOutputSchema', () => {
    const output = getRecommendationsOutputSchema.parse({
      items: [],
      tasteSummary: {
        topGenres: ['Science Fiction'],
        topAuthors: ['Frank Herbert'],
        activeSeries: ['Dune Chronicles'],
        finishedCount: 4,
        unreadShelfCount: 2,
      },
    });
    expect(output.tasteSummary.finishedCount).toBe(4);
  });
});
