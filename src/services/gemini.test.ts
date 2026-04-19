import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractBooksFromImage, generateLibraryRecommendations } from './gemini';

// We must mock the GoogleGenAI module
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      };
    }
  };
});

describe('gemini service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  describe('extractBooksFromImage', () => {
    it('returns array of books when valid JSON is generated', async () => {
      const mockResult = [
        { title: 'The Hobbit', author: 'J.R.R. Tolkien', genre: 'Fantasy' }
      ];
      
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult)
      });

      const result = await extractBooksFromImage('data:image/jpeg;base64,1234', 'image/jpeg');
      
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('The Hobbit');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when text is invalid JSON', async () => {
       mockGenerateContent.mockResolvedValueOnce({
        text: 'hello world invalid json'
      });
      const result = await extractBooksFromImage('data:image/jpeg;base64,1234', 'image/jpeg');
      expect(result).toHaveLength(0);
    });
  });

  describe('generateLibraryRecommendations', () => {
    it('returns text response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '## Book 1\nGreat read.'
      });
      
      const result = await generateLibraryRecommendations([{ title: 'Book 1', author: 'Author' }]);
      expect(result).toContain('Book 1');
    });
  });
});
