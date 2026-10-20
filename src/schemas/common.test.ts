import {describe, it, expect} from 'vitest';
import {
  safeIdSchema,
  safeUrlSchema,
  safeEmailSchema,
  validateAndNormalizeEmail,
  hasUnsafeObjectKeys,
} from './common';
import {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
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
          'userStatuses.victim_uid': 'abandoned',
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
      expect(hasUnsafeObjectKeys({'userStatuses.other': 'reading'})).toBe(true);
      expect(hasUnsafeObjectKeys({'a/b': 1})).toBe(true);
      expect(hasUnsafeObjectKeys({title: 'Safe Title'})).toBe(false);
    });
  });

  describe('Batch Size Caps & Payload Limits (SEC-06)', () => {
    it('rejects bookBatchUpsertSchema with more than 500 operations', () => {
      const operations = Array.from({length: 501}, (_, i) => ({
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
});
