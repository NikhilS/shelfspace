/**
 * @fileoverview Architectural schema compliance test suite (`src/lib/schema.test.ts`).
 * Iterates through all persisted Firestore collections and subcollections to verify:
 * 1. Every collection has a registered `.strict()` Zod schema in `STORED_DOCUMENT_SCHEMAS`.
 * 2. Every collection's typed Firestore converter (`fromFirestore` / `toFirestore*`)
 *    produces and parses documents that strictly conform to its Zod schema.
 * 3. Simulated Firestore collection/subcollection snapshot traversals validate 100%
 *    of documents and immediately reject schema drift (unknown fields, type mismatches,
 *    or legacy embedded fields).
 * 4. Every `.collection('<name>')` call in `src/server/**` maps to a known,
 *    schema-governed collection, preventing unvalidated collections from being introduced.
 */
import fs from 'fs';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {
  SchemaValidationError,
  stripFirestoreSentinels,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../schemas/common';
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
  type StoredCollectionName,
} from '../schemas/schemaCompliance';
import {allowlistDocConverter} from '../server/auth/allowlistService';
import {waitlistDocConverter} from '../server/auth/waitlistService';
import {
  BookPartitioner,
  bookDetailsDocConverter,
  bookDocConverter,
} from '../server/services/book/bookPartitioner';
import {reviewDocConverter} from '../server/services/book/bookReviewService';
import {readingStateConverter} from '../server/services/book/readingStateLedger';
import {geolocationCacheConverter} from '../server/services/geolocation';
import {libraryDocConverter} from '../server/services/library/libraryCrudService';
import {allowedDuplicateConverter} from '../server/services/library/librarySpruceService';
import {userProfileConverter} from '../server/services/userService';

interface SimulatedFirestoreDocSnapshot {
  id: string;
  documentPath: string;
  data: () => Record<string, unknown>;
}

interface CollectionVerificationSpec {
  collection: StoredCollectionName;
  firestorePathPattern: string;
  snapshots: SimulatedFirestoreDocSnapshot[];
  parseWithConverter: (snapshot: SimulatedFirestoreDocSnapshot) => unknown;
  createWritePayload: () => Record<string, unknown>;
}

function createFakeFirestoreTimestamp(isoString: string): {toDate: () => Date} {
  return {
    toDate: () => new Date(isoString),
  };
}

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

describe('Firestore Collection Schema Architecture (src/lib/schema.test.ts)', () => {
  const fixedIso = '2026-01-15T12:00:00.000Z';
  const fakeTimestamp = createFakeFirestoreTimestamp(fixedIso);

  const collectionSpecs: CollectionVerificationSpec[] = [
    {
      collection: 'users',
      firestorePathPattern: '/users/{userId}',
      snapshots: [
        {
          id: 'user-1',
          documentPath: '/users/user-1',
          data: () => ({
            ...buildValidStoredUserProfileFixture({uid: 'user-1'}),
            createdAt: fakeTimestamp,
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        userProfileConverter.fromFirestore(snap.id, snap.data()),
      createWritePayload: () =>
        userProfileConverter.toCreatePayload({
          uid: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          photoURL: 'https://example.com/ada.jpg',
        }),
    },
    {
      collection: 'readingStates',
      firestorePathPattern: '/users/{userId}/readingStates/{stateKey}',
      snapshots: [
        {
          id: 'isbn:9780140449136',
          documentPath: '/users/user-1/readingStates/isbn:9780140449136',
          data: () => ({
            ...buildValidStoredReadingStateFixture({
              id: 'isbn:9780140449136',
              userId: 'user-1',
            }),
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        readingStateConverter.fromFirestore(snap.id, snap.data(), 'user-1'),
      createWritePayload: () => {
        const {payload} = readingStateConverter.toUpsertDoc({
          userId: 'user-1',
          bookId: 'book-1',
          libraryId: 'lib-1',
          isbn: '9780140449136',
          status: 'reading',
          rating: 5,
          bookData: {
            title: 'The Odyssey',
            author: 'Homer',
            isbn: '9780140449136',
          },
        });
        return payload as unknown as Record<string, unknown>;
      },
    },
    {
      collection: 'libraries',
      firestorePathPattern: '/libraries/{libraryId}',
      snapshots: [
        {
          id: 'lib-1',
          documentPath: '/libraries/lib-1',
          data: () => ({
            ...buildValidStoredLibraryFixture({id: 'lib-1', ownerId: 'user-1'}),
            createdAt: fakeTimestamp,
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        libraryDocConverter.fromFirestore(snap.id, snap.data(), 'user-1'),
      createWritePayload: () => ({
        ...buildValidStoredLibraryFixture({id: 'lib-1', ownerId: 'user-1'}),
      }),
    },
    {
      collection: 'books',
      firestorePathPattern: '/libraries/{libraryId}/books/{bookId}',
      snapshots: [
        {
          id: 'book-1',
          documentPath: '/libraries/lib-1/books/book-1',
          data: () => ({
            ...buildValidStoredBookFixture({id: 'book-1'}),
            addedAt: fakeTimestamp,
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        bookDocConverter.fromFirestore(snap.id, snap.data(), snap.documentPath),
      createWritePayload: () => {
        const {cleanCore} = BookPartitioner.partitionCreatePayload(
          {
            title: 'Notes on the Analytical Engine',
            author: 'Ada Lovelace',
            isbn: '9780140449136',
            primaryGenre: 'Science',
          },
          'book-1',
          'user-1',
          fixedIso,
        );
        return cleanCore;
      },
    },
    {
      collection: 'bookDetails',
      firestorePathPattern: '/libraries/{libraryId}/bookDetails/{bookId}',
      snapshots: [
        {
          id: 'book-1',
          documentPath: '/libraries/lib-1/bookDetails/book-1',
          data: () => ({
            ...buildValidStoredBookDetailsFixture(),
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        bookDetailsDocConverter.fromFirestore(
          snap.id,
          snap.data(),
          snap.documentPath,
        ),
      createWritePayload: () =>
        bookDetailsDocConverter.toFirestoreWrite(
          'book-1',
          {
            ...buildValidStoredBookDetailsFixture(),
          },
          'create',
          '/libraries/lib-1/bookDetails/book-1',
        ),
    },
    {
      collection: 'reviews',
      firestorePathPattern:
        '/libraries/{libraryId}/books/{bookId}/reviews/{userId}',
      snapshots: [
        {
          id: 'user-1',
          documentPath: '/libraries/lib-1/books/book-1/reviews/user-1',
          data: () => ({
            ...buildValidStoredReviewFixture({id: 'user-1', userId: 'user-1'}),
            createdAt: fakeTimestamp,
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        reviewDocConverter.fromFirestore(snap.id, snap.data()),
      createWritePayload: () => ({
        id: 'user-1',
        ...reviewDocConverter.toFirestoreWrite({
          userId: 'user-1',
          userName: 'Ada Lovelace',
          rating: 5,
          text: 'Essential foundational work.',
        }),
      }),
    },
    {
      collection: 'allowedDuplicates',
      firestorePathPattern:
        '/libraries/{libraryId}/allowedDuplicates/{allowedId}',
      snapshots: [
        {
          id: 'dup-1',
          documentPath: '/libraries/lib-1/allowedDuplicates/dup-1',
          data: () => ({
            ...buildValidStoredAllowedDuplicateFixture({id: 'dup-1'}),
            createdAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        allowedDuplicateConverter.fromFirestore('lib-1', snap.id, snap.data()),
      createWritePayload: () => ({
        id: 'dup-1',
        ...allowedDuplicateConverter.toFirestoreWrite('lib-1', 'dup-1', [
          'book-1',
          'book-2',
        ]),
      }),
    },
    {
      collection: 'allowlist',
      firestorePathPattern: '/appSettings/allowlist/users/{email}',
      snapshots: [
        {
          id: 'ada@example.com',
          documentPath: '/appSettings/allowlist/users/ada@example.com',
          data: () => ({
            ...buildValidStoredAllowlistFixture({email: 'ada@example.com'}),
            addedAt: fakeTimestamp,
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        allowlistDocConverter.fromFirestore(snap.id, snap.data()),
      createWritePayload: () =>
        allowlistDocConverter.toFirestoreWrite('ada@example.com', {
          role: 'user',
          hasAiPlan: true,
          isCreate: true,
        }),
    },
    {
      collection: 'waitlist',
      firestorePathPattern: '/appSettings/waitlist/entries/{email}',
      snapshots: [
        {
          id: 'babbage@example.com',
          documentPath: '/appSettings/waitlist/entries/babbage@example.com',
          data: () => ({
            ...buildValidStoredWaitlistFixture({email: 'babbage@example.com'}),
            requestedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        waitlistDocConverter.fromFirestore(snap.id, snap.data()),
      createWritePayload: () =>
        waitlistDocConverter.toFirestoreWrite(
          'babbage@example.com',
          buildValidStoredWaitlistFixture({email: 'babbage@example.com'}),
          'create',
        ),
    },
    {
      collection: 'geolocationCache',
      firestorePathPattern: '/geolocationCache/{locationKey}',
      snapshots: [
        {
          id: 'london_uk',
          documentPath: '/geolocationCache/london_uk',
          data: () => ({
            ...buildValidStoredGeolocationFixture({id: 'london_uk'}),
            updatedAt: fakeTimestamp,
          }),
        },
      ],
      parseWithConverter: snap =>
        geolocationCacheConverter.fromFirestore(snap.id, snap.data()),
      createWritePayload: () =>
        geolocationCacheConverter.toFirestoreWrite('london_uk', {
          name: 'London, UK',
          lat: 51.5074,
          lng: -0.1278,
          updatedAt: fixedIso,
        }),
    },
  ];

  it('covers 100% of registered collections in STORED_DOCUMENT_SCHEMAS', () => {
    const registeredCollections = Object.keys(STORED_DOCUMENT_SCHEMAS).sort();
    const specCollections = collectionSpecs.map(s => s.collection).sort();

    expect(specCollections).toEqual(registeredCollections);
    expect(registeredCollections.length).toBe(10);
  });

  it('iterates through every Firestore collection snapshot and verifies converter output matches its strict Zod schema', () => {
    for (const spec of collectionSpecs) {
      const schema = STORED_DOCUMENT_SCHEMAS[spec.collection];
      expect(schema).toBeDefined();

      for (const snapshot of spec.snapshots) {
        // 1. Parse raw Firestore snapshot (including Timestamp objects) via collection converter
        const hydratedDoc = spec.parseWithConverter(snapshot);

        // 2. Verify converter output strictly conforms to the collection's Zod schema
        const validatedRead = validateFirestoreReadPayload(
          schema,
          hydratedDoc,
          {
            entity: spec.collection,
            documentPath: snapshot.documentPath,
            operation: 'read',
          },
        );
        expect(validatedRead).toEqual(hydratedDoc);

        // 3. Verify write payload produced by the collection converter passes strict write validation
        const writePayload = spec.createWritePayload();
        const writeCheck = validateFirestoreWritePayload(schema, writePayload, {
          entity: spec.collection,
          documentPath: snapshot.documentPath,
          operation: 'upsert',
        });
        expect(writeCheck.success).toBe(true);

        // Ensure sentinel stripping produces a clean object accepted by safeParse
        const strippedWrite = stripFirestoreSentinels(writePayload);
        const directParse = schema.safeParse(strippedWrite);
        expect(
          directParse.success,
          `Collection '${spec.collection}' write payload failed direct schema.safeParse`,
        ).toBe(true);
      }
    }
  });

  it('rejects schema drift (shadow fields, corrupted field types, and legacy leaked fields) across every collection', () => {
    for (const spec of collectionSpecs) {
      const schema = STORED_DOCUMENT_SCHEMAS[spec.collection];
      const baseSnapshot = spec.snapshots[0];

      // A. Drift via unexpected shadow field on Firestore read snapshot
      const driftedSnapshot: SimulatedFirestoreDocSnapshot = {
        ...baseSnapshot,
        data: () => ({
          ...baseSnapshot.data(),
          unregisteredDriftField: 'should-fail-strict-zod-parse',
        }),
      };

      expect(
        () => spec.parseWithConverter(driftedSnapshot),
        `Collection '${spec.collection}' at ${spec.firestorePathPattern} failed to reject unknown shadow field on read`,
      ).toThrow(SchemaValidationError);

      // B. Drift via unexpected shadow field on Firestore write payload
      const driftedWrite = {
        ...spec.createWritePayload(),
        unregisteredDriftField: 'should-fail-strict-zod-write',
      };

      expect(
        () =>
          validateFirestoreWritePayload(schema, driftedWrite, {
            entity: spec.collection,
            documentPath: baseSnapshot.documentPath,
            operation: 'upsert',
          }),
        `Collection '${spec.collection}' at ${spec.firestorePathPattern} failed to reject unknown shadow field on write`,
      ).toThrow(SchemaValidationError);
    }
  });

  it('verifies that every .collection(...) call in src/server/** belongs to a schema-governed collection', () => {
    const serverDir = path.resolve(process.cwd(), 'src/server');
    const serverFiles = collectServerSourceFiles(serverDir);

    // Allowed Firestore collection identifiers:
    // - The 10 canonical collections in STORED_DOCUMENT_SCHEMAS
    // - Structural parent/subcollection paths ('appSettings', 'entries',
    //   'appSettings/allowlist/users', 'appSettings/waitlist/entries') that route
    //   directly to `allowlist` and `waitlist`.
    const allowedCollectionLiterals = new Set<string>([
      ...Object.keys(STORED_DOCUMENT_SCHEMAS),
      'appSettings',
      'entries',
      'appSettings/allowlist/users',
      'appSettings/waitlist/entries',
    ]);

    const collectionCallRegex = /\.collection\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    const discoveredCollections = new Set<string>();

    for (const filePath of serverFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let match = collectionCallRegex.exec(content);
      while (match !== null) {
        const colName = match[1];
        discoveredCollections.add(colName);
        const relPath = path.relative(process.cwd(), filePath);
        expect(
          allowedCollectionLiterals.has(colName),
          `Unregistered Firestore collection '${colName}' found in ${relPath}. Register a strict Zod schema in STORED_DOCUMENT_SCHEMAS before querying this collection.`,
        ).toBe(true);
        match = collectionCallRegex.exec(content);
      }
    }

    expect(discoveredCollections.size).toBeGreaterThan(0);
  });

  it('ignores deprecated legacy fields on libraries and books without propagating them, while allowing nullable temporalMetadata and raster base64 hero banners', () => {
    // 1. Library with 120KB raster base64 heroImageUrl and legacy sharedWith field
    const largeBase64Banner = `data:image/jpeg;base64,${'A'.repeat(120_000)}`;
    const hydratedLib = libraryDocConverter.fromFirestore('lib-legacy-1', {
      name: 'Historical Archive',
      ownerId: 'user-1',
      ownerName: 'Ada Lovelace',
      sharedWith: ['legacy@example.com'],
      heroImageUrl: largeBase64Banner,
      createdAt: fakeTimestamp,
    });

    expect(hydratedLib.id).toBe('lib-legacy-1');
    expect(hydratedLib.heroImageUrl).toBe(largeBase64Banner);
    expect('sharedWith' in hydratedLib).toBe(false);

    // HTTP(S) URLs exceeding 2,048 chars must still be rejected on library heroImageUrl
    expect(() =>
      libraryDocConverter.fromFirestore('lib-bad-url', {
        name: 'Oversized HTTP URL',
        ownerId: 'user-1',
        heroImageUrl: `https://example.com/${'a'.repeat(2500)}.jpg`,
      }),
    ).toThrow(SchemaValidationError);

    // 2. Book with legacy fields (genres, genre, description, readingStatus) and nullable temporalMetadata + lastSyncedAt
    const hydratedBook = bookDocConverter.fromFirestore(
      'book-legacy-1',
      {
        title: 'The Monuments Men',
        author: 'Robert M. Edsel',
        isbn: '9781594630392',
        genres: ['History', 'World War II'],
        genre: 'History',
        description: 'Legacy embedded description field',
        readingStatus: 'finished',
        temporalMetadata: {
          isNonHistorical: false,
          startYear: null,
          endYear: null,
          eraName: null,
          rationale: null,
          lastProcessedAt: '2026-06-14T18:48:52.172Z',
          lastSyncedAt: '2026-10-22T12:46:23.743Z',
        },
        addedAt: fakeTimestamp,
      },
      '/libraries/lib-1/books/book-legacy-1',
    );

    expect(hydratedBook.id).toBe('book-legacy-1');
    expect(hydratedBook.temporalMetadata?.startYear).toBeNull();
    expect(hydratedBook.temporalMetadata?.endYear).toBeNull();
    expect(hydratedBook.temporalMetadata?.eraName).toBeNull();
    expect(hydratedBook.temporalMetadata?.rationale).toBeNull();
    expect(hydratedBook.temporalMetadata?.lastSyncedAt).toBe(
      '2026-10-22T12:46:23.743Z',
    );
    expect('genres' in hydratedBook).toBe(false);
    expect('genre' in hydratedBook).toBe(false);
    expect('description' in hydratedBook).toBe(false);
    expect('readingStatus' in hydratedBook).toBe(false);
  });
});
