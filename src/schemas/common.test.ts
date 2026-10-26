import {describe, it, expect, vi} from 'vitest';
import {FieldValue} from 'firebase-admin/firestore';
import {
  safeIdSchema,
  safeUrlSchema,
  safeEmailSchema,
  validateAndNormalizeEmail,
  hasUnsafeObjectKeys,
  validateIncomingApiData,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
  SchemaValidationError,
  isFirestoreFieldValueSentinel,
  stripFirestoreSentinels,
} from './common';
import {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
  storedBookDocSchema,
  storedUserReadingStateDocSchema,
} from './book';
import {joinWaitlistInputSchema} from './waitlist';
import {libraryUploadImageSchema} from './libraryApi';

describe('Security Schemas & Input Hardening (SEC-01, SEC-03, SEC-06, SEC-11)', () => {
  describe('safeIdSchema (SEC-03 Path Traversal Prevention)', () => {
    it('accepts valid alphanumeric, hyphen, and underscore identifiers', () => {
      expect(safeIdSchema.safeParse('lib_123-abc').success).toBe(true);
      expect(safeIdSchema.safeParse('book-999').success).toBe(true);
    });

    it('rejects path traversal sequences, slashes, dots, null bytes, and oversized IDs', () => {
      expect(safeIdSchema.safeParse('../admin').success).toBe(false);
      expect(safeIdSchema.safeParse('lib_1/../../secret').success).toBe(false);
      expect(safeIdSchema.safeParse('book.1').success).toBe(false);
      expect(safeIdSchema.safeParse('book\x00id').success).toBe(false);
      expect(safeIdSchema.safeParse('a'.repeat(129)).success).toBe(false);
      expect(safeIdSchema.safeParse('').success).toBe(false);
    });

    it('enforces safeIdSchema on bookDeleteSchema', () => {
      expect(
        bookDeleteSchema.safeParse({
          libraryId: 'lib_1/../../appSettings',
          bookId: 'book_1',
        }).success,
      ).toBe(false);
    });
  });

  describe('safeUrlSchema (SEC-02 & SEC-11 XSS Protocol Prevention)', () => {
    it('accepts empty string, https://, http://, and raster data:image/ URLs', () => {
      expect(safeUrlSchema.safeParse('').success).toBe(true);
      expect(
        safeUrlSchema.safeParse('https://covers.openlibrary.org/b/id/123.jpg')
          .success,
      ).toBe(true);
      expect(
        safeUrlSchema.safeParse('data:image/png;base64,iVBORw0KGgo=').success,
      ).toBe(true);
    });

    it('rejects javascript:, vbscript:, file:, data:text/html, and data:image/svg+xml URLs', () => {
      expect(safeUrlSchema.safeParse('javascript:alert(1)').success).toBe(
        false,
      );
      expect(
        safeUrlSchema.safeParse('JAVASCRIPT:fetch("https://evil.com")').success,
      ).toBe(false);
      expect(safeUrlSchema.safeParse('vbscript:msgbox(1)').success).toBe(false);
      expect(safeUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
      expect(
        safeUrlSchema.safeParse('data:text/html;base64,PHNjcmlwdD4=').success,
      ).toBe(false);
      expect(
        safeUrlSchema.safeParse(
          'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj4=',
        ).success,
      ).toBe(false);
    });

    it('blocks unsafe photoURL in joinWaitlistInputSchema', () => {
      expect(
        joinWaitlistInputSchema.safeParse({
          displayName: 'Attacker',
          photoURL: 'javascript:alert(document.cookie)',
        }).success,
      ).toBe(false);
    });
  });

  describe('safeEmailSchema & validateAndNormalizeEmail (SEC-03)', () => {
    it('normalizes valid emails and rejects RFC-quoted slash/traversal emails', () => {
      expect(validateAndNormalizeEmail('  Reader@Example.COM ')).toBe(
        'reader@example.com',
      );
      expect(
        safeEmailSchema.safeParse('"../../admin"@example.com').success,
      ).toBe(false);
      expect(safeEmailSchema.safeParse('a/b@example.com').success).toBe(false);
      expect(() =>
        validateAndNormalizeEmail('"a/b"@example.com'),
      ).toThrowError();
    });
  });

  describe('Mass Assignment & Dot-Notation Injection Prevention (SEC-01)', () => {
    it('rejects unknown fields and immutable attribution spoofing in bookCreateSchema', () => {
      const spoofedCreate = bookCreateSchema.safeParse({
        libraryId: 'lib_1',
        title: 'Dune',
        addedBy: 'spoofed-owner-uid',
        addedAt: '1999-01-01T00:00:00.000Z',
      });
      expect(spoofedCreate.success).toBe(false);

      const unknownFieldCreate = bookCreateSchema.safeParse({
        libraryId: 'lib_1',
        title: 'Dune',
        isAdmin: true,
      });
      expect(unknownFieldCreate.success).toBe(false);
    });

    it('rejects Firestore dot-notation keys and unknown keys in bookUpdateSchema', () => {
      const dotNotationAttack = bookUpdateSchema.safeParse({
        libraryId: 'lib_1',
        bookId: 'book_1',
        updates: {
          'enrichmentStatus.genre': 'completed',
        },
      });
      expect(dotNotationAttack.success).toBe(false);

      const addedBySpoofAttack = bookUpdateSchema.safeParse({
        libraryId: 'lib_1',
        bookId: 'book_1',
        updates: {
          addedBy: 'victim_uid',
        },
      });
      expect(addedBySpoofAttack.success).toBe(false);
    });

    it('detects unsafe object keys via hasUnsafeObjectKeys', () => {
      expect(hasUnsafeObjectKeys({'nested.field': 'value'})).toBe(true);
      expect(hasUnsafeObjectKeys({'a/b': 1})).toBe(true);
      expect(hasUnsafeObjectKeys({title: 'Safe Title'})).toBe(false);
    });
  });

  describe('Batch Size Caps & Payload Limits (SEC-06)', () => {
    it('rejects bookBatchUpsertSchema with more than 5000 operations', () => {
      const operations = Array.from({length: 5001}, (_, i) => ({
        type: 'delete' as const,
        bookId: `book_${i}`,
      }));

      const res = bookBatchUpsertSchema.safeParse({
        libraryId: 'lib_1',
        operations,
      });
      expect(res.success).toBe(false);
    });

    it('rejects bookMergeDuplicatesSchema with more than 100 duplicateBookIds', () => {
      const duplicateBookIds = Array.from(
        {length: 101},
        (_, i) => `dup_book_${i}`,
      );
      const res = bookMergeDuplicatesSchema.safeParse({
        libraryId: 'lib_1',
        survivorBookId: 'survivor_1',
        duplicateBookIds,
        mergedFields: {title: 'Merged'},
      });
      expect(res.success).toBe(false);
    });

    it('rejects traversal paths in libraryUploadImageSchema', () => {
      expect(
        libraryUploadImageSchema.safeParse({
          libraryId: 'lib_1',
          path: 'libraries/lib_1/../other_lib/cover.png',
          base64Data: 'data:image/png;base64,iVBORw0KGgo=',
        }).success,
      ).toBe(false);
    });
  });

  describe('Pre-Persistence Schema Validation & Development Error Logging', () => {
    it('validates valid incoming API data and returns typed result', () => {
      const data = validateIncomingApiData(
        bookCreateSchema,
        {
          libraryId: 'lib_1',
          title: 'The Left Hand of Darkness',
          author: 'Ursula K. Le Guin',
        },
        {
          entity: 'BookCreateInput',
          documentPath: '/libraries/lib_1/books',
          operation: 'create',
        },
      );
      expect(data.title).toBe('The Left Hand of Darkness');
      expect(data.libraryId).toBe('lib_1');
    });

    it('logs structured development debug errors and throws SchemaValidationError on invalid API data', () => {
      const logger = vi.fn();
      expect(() =>
        validateIncomingApiData(
          bookCreateSchema,
          {
            libraryId: '../traversal',
            title: '',
            coverUrl: 'javascript:alert(1)',
          },
          {
            entity: 'BookCreateInput',
            documentPath: '/libraries/../traversal/books',
            operation: 'create',
            logger,
          },
        ),
      ).toThrowError(SchemaValidationError);

      expect(logger).toHaveBeenCalledTimes(1);
      const [loggedMsg, loggedDetails] = logger.mock.calls[0] as [
        string,
        {entity: string; issues: Array<{path: string; message: string}>},
      ];
      expect(loggedMsg).toContain(
        '[SchemaValidation] BookCreateInput (create) at /libraries/../traversal/books failed validation',
      );
      expect(loggedDetails.entity).toBe('BookCreateInput');
      expect(loggedDetails.issues.map(i => i.path)).toEqual(
        expect.arrayContaining(['libraryId', 'title', 'coverUrl']),
      );
    });

    it('strips Firestore FieldValue sentinels during pre-persistence validation while preserving them on the payload', () => {
      const sentinel = FieldValue.serverTimestamp();
      expect(isFirestoreFieldValueSentinel(sentinel)).toBe(true);

      const writePayload = {
        id: 'isbn:9780140449136',
        userId: 'user_123',
        keyType: 'isbn' as const,
        cleanIsbn: '9780140449136',
        bookId: 'book_1',
        status: 'reading' as const,
        updatedAt: sentinel,
      };

      const stripped = stripFirestoreSentinels(writePayload) as Record<
        string,
        unknown
      >;
      expect(stripped.updatedAt).toBeUndefined();

      const logger = vi.fn();
      const result = validateFirestoreWritePayload(
        storedUserReadingStateDocSchema,
        writePayload,
        {
          entity: 'StoredUserReadingStateDoc',
          documentPath: '/users/user_123/readingStates/isbn:9780140449136',
          operation: 'upsert',
          logger,
        },
      );

      expect(result.success).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.data.updatedAt).toBe(sentinel);
      expect(logger).not.toHaveBeenCalled();
    });

    it('throws SchemaValidationError by default (strict: true) and returns issues when strict: false on invalid Firestore write payloads', () => {
      const logger = vi.fn();
      const badWritePayload = {
        id: 'book_1',
        title: 'Dune',
        author: 'Frank Herbert',
        coverUrl: 'javascript:alert(1)',
        updatedAt: FieldValue.serverTimestamp(),
      };

      expect(() =>
        validateFirestoreWritePayload(storedBookDocSchema, badWritePayload, {
          entity: 'StoredBookDoc',
          documentPath: 'books/book_1',
          operation: 'create',
          logger,
        }),
      ).toThrowError(SchemaValidationError);

      const result = validateFirestoreWritePayload(
        storedBookDocSchema,
        badWritePayload,
        {
          entity: 'StoredBookDoc',
          documentPath: 'books/book_1',
          operation: 'create',
          strict: false,
          logger,
        },
      );

      expect(result.success).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]?.path).toBe('coverUrl');
      expect(logger).toHaveBeenCalledTimes(2);
    });

    it('strictly validates Firestore read payloads via validateFirestoreReadPayload and throws on schema mismatch', () => {
      const validRead = validateFirestoreReadPayload(
        storedBookDocSchema,
        {
          id: 'book_1',
          title: 'Dune',
          author: 'Frank Herbert',
        },
        {
          entity: 'StoredBookDoc',
          documentPath: 'libraries/lib_1/books/book_1',
        },
      );
      expect(validRead.title).toBe('Dune');

      const logger = vi.fn();
      expect(() =>
        validateFirestoreReadPayload(
          storedBookDocSchema,
          {
            id: 'book_1',
            title: 'Dune',
            author: 'Frank Herbert',
            unknownLegacyField: 'not_allowed',
          },
          {
            entity: 'StoredBookDoc',
            documentPath: 'libraries/lib_1/books/book_1',
            logger,
          },
        ),
      ).toThrowError(SchemaValidationError);
      expect(logger).toHaveBeenCalledTimes(1);
    });
  });
});
