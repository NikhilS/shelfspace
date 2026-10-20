import {describe, it, expect} from 'vitest';
import {
  detectDuplicatesWithConfidence,
  normalizeTitleForDedupe,
  normalizeAuthorForDedupe,
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
});
