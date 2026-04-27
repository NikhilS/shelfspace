import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  extractBooksFromImage,
  generateLibraryRecommendations,
  generateBookInsights,
  enrichBooksMetadata,
  extractBooksFromCsv,
  handleGeminiError,
  generateClusterNames,
  getPickOfTheDay,
} from './gemini';

// We must mock the GoogleGenAI module
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

describe('gemini service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGeminiError', () => {
    it('throws quota error for 429 status', () => {
      expect(() => handleGeminiError({status: 429})).toThrow(
        'The AI service has exceeded its quota limit. Please try again later.',
      );
    });
  });

  describe('extractBooksFromImage', () => {
    it('returns array of books when valid JSON is generated', async () => {
      const mockResult = [
        {title: 'The Hobbit', author: 'J.R.R. Tolkien', genre: 'Fantasy'},
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const result = await extractBooksFromImage(
        'data:image/jpeg;base64,1234',
        'image/jpeg',
      );

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('The Hobbit');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when text is invalid JSON', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'hello world invalid json',
      });
      const result = await extractBooksFromImage(
        'data:image/jpeg;base64,1234',
        'image/jpeg',
      );
      expect(result).toHaveLength(0);
    });

    it('returns empty array if parsed result is not array', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '{"title": "1984"}',
      });
      const result = await extractBooksFromImage(
        'data:image/jpeg;base64,1234',
        'image/jpeg',
      );
      expect(result).toEqual([]);
    });

    it('handles gemini error format parsing', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
      await expect(
        extractBooksFromImage('base64', 'image/jpeg'),
      ).rejects.toThrow();
    });
  });

  describe('extractBooksFromCsv', () => {
    it('returns array of books from csv string', async () => {
      const mockResult = {
        hasHeaderRow: true,
        columnMap: {
          title: 0,
          author: 1,
          isbn: null,
          genre: null,
          format: null,
        },
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const result = await extractBooksFromCsv(
        'title,author\nDune,Frank Herbert',
      );
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Dune');
    });

    it('rejects on error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
      await expect(
        extractBooksFromCsv('title,author\nDune,Frank Herbert'),
      ).rejects.toThrow(
        'Failed to communicate with the AI service. Please try again.',
      );
    });

    it('returns empty array if parsed result is not well formatted JSON array extraction', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '{"title": "1984"}',
      });
      const result = await extractBooksFromCsv('title\nDune');
      expect(result).toEqual([]);
    });
  });

  describe('generateBookInsights', () => {
    it('returns insight content for summary', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is a summary.',
      });
      const result = await generateBookInsights('Title', 'Author', 'summary');
      expect(result).toBe('This is a summary.');
    });

    it('rejects on error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API error'));
      await expect(
        generateBookInsights('Title', 'Author', 'summary'),
      ).rejects.toThrow(
        'Failed to communicate with the AI service. Please try again.',
      );
    });
  });

  describe('enrichBooksMetadata', () => {
    it('returns enriched metadata Array', async () => {
      const mockResult = [{id: '1', series: 'Standalone'}];
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });
      const input = [{id: '1', title: '1984', author: 'George Orwell'}];
      const result = await enrichBooksMetadata(input);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].series).toBe('Standalone');
    });

    it('rejects on error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API error'));
      const input = [{id: '1', title: '1984', author: 'George Orwell'}];
      await expect(enrichBooksMetadata(input)).rejects.toThrow(
        'Failed to communicate with the AI service. Please try again.',
      );
    });
  });

  describe('generateLibraryRecommendations', () => {
    it('returns text response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '## Book 1\nGreat read.',
      });

      const result = await generateLibraryRecommendations([
        {title: 'Book 1', author: 'Author'},
      ]);
      expect(result).toContain('Book 1');
    });

    it('handles gemini errors', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
      await expect(
        generateLibraryRecommendations([{title: 'Book 1', author: 'Author'}]),
      ).rejects.toThrow();
    });
  });

  describe('generateBookInsights', () => {
    it('returns insights for all types', async () => {
      mockGenerateContent.mockResolvedValue({text: 'Insight text'});
      const types = ['summary', 'author_bio', 'catchup', 'similar'] as const;
      for (const type of types) {
        const result = await generateBookInsights(
          '1984',
          'George Orwell',
          type,
        );
        expect(result).toBe('Insight text');
      }
    });

    it('handles gemini errors', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
      await expect(
        generateBookInsights('1984', 'George Orwell', 'summary'),
      ).rejects.toThrow();
    });
  });

  describe('generateClusterNames', () => {
    it('returns clustered names with cleaned up integer keys', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n{"Cluster 0": "Sci-Fi", "1": "Fantasy"}\n```',
      });
      const result = await generateClusterNames([
        {id: 0, books: []},
        {id: 1, books: []},
      ]);
      expect(result).toEqual({0: 'Sci-Fi', 1: 'Fantasy'});
    });

    it('returns empty object on error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('fail'));
      const result = await generateClusterNames([{id: 0, books: []}]);
      expect(result).toEqual({});
    });
  });

  describe('getPickOfTheDay', () => {
    it('returns pick object', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '{"title": "1984", "author": "George Orwell", "reason": "Because..."}',
      });
      const result = await getPickOfTheDay([
        {title: 'Dune', author: 'Herbert'},
      ]);
      expect(result?.title).toBe('1984');
    });

    it('returns null on invalid response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'invalid json',
      });
      const result = await getPickOfTheDay([
        {title: 'Dune', author: 'Herbert'},
      ]);
      expect(result).toBeNull();
    });

    it('returns null on early return', async () => {
      const result = await getPickOfTheDay([]);
      expect(result).toBeNull();
    });
  });

  describe('generateLibraryHeroImage', () => {
    it('returns null on failure', async () => {
      const {generateLibraryHeroImage} = await import('./gemini');
      mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
      const result = await generateLibraryHeroImage('Test Lib');
      expect(result).toBeNull();
    });

    it('returns null if no inlineData', async () => {
      const {generateLibraryHeroImage} = await import('./gemini');
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{content: {parts: [{text: 'no image'}]}}],
      });
      const result = await generateLibraryHeroImage('Test Lib');
      expect(result).toBeNull();
    });
  });
});
