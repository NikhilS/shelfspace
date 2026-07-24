import {describe, it, expect} from 'vitest';
import {
  libraryListSchema,
  bookListSchema,
  enrichmentTriggerSchema,
} from './libraryApi';

describe('Library API Zod Validation Schemas', () => {
  describe('libraryListSchema', () => {
    it('accepts empty object or undefined', () => {
      expect(libraryListSchema.parse({})).toEqual({});
      expect(libraryListSchema.parse(undefined)).toEqual({});
    });
  });

  describe('bookListSchema', () => {
    it('validates libraryId, missingMetadata filters, limit and cursor', () => {
      const valid = bookListSchema.parse({
        libraryId: 'lib_123',
        filters: {
          missingMetadata: 'coverImage',
        },
        limit: 100,
        cursor: 'book_cursor_456',
      });

      expect(valid.libraryId).toBe('lib_123');
      expect(valid.filters?.missingMetadata).toBe('coverImage');
      expect(valid.limit).toBe(100);
    });

    it('defaults limit to 50 when omitted', () => {
      const parsed = bookListSchema.parse({
        libraryId: 'lib_123',
      });
      expect(parsed.limit).toBe(50);
    });

    it('rejects empty libraryId string', () => {
      expect(() =>
        bookListSchema.parse({
          libraryId: '',
        }),
      ).toThrow();
    });

    it('rejects limit exceeding max of 250', () => {
      expect(() =>
        bookListSchema.parse({
          libraryId: 'lib_123',
          limit: 300,
        }),
      ).toThrow();
    });

    it('rejects invalid missingMetadata values', () => {
      expect(() =>
        bookListSchema.parse({
          libraryId: 'lib_123',
          filters: {
            missingMetadata: 'invalid_type' as unknown as 'geo',
          },
        }),
      ).toThrow();
    });
  });

  describe('enrichmentTriggerSchema', () => {
    it('validates enrichment flow and bookIds array', () => {
      const valid = enrichmentTriggerSchema.parse({
        libraryId: 'lib_123',
        flow: 'geo',
        bookIds: ['book1', 'book2'],
      });

      expect(valid.flow).toBe('geo');
      expect(valid.bookIds.length).toBe(2);
    });

    it('rejects empty bookIds array', () => {
      expect(() =>
        enrichmentTriggerSchema.parse({
          libraryId: 'lib_123',
          flow: 'genre',
          bookIds: [],
        }),
      ).toThrow();
    });

    it('rejects bookIds array exceeding 100 items', () => {
      const hugeList = Array.from({length: 101}, (_, i) => `b_${i}`);
      expect(() =>
        enrichmentTriggerSchema.parse({
          libraryId: 'lib_123',
          flow: 'synopsis',
          bookIds: hugeList,
        }),
      ).toThrow();
    });
  });
});
