import {describe, it, expect} from 'vitest';
import {
  resolvePriorityShardsForPathname,
  resolveQueryShardKey,
  sanitizeQueryDataForPersistence,
} from './idbQueryShardPersister';

describe('idbQueryShardPersister', () => {
  it('routes tRPC and editorial query keys to isolated logical shards', () => {
    expect(resolveQueryShardKey([['metadata', 'debugTelemetry']])).toBeNull();
    expect(
      resolveQueryShardKey([['metadata', 'providerCapacities']]),
    ).toBeNull();

    expect(resolveQueryShardKey([['auth', 'getPermissions']])).toBe(
      'core-shell',
    );
    expect(
      resolveQueryShardKey([
        ['library', 'list'],
        {input: {scopes: ['owned', 'shared']}, type: 'query'},
      ]),
    ).toBe('core-shell');

    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getShelf'],
        {input: {shelf: 'all'}, type: 'query'},
      ]),
    ).toBe('reading-room');
    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getUnreadLibraryBooks'],
        {type: 'query'},
      ]),
    ).toBe('reading-room');

    expect(
      resolveQueryShardKey([
        ['book', 'list'],
        {input: {libraryId: 'lib-42'}, type: 'query'},
      ]),
    ).toBe('library:lib-42');

    expect(
      resolveQueryShardKey([
        ['book', 'get'],
        {input: {libraryId: 'lib-42', bookId: 'b-9'}, type: 'query'},
      ]),
    ).toBe('book-detail:lib-42:b-9');

    expect(
      resolveQueryShardKey(['pickOfTheDay', 'reading-room', '2026-11-15', 0]),
    ).toBe('editorial-daily');
    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getRecommendations'],
        {input: {filter: 'all'}, type: 'query'},
      ]),
    ).toBe('editorial-daily');
  });

  it('computes route-aware priority shards for instant <50ms initial hydration', () => {
    expect(resolvePriorityShardsForPathname('/')).toEqual([
      'core-shell',
      'reading-room',
      'editorial-daily',
    ]);
    expect(resolvePriorityShardsForPathname('/library/lib-1')).toEqual([
      'core-shell',
      'library:lib-1',
      'editorial-daily',
    ]);
    expect(
      resolvePriorityShardsForPathname('/library/lib-1/book/book-99'),
    ).toEqual(['core-shell', 'book-detail:lib-1:book-99', 'library:lib-1']);
  });

  it('strips float embeddings without mutating source book objects or JSON stringifying', () => {
    const sourceBook = {
      id: 'b-1',
      title: 'Piranesi',
      embedding: [0.12, -0.44, 0.88],
    };
    const payload = {
      books: [sourceBook],
      totalCount: 1,
    };

    const sanitized = sanitizeQueryDataForPersistence(payload) as {
      books: Array<Record<string, unknown>>;
      totalCount: number;
    };

    expect(sanitized.totalCount).toBe(1);
    expect(sanitized.books[0].title).toBe('Piranesi');
    expect('embedding' in sanitized.books[0]).toBe(false);
    // Original in-memory book retains its embedding for Constellation view
    expect(sourceBook.embedding).toEqual([0.12, -0.44, 0.88]);
  });
});
