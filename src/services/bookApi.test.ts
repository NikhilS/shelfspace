import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {searchBookByIsbn, searchBookByTitle, clearBookCache} from './bookApi';

// Mock the global fetch
global.fetch = vi.fn();

describe('bookApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clearBookCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchBookByIsbn', () => {
    it('returns book details when Google Books API succeeds', async () => {
      const mockGoogleResponse = {
        items: [
          {
            volumeInfo: {
              title: 'Test Book',
              authors: ['Author One'],
              industryIdentifiers: [
                {type: 'ISBN_13', identifier: '1234567890123'},
              ],
              imageLinks: {thumbnail: 'http://example.com/cover.jpg'},
              publishedDate: '2023-01-01',
            },
          },
        ],
      };

      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoogleResponse,
      });

      const result = await searchBookByIsbn('1234567890123');

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
      expect(result?.author).toBe('Author One');
      expect(result?.isbn).toBe('1234567890123');
      expect(result?.coverUrl).toBe('https://example.com/cover.jpg');
    });

    it('falls back to OpenLibrary when Google Books API returns no items', async () => {
      // Mock Google Books returning nothing
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({items: []}),
      });
      // Mock Google Books fallback query returning nothing
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({items: []}),
      });
      // Mock OpenLibrary
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          docs: [
            {
              title: 'OpenLib Book',
              author_name: ['Author Two'],
              isbn: ['0987654321098'],
              cover_i: 12345,
              first_publish_year: 2021,
            },
          ],
        }),
      });

      const result = await searchBookByIsbn('0987654321098');

      expect(result).not.toBeNull();
      expect(result?.title).toBe('OpenLib Book');
      expect(result?.author).toBe('Author Two');
    });

    it('returns null when both APIs fail', async () => {
      (global.fetch as import('vitest').Mock).mockRejectedValue(
        new Error('Network error'),
      );
      const result = await searchBookByIsbn('0000000000000');
      expect(result).toBeNull();
    });
  });

  describe('searchBookByTitle', () => {
    it('returns an array of books when query succeeds', async () => {
      const mockGoogleResponse = {
        items: [
          {
            volumeInfo: {
              title: 'Test Book Title',
              authors: ['Author One'],
              industryIdentifiers: [
                {type: 'ISBN_13', identifier: '1234567890124'},
              ],
            },
          },
        ],
      };

      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoogleResponse,
      });
      // Google intitle search yielded 1 item. Because length < 5, it triggers the fallback search.
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              volumeInfo: {
                title: 'Fallback Book Title',
                authors: ['Fallback Author'],
                industryIdentifiers: [
                  {type: 'ISBN_13', identifier: '9876543210123'},
                ],
              },
            },
          ],
        }),
      });

      const results = await searchBookByTitle('Test Book Title');
      expect(results.length).toBe(2);
      expect(results[0].title).toBe('Test Book Title');
      expect(results[1].title).toBe('Fallback Book Title');
    });

    it('falls back to OpenLibrary when Google fails, and uses general OpenLibrary search if title search returns empty', async () => {
      // Mock Google Books returning nothing
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({items: []}),
      });
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({items: []}),
      });
      // Mock OpenLibrary returning no docs for title=
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({docs: []}),
      });
      // Mock OpenLibrary returning docs for q=
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          docs: [
            {
              title: 'OpenLib Book Title General',
              author_name: ['Author Two'],
              isbn: ['0987654321098'],
            },
          ],
        }),
      });

      const results = await searchBookByTitle('OpenLib Book Title General');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('OpenLib Book Title General');
    });

    it('sorts exact matches to the top', async () => {
      const mockGoogleResponse = {
        items: [
          {
            volumeInfo: {title: 'Test Book Title Extended'},
          },
          {
            volumeInfo: {title: 'Test Book Title'}, // Exact match should sort to top
          },
          {
            volumeInfo: {title: 'Another Book'},
          },
        ],
      };

      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoogleResponse,
      });
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({items: []}),
      });

      const results = await searchBookByTitle('Test Book Title');
      expect(results[0].title).toBe('Test Book Title');
      expect(results[1].title).toBe('Test Book Title Extended');
    });
  });

  describe('searchBookByTitleAndAuthor', () => {
    it('returns a book when found', async () => {
      (global.fetch as import('vitest').Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              volumeInfo: {
                title: 'Specific Book',
                authors: ['Specific Author'],
              },
            },
          ],
        }),
      });
      const {searchBookByTitleAndAuthor} = await import('./bookApi');
      const result = await searchBookByTitleAndAuthor(
        'Specific Book',
        'Specific Author',
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBe('Specific Book');
      expect(result[0].author).toBe('Specific Author');
    });

    it('returns empty array on failure', async () => {
      (global.fetch as import('vitest').Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );
      const {searchBookByTitleAndAuthor} = await import('./bookApi');
      const result = await searchBookByTitleAndAuthor(
        'Fail Book',
        'Fail Author',
      );
      expect(result).toEqual([]);
    });
  });
});
