import {describe, it, expect} from 'vitest';
import {
  readingStateKeySchema,
  userReadingStateBookSnapshotSchema,
  storedUserReadingStateDocSchema,
  userReadingStateSchema,
  computeReadingStateKey,
} from './readingState';

describe('Reading State Ledger Schemas (src/schemas/readingState.ts)', () => {
  describe('computeReadingStateKey & readingStateKeySchema', () => {
    it('formats normalized ISBN keys as isbn:<NORMALIZED_ISBN> and validates them', () => {
      const key = computeReadingStateKey({
        isbn: '978-0-441-47812-5',
        bookId: 'book_123',
      });
      expect(key).toBe('isbn:9780441478125');
      expect(readingStateKeySchema.safeParse(key).success).toBe(true);

      const isbn10X = computeReadingStateKey({
        isbn: '0-8044-2957-x',
        bookId: 'book_456',
      });
      expect(isbn10X).toBe('isbn:080442957X');
      expect(readingStateKeySchema.safeParse(isbn10X).success).toBe(true);
    });

    it('falls back to bookid:<BOOK_ID> when ISBN is absent or empty', () => {
      const key = computeReadingStateKey({
        isbn: '   ',
        bookId: 'book_internal_99',
      });
      expect(key).toBe('bookid:book_internal_99');
      expect(readingStateKeySchema.safeParse(key).success).toBe(true);
    });

    it('rejects malformed or path-traversal readingState keys', () => {
      expect(readingStateKeySchema.safeParse('isbn:978-0-441').success).toBe(
        false,
      );
      expect(
        readingStateKeySchema.safeParse('bookid:../other_user').success,
      ).toBe(false);
      expect(readingStateKeySchema.safeParse('title::author').success).toBe(
        false,
      );
    });

    it('is idempotent when bookId already starts with isbn: or bookid:', () => {
      expect(
        computeReadingStateKey({
          bookId: 'isbn:9780553573398',
        }),
      ).toBe('isbn:9780553573398');

      expect(
        computeReadingStateKey({
          bookId: 'bookid:book_abc_123',
        }),
      ).toBe('bookid:book_abc_123');
    });
  });

  describe('storedUserReadingStateDocSchema & userReadingStateSchema', () => {
    it('validates a complete stored reading state document with typed geoMetadata and temporalMetadata', () => {
      const doc = {
        id: 'isbn:9780441478125',
        userId: 'user_1',
        keyType: 'isbn' as const,
        cleanIsbn: '9780441478125',
        bookId: 'book_1',
        libraryId: 'lib_1',
        status: 'reading' as const,
        rating: 5,
        reviewText: 'Masterpiece of speculative anthropology.',
        reviewedAt: '2026-10-25T00:00:00.000Z',
        startedAt: '2026-10-20T00:00:00.000Z',
        readStatusReviewedAt: '2026-10-25T00:00:00.000Z',
        bookSnapshot: {
          title: 'The Left Hand of Darkness',
          author: 'Ursula K. Le Guin',
          isbn: '978-0-441-47812-5',
          cleanIsbn: '9780441478125',
          primaryGenre: 'Science Fiction',
          subgenres: ['Anthropological Sci-Fi'],
          format: 'physical' as const,
          geoMetadata: {
            isNonEarth: true,
            locations: [],
            lastSyncedAt: '2026-10-25T00:00:00.000Z',
          },
          temporalMetadata: {
            isNonHistorical: true,
            lastProcessedAt: '2026-10-25T00:00:00.000Z',
          },
        },
        updatedAt: '2026-10-25T00:00:00.000Z',
      };

      expect(storedUserReadingStateDocSchema.safeParse(doc).success).toBe(true);
      expect(userReadingStateSchema.safeParse(doc).success).toBe(true);
      expect(
        userReadingStateBookSnapshotSchema.safeParse(doc.bookSnapshot).success,
      ).toBe(true);
    });

    it('rejects out-of-range star ratings', () => {
      expect(
        storedUserReadingStateDocSchema.safeParse({
          id: 'bookid:book_1',
          userId: 'user_1',
          keyType: 'bookid',
          rating: 6,
        }).success,
      ).toBe(false);
    });
  });
});
