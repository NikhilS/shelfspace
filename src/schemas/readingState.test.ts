import {describe, it, expect} from 'vitest';
import {
  bookStatusEnum,
  bookTemporalMetadataSchema,
  geoLocationReferenceSchema,
  readingStateKeySchema,
  minimalBookStubSchema,
  userReadingStateBookSnapshotSchema,
  storedUserReadingStateDocSchema,
  userReadingStateSchema,
  computeReadingStateKey,
  resolveReadingStateKeyType,
} from './readingState';

describe('Reading State Ledger Schemas (src/schemas/readingState.ts)', () => {
  describe('computeReadingStateKey & readingStateKeySchema', () => {
    it('formats library-backed books stably as book:<libraryId>:<bookId> regardless of ISBN changes', () => {
      const keyWithoutIsbn = computeReadingStateKey({
        libraryId: 'lib_household',
        bookId: 'book_123',
      });
      const keyAfterIsbnAdded = computeReadingStateKey({
        libraryId: 'lib_household',
        isbn: '978-0-441-47812-5',
        bookId: 'book_123',
      });

      expect(keyWithoutIsbn).toBe('book:lib_household:book_123');
      expect(keyAfterIsbnAdded).toBe('book:lib_household:book_123');
      expect(readingStateKeySchema.safeParse(keyAfterIsbnAdded).success).toBe(
        true,
      );
      expect(resolveReadingStateKeyType(keyAfterIsbnAdded)).toBe('book');
    });

    it('formats standalone external books with ISBNs as ext:<NORMALIZED_ISBN>', () => {
      const key = computeReadingStateKey({
        isbn: '978-0-441-47812-5',
        bookId: 'book_123',
      });
      expect(key).toBe('ext:9780441478125');
      expect(readingStateKeySchema.safeParse(key).success).toBe(true);
      expect(resolveReadingStateKeyType(key)).toBe('ext');

      const isbn10X = computeReadingStateKey({
        isbn: '0-8044-2957-x',
        bookId: 'book_456',
      });
      expect(isbn10X).toBe('ext:080442957X');
      expect(readingStateKeySchema.safeParse(isbn10X).success).toBe(true);
    });

    it('falls back to ext:<BOOK_ID> when both libraryId and ISBN are absent', () => {
      const key = computeReadingStateKey({
        isbn: '   ',
        bookId: 'book_internal_99',
      });
      expect(key).toBe('ext:book_internal_99');
      expect(readingStateKeySchema.safeParse(key).success).toBe(true);
      expect(resolveReadingStateKeyType(key)).toBe('ext');
    });

    it('strictly rejects legacy isbn: and bookid: prefixes as well as path traversal keys', () => {
      expect(
        readingStateKeySchema.safeParse('isbn:9780553573398').success,
      ).toBe(false);
      expect(readingStateKeySchema.safeParse('bookid:book_abc').success).toBe(
        false,
      );
      expect(readingStateKeySchema.safeParse('isbn:978-0-441').success).toBe(
        false,
      );
      expect(readingStateKeySchema.safeParse('ext:../other_user').success).toBe(
        false,
      );
      expect(readingStateKeySchema.safeParse('book:lib_1:../bad').success).toBe(
        false,
      );
      expect(readingStateKeySchema.safeParse('title::author').success).toBe(
        false,
      );
    });

    it('is idempotent when bookId already starts with book: or ext:', () => {
      expect(
        computeReadingStateKey({
          bookId: 'book:lib_1:book_abc',
        }),
      ).toBe('book:lib_1:book_abc');

      expect(
        computeReadingStateKey({
          bookId: 'ext:9780553573398',
        }),
      ).toBe('ext:9780553573398');
    });
  });

  describe('strict clean-break enum and metadata schemas', () => {
    it('rejects legacy completed reading status, capitalized geo adminLevel, top-level lat/lng, and eraLabel', () => {
      expect(bookStatusEnum.safeParse('finished').success).toBe(true);
      expect(bookStatusEnum.safeParse('completed').success).toBe(false);

      expect(
        geoLocationReferenceSchema.safeParse({
          name: 'Cairo',
          adminLevel: 'city',
          coordinates: {lat: 30.04, lng: 31.23},
        }).success,
      ).toBe(true);
      expect(
        geoLocationReferenceSchema.safeParse({
          name: 'Cairo',
          adminLevel: 'City',
          coordinates: {lat: 30.04, lng: 31.23},
        }).success,
      ).toBe(false);
      expect(
        geoLocationReferenceSchema.safeParse({
          name: 'Cairo',
          lat: 30.04,
          lng: 31.23,
        }).success,
      ).toBe(false);

      expect(
        bookTemporalMetadataSchema.safeParse({
          startYear: 1920,
          eraName: 'Interwar Period',
        }).success,
      ).toBe(true);
      expect(
        bookTemporalMetadataSchema.safeParse({
          startYear: 1920,
          eraLabel: 'Interwar Period',
        }).success,
      ).toBe(false);
    });
  });

  describe('storedUserReadingStateDocSchema & minimalBookStubSchema', () => {
    it('validates a slim reading state document and rejects 50KB prose/vector bloat in bookSnapshot', () => {
      const doc = {
        id: 'book:lib_1:book_1',
        userId: 'user_1',
        keyType: 'book' as const,
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
          format: 'physical' as const,
        },
        updatedAt: '2026-10-25T00:00:00.000Z',
      };

      expect(storedUserReadingStateDocSchema.safeParse(doc).success).toBe(true);
      expect(userReadingStateSchema.safeParse(doc).success).toBe(true);
      expect(minimalBookStubSchema.safeParse(doc.bookSnapshot).success).toBe(
        true,
      );
      expect(
        userReadingStateBookSnapshotSchema.safeParse({
          ...doc.bookSnapshot,
          synopsis: 'Bloated 50KB synopsis no longer allowed in readingStates',
        }).success,
      ).toBe(false);
    });

    it('rejects out-of-range star ratings', () => {
      expect(
        storedUserReadingStateDocSchema.safeParse({
          id: 'book:lib_1:book_1',
          userId: 'user_1',
          keyType: 'book',
          rating: 6,
        }).success,
      ).toBe(false);
    });
  });
});
