/**
 * @fileoverview Centralized schema compliance registry and typed test fixture
 * builders validated by our strict Firestore stored document Zod schemas.
 * Ensures every collection and test suite uses 100% schema-validated payloads.
 */
import {
  storedBookDocSchema,
  storedBookDetailsDocSchema,
  storedReviewDocSchema,
  type StoredBookDoc,
  type StoredBookDetailsDoc,
  type StoredReviewDoc,
} from './book';
import {validateFirestoreReadPayload} from './common';
import {
  storedGeolocationCacheDocSchema,
  type StoredGeolocationCacheDoc,
} from './geolocation';
import {
  storedAllowedDuplicateDocSchema,
  storedLibraryDocSchema,
  storedUserProfileDocSchema,
  type StoredAllowedDuplicateDoc,
  type StoredLibraryDoc,
  type StoredUserProfileDoc,
} from './libraryApi';
import {
  storedUserReadingStateDocSchema,
  type StoredUserReadingStateDoc,
} from './readingState';
import {
  storedAllowlistUserDocSchema,
  storedWaitlistEntryDocSchema,
  type StoredAllowlistUserDoc,
  type StoredWaitlistEntryDoc,
} from './waitlist';

/**
 * Registry of all 10 persisted Firestore/disk stores and their corresponding
 * strict Zod schemas.
 */
export const STORED_DOCUMENT_SCHEMAS = {
  users: storedUserProfileDocSchema,
  readingStates: storedUserReadingStateDocSchema,
  libraries: storedLibraryDocSchema,
  books: storedBookDocSchema,
  bookDetails: storedBookDetailsDocSchema,
  reviews: storedReviewDocSchema,
  allowedDuplicates: storedAllowedDuplicateDocSchema,
  allowlist: storedAllowlistUserDocSchema,
  waitlist: storedWaitlistEntryDocSchema,
  geolocationCache: storedGeolocationCacheDocSchema,
} as const;

export type StoredCollectionName = keyof typeof STORED_DOCUMENT_SCHEMAS;

/**
 * Builds a schema-validated `StoredUserProfileDoc` fixture for tests.
 */
export function buildValidStoredUserProfileFixture(
  overrides: Partial<StoredUserProfileDoc> = {},
): StoredUserProfileDoc {
  const candidate: StoredUserProfileDoc = {
    uid: 'user-1',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    photoURL: 'https://example.com/ada.jpg',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedUserProfileDocSchema, candidate, {
    entity: 'StoredUserProfileDoc',
    documentPath: 'users/user-1',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredUserReadingStateDoc` fixture for tests.
 */
export function buildValidStoredReadingStateFixture(
  overrides: Partial<StoredUserReadingStateDoc> = {},
): StoredUserReadingStateDoc {
  const candidate: StoredUserReadingStateDoc = {
    id: 'isbn:9780140449136',
    userId: 'user-1',
    keyType: 'isbn',
    cleanIsbn: '9780140449136',
    bookId: 'book-1',
    libraryId: 'lib-1',
    status: 'want_to_read',
    bookSnapshot: {
      title: 'The Analytical Engine',
      author: 'Ada Lovelace',
      coverUrl: 'https://example.com/cover.jpg',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(
    storedUserReadingStateDocSchema,
    candidate,
    {
      entity: 'StoredUserReadingStateDoc',
      documentPath: 'users/user-1/readingStates/isbn:9780140449136',
      operation: 'read',
    },
  );
}

/**
 * Builds a schema-validated `StoredLibraryDoc` fixture for tests.
 */
export function buildValidStoredLibraryFixture(
  overrides: Partial<StoredLibraryDoc> = {},
): StoredLibraryDoc {
  const candidate: StoredLibraryDoc = {
    id: 'lib-1',
    name: 'Home Library',
    ownerId: 'user-1',
    bookCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedLibraryDocSchema, candidate, {
    entity: 'StoredLibraryDoc',
    documentPath: 'libraries/lib-1',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredBookDoc` fixture for tests.
 */
export function buildValidStoredBookFixture(
  overrides: Partial<StoredBookDoc> = {},
): StoredBookDoc {
  const candidate: StoredBookDoc = {
    id: 'book-1',
    title: 'Notes on the Analytical Engine',
    author: 'Ada Lovelace',
    isbn: '9780140449136',
    cleanIsbn: '9780140449136',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedBookDocSchema, candidate, {
    entity: 'StoredBookDoc',
    documentPath: 'libraries/lib-1/books/book-1',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredBookDetailsDoc` fixture for tests.
 */
export function buildValidStoredBookDetailsFixture(
  overrides: Partial<StoredBookDetailsDoc> = {},
): StoredBookDetailsDoc {
  const candidate: StoredBookDetailsDoc = {
    synopsis: 'Pioneering treatise on mechanical computation.',
    authorBio: 'English mathematician and writer.',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedBookDetailsDocSchema, candidate, {
    entity: 'StoredBookDetailsDoc',
    documentPath: 'libraries/lib-1/bookDetails/book-1',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredReviewDoc` fixture for tests.
 */
export function buildValidStoredReviewFixture(
  overrides: Partial<StoredReviewDoc> = {},
): StoredReviewDoc {
  const candidate: StoredReviewDoc = {
    id: 'user-1',
    userId: 'user-1',
    userName: 'Ada Lovelace',
    rating: 5,
    text: 'Remarkable clarity.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedReviewDocSchema, candidate, {
    entity: 'StoredReviewDoc',
    documentPath: 'libraries/lib-1/books/book-1/reviews/user-1',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredAllowedDuplicateDoc` fixture for tests.
 */
export function buildValidStoredAllowedDuplicateFixture(
  overrides: Partial<StoredAllowedDuplicateDoc> = {},
): StoredAllowedDuplicateDoc {
  const candidate: StoredAllowedDuplicateDoc = {
    id: 'dup-1',
    bookIds: ['book-1', 'book-2'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(
    storedAllowedDuplicateDocSchema,
    candidate,
    {
      entity: 'StoredAllowedDuplicateDoc',
      documentPath: 'libraries/lib-1/allowedDuplicates/dup-1',
      operation: 'read',
    },
  );
}

/**
 * Builds a schema-validated `StoredAllowlistUserDoc` fixture for tests.
 */
export function buildValidStoredAllowlistFixture(
  overrides: Partial<StoredAllowlistUserDoc> = {},
): StoredAllowlistUserDoc {
  const candidate: StoredAllowlistUserDoc = {
    email: 'ada@example.com',
    role: 'user',
    addedBy: 'admin@example.com',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedAllowlistUserDocSchema, candidate, {
    entity: 'StoredAllowlistUserDoc',
    documentPath: 'appSettings/allowlist/users/ada@example.com',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredWaitlistEntryDoc` fixture for tests.
 */
export function buildValidStoredWaitlistFixture(
  overrides: Partial<StoredWaitlistEntryDoc> = {},
): StoredWaitlistEntryDoc {
  const candidate: StoredWaitlistEntryDoc = {
    email: 'babbage@example.com',
    displayName: 'Charles Babbage',
    status: 'pending',
    requestedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(storedWaitlistEntryDocSchema, candidate, {
    entity: 'StoredWaitlistEntryDoc',
    documentPath: 'appSettings/waitlist/entries/babbage@example.com',
    operation: 'read',
  });
}

/**
 * Builds a schema-validated `StoredGeolocationCacheDoc` fixture for tests.
 */
export function buildValidStoredGeolocationFixture(
  overrides: Partial<StoredGeolocationCacheDoc> = {},
): StoredGeolocationCacheDoc {
  const candidate: StoredGeolocationCacheDoc = {
    id: 'london_uk',
    name: 'London, UK',
    lat: 51.5074,
    lng: -0.1278,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return validateFirestoreReadPayload(
    storedGeolocationCacheDocSchema,
    candidate,
    {
      entity: 'StoredGeolocationCacheDoc',
      documentPath: 'geolocationCache/london_uk',
      operation: 'read',
    },
  );
}
