import {describe, it, expect} from 'vitest';
import {
  detectDuplicatesWithConfidence,
  normalizeTitleForDedupe,
  normalizeAuthorForDedupe,
  computeBookDedupeKey,
  computeBookSearchTokens,
  extractPrimarySearchToken,
  diceCoefficient,
} from './duplicateDetection';
import {Book} from '../types';

const makeBook = (overrides: Partial<Book> & {id: string}): Book => ({
  title: 'Untitled',
  author: 'Unknown',
  addedBy: 'u1',
  addedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

describe('duplicateDetection', () => {
  it('normalizes titles by stripping subtitles, series tags, and leading articles', () => {
    expect(
      normalizeTitleForDedupe(
        'The Fellowship of the Ring (Lord of the Rings, #1)',
        true,
      ),
    ).toBe('fellowship of the ring');
    expect(
      normalizeTitleForDedupe('Dune: Deluxe Collector Edition', true),
    ).toBe('dune');
  });

  it('normalizes Last, First author formats', () => {
    expect(normalizeAuthorForDedupe('Herbert, Frank')).toBe('frank herbert');
  });

  it('computes deterministic dedupeKey and prefix-capable searchTokens', () => {
    expect(
      computeBookDedupeKey(
        'The Fellowship of the Ring: Illustrated Edition',
        'Tolkien, J.R.R.',
      ),
    ).toBe('fellowship of the ring::j r r tolkien');

    const tokens = computeBookSearchTokens({
      title: 'The Fellowship of the Ring',
      author: 'J.R.R. Tolkien',
      isbn: '978-0544003415',
      series: 'Middle-earth',
    });

    expect(tokens).toContain('9780544003415');
    expect(tokens).toContain('fellowship');
    expect(tokens).toContain('fellow');
    expect(tokens).toContain('tolkien');
    expect(tokens).toContain('tolk');
    expect(extractPrimarySearchToken('Fellowship Ring')).toBe('fellow');
    expect(extractPrimarySearchToken('978-0544003415')).toBe('9780544003415');
  });

  it('detects Exact ISBN duplicates with 100% confidence', () => {
    const books = [
      makeBook({
        id: 'b1',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '978-0441172719',
      }),
      makeBook({
        id: 'b2',
        title: 'Dune (40th Anniversary)',
        author: 'F. Herbert',
        isbn: '9780441172719',
      }),
    ];

    const groups = detectDuplicatesWithConfidence(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe(100);
    expect(groups[0].reason).toBe('Exact ISBN');
  });

  it('detects Fuzzy Title/Subtitle duplicates with >= 88% confidence', () => {
    const books = [
      makeBook({
        id: 'b1',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
      }),
      makeBook({
        id: 'b2',
        title:
          'Left Hand of Darkness: 50th Anniversary Edition (Hainish Cycle, #4)',
        author: 'Le Guin, Ursula K.',
      }),
    ];

    const groups = detectDuplicatesWithConfidence(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBeGreaterThanOrEqual(88);
    expect(diceCoefficient('ursula k le guin', 'ursula k le guin')).toBe(1);
  });

  it('scales blocked fuzzy duplicate detection past 2,600 books without skipping format buckets', () => {
    const syllables = [
      'al',
      'ber',
      'cor',
      'dan',
      'el',
      'fen',
      'gar',
      'hal',
      'iri',
      'jor',
      'kal',
      'lor',
      'mar',
      'nor',
      'or',
      'pel',
      'quen',
      'ral',
      'sar',
      'tor',
      'ul',
      'val',
      'wen',
      'xan',
      'yor',
      'zen',
    ];
    const fillerBooks: Book[] = Array.from({length: 2600}, (_, idx) => {
      const s1 = syllables[idx % syllables.length];
      const s2 =
        syllables[Math.floor(idx / syllables.length) % syllables.length];
      const s3 = syllables[(idx * 7) % syllables.length];
      return makeBook({
        id: `filler-${idx}`,
        title: `${s1}${s2}${idx} ${s3}us`,
        author: `${s2}${s3} ${s1}son-${idx}`,
        format: 'physical',
      });
    });

    const fuzzyPair: Book[] = [
      makeBook({
        id: 'fuzzy-a',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        format: 'physical',
      }),
      makeBook({
        id: 'fuzzy-b',
        title: 'Left Hand of Darkness: 50th Anniversary Edition',
        author: 'Ursula K Le Guin',
        format: 'physical',
      }),
    ];

    const groups = detectDuplicatesWithConfidence([
      ...fillerBooks,
      ...fuzzyPair,
    ]);
    const matchedFuzzyGroup = groups.find(g =>
      g.books.some(b => b.id === 'fuzzy-a'),
    );
    expect(matchedFuzzyGroup).toBeDefined();
    expect(matchedFuzzyGroup?.books.map(b => b.id).sort()).toEqual([
      'fuzzy-a',
      'fuzzy-b',
    ]);
  });
});
