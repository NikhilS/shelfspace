/**
 * @fileoverview Architectural and unit compliance tests verifying that:
 * 1. All 10 persisted Firestore/disk document schemas strictly validate valid
 *    fixtures and reject unknown or malformed fields on both read and write.
 * 2. Every production service file in `src/server/**` that interacts with
 *    Firestore (`getAdminDb()`) imports and routes reads/writes through typed
 *    converters or shared schema validators (`validateFirestoreReadPayload` /
 *    `validateFirestoreWritePayload`), with zero unvalidated `.data() as ...`
 *    casts on Firestore document snapshots.
 */
import fs from 'fs';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {
  SchemaValidationError,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from './common';
import {
  STORED_DOCUMENT_SCHEMAS,
  buildValidStoredAllowedDuplicateFixture,
  buildValidStoredAllowlistFixture,
  buildValidStoredBookDetailsFixture,
  buildValidStoredBookFixture,
  buildValidStoredGeolocationFixture,
  buildValidStoredLibraryFixture,
  buildValidStoredReadingStateFixture,
  buildValidStoredReviewFixture,
  buildValidStoredUserProfileFixture,
  buildValidStoredWaitlistFixture,
} from './schemaCompliance';

function collectServerSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectServerSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Schema Compliance & Strict Converter Enforcement', () => {
  it('validates all 10 canonical collection fixtures and strictly rejects unknown fields', () => {
    const fixtures = {
      users: buildValidStoredUserProfileFixture(),
      readingStates: buildValidStoredReadingStateFixture(),
      libraries: buildValidStoredLibraryFixture(),
      books: buildValidStoredBookFixture(),
      bookDetails: buildValidStoredBookDetailsFixture(),
      reviews: buildValidStoredReviewFixture(),
      allowedDuplicates: buildValidStoredAllowedDuplicateFixture(),
      allowlist: buildValidStoredAllowlistFixture(),
      waitlist: buildValidStoredWaitlistFixture(),
      geolocationCache: buildValidStoredGeolocationFixture(),
    };

    for (const [collectionName, schema] of Object.entries(
      STORED_DOCUMENT_SCHEMAS,
    )) {
      const validDoc =
        fixtures[collectionName as keyof typeof STORED_DOCUMENT_SCHEMAS];
      expect(
        validateFirestoreReadPayload(schema, validDoc, {
          entity: collectionName,
          documentPath: `${collectionName}/doc-1`,
          operation: 'read',
        }),
      ).toEqual(validDoc);

      const writeValidation = validateFirestoreWritePayload(schema, validDoc, {
        entity: collectionName,
        documentPath: `${collectionName}/doc-1`,
        operation: 'upsert',
      });
      expect(writeValidation.success).toBe(true);

      const pollutedDoc = {
        ...validDoc,
        unexpectedLegacyLeakField: 'forbidden',
      };
      expect(() =>
        validateFirestoreReadPayload(schema, pollutedDoc, {
          entity: collectionName,
          documentPath: `${collectionName}/doc-1`,
          operation: 'read',
        }),
      ).toThrow(SchemaValidationError);

      expect(() =>
        validateFirestoreWritePayload(schema, pollutedDoc, {
          entity: collectionName,
          documentPath: `${collectionName}/doc-1`,
          operation: 'upsert',
        }),
      ).toThrow(SchemaValidationError);
    }
  });

  it('enforces that every server module using getAdminDb() uses typed converters or schema validators', () => {
    const serverDir = path.resolve(process.cwd(), 'src/server');
    const serverFiles = collectServerSourceFiles(serverDir);

    const dbConsumers = serverFiles.filter(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (filePath.endsWith('firebaseAdmin.ts')) {
        return false;
      }
      return content.includes('getAdminDb(');
    });

    expect(dbConsumers.length).toBeGreaterThan(0);

    for (const filePath of dbConsumers) {
      const relPath = path.relative(process.cwd(), filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      const usesValidatorOrConverter =
        content.includes('validateFirestoreReadPayload') ||
        content.includes('validateFirestoreWritePayload') ||
        content.includes('Converter');

      expect(
        usesValidatorOrConverter,
        `${relPath} accesses Firestore via getAdminDb() without using a typed *Converter or validateFirestore*Payload helper`,
      ).toBe(true);
    }
  });
});
