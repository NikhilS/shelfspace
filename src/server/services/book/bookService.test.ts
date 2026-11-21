import {describe, it, expect, vi, beforeEach} from 'vitest';
import {TRPCError} from '@trpc/server';
import {BookService} from './index';
import * as adminModule from '../firebaseAdmin';
import {
  createFakeFirestore,
  type FakeFirestore,
} from '../../testing/fakeFirestore';

describe('BookService — FakeFirestore Integration & Canonical Ledger', () => {
  let fake: FakeFirestore;

  beforeEach(() => {
    vi.restoreAllMocks();
    const created = createFakeFirestore();
    fake = created.fake;
    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue(created.db);
    fake.seedDoc('libraries/lib-1', {
      name: 'Home Archive',
      ownerId: 'user-1',
      access: {'user1@example.com': 'owner'},
      collaboratorEmails: ['user1@example.com'],
      bookCount: 0,
    });
  });

  describe('createBook', () => {
    it('creates book with primaryGenreLower/missingFlags, partitions heavy details to bookDetails, and writes slim readingStates stub to book:<libraryId>:<bookId>', async () => {
      const res = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '978-0-441-17271-9',
        primaryGenre: 'Science Fiction',
        synopsis: 'Desert planet spice story',
        authorBio: 'American sci-fi master',
        embedding: [0.1, 0.2, 0.3],
        readingStatus: 'reading',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBe('book-1');
      expect(res.book?.readingStatus).toBe('reading');

      const storedBook = fake.inspectDoc('libraries/lib-1/books/book-1');
      expect(storedBook).toMatchObject({
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        cleanIsbn: '9780441172719',
        dedupeKey: 'dune::frank herbert',
        primaryGenre: 'Science Fiction',
        primaryGenreLower: 'science fiction',
        bookDetailsMetadata: {
          hasSynopsis: true,
          hasAuthorBio: true,
          hasEmbedding: true,
          hasClusterCoordinates: false,
        },
      });
      expect(storedBook?.synopsis).toBeUndefined();
      expect(storedBook?.missingFlags).toEqual(
        expect.arrayContaining(['geo', 'temporal', 'coverImage', 'series']),
      );
      expect(storedBook?.missingFlags).not.toContain('genre');
      expect(storedBook?.missingFlags).not.toContain('synopsis');
      expect(storedBook?.missingFlags).not.toContain('authorBio');
      expect(storedBook?.missingFlags).not.toContain('embedding');

      const storedDetails = fake.inspectDoc(
        'libraries/lib-1/bookDetails/book-1',
      );
      expect(storedDetails).toMatchObject({
        synopsis: 'Desert planet spice story',
        authorBio: 'American sci-fi master',
        embedding: [0.1, 0.2, 0.3],
      });

      const storedState = fake.inspectDoc(
        'users/user-1/readingStates/book:lib-1:book-1',
      );
      expect(storedState).toMatchObject({
        id: 'book:lib-1:book-1',
        userId: 'user-1',
        keyType: 'book',
        cleanIsbn: '9780441172719',
        bookId: 'book-1',
        libraryId: 'lib-1',
        status: 'reading',
      });
      const snapshot = storedState?.bookSnapshot as Record<string, unknown>;
      expect(snapshot).toMatchObject({
        title: 'Dune',
        author: 'Frank Herbert',
        cleanIsbn: '9780441172719',
        bookId: 'book-1',
        libraryId: 'lib-1',
      });
      expect(snapshot.synopsis).toBeUndefined();
      expect(snapshot.authorBio).toBeUndefined();

      const updatedLib = fake.inspectDoc('libraries/lib-1');
      expect(updatedLib?.bookCount).toBe(1);
    });

    it('generates a book ID if none is supplied and clears any prior tombstone on re-creation', async () => {
      fake.seedDoc('libraries/lib-1/tombstones/book-reborn', {
        id: 'book-reborn',
        libraryId: 'lib-1',
        deletedAtMs: Date.now() - 5000,
      });

      const res = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-reborn',
        title: 'Reborn Book',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBe('book-reborn');
      expect(
        fake.inspectDoc('libraries/lib-1/tombstones/book-reborn'),
      ).toBeUndefined();

      const autoRes = await BookService.createBook('user-1', {
        libraryId: 'lib-1',
        title: 'Auto ID Book',
      });
      expect(autoRes.id).toBeDefined();
    });
  });

  describe('updateBook', () => {
    it('updates core fields, recalculates primaryGenreLower and missingFlags, and writes heavy fields to bookDetails', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        missingFlags: [
          'geo',
          'temporal',
          'genre',
          'synopsis',
          'authorBio',
          'embedding',
          'coverImage',
          'series',
        ],
      });

      const res = await BookService.updateBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        updates: {
          title: 'Dune Messiah',
          synopsis: 'Second Dune book',
          primaryGenre: 'Science Fiction',
        },
      });

      expect(res.success).toBe(true);

      const updatedBook = fake.inspectDoc('libraries/lib-1/books/book-1');
      expect(updatedBook).toMatchObject({
        title: 'Dune Messiah',
        primaryGenre: 'Science Fiction',
        primaryGenreLower: 'science fiction',
        bookDetailsMetadata: {hasSynopsis: true},
      });
      expect(updatedBook?.missingFlags).not.toContain('genre');
      expect(updatedBook?.missingFlags).not.toContain('synopsis');

      const details = fake.inspectDoc('libraries/lib-1/bookDetails/book-1');
      expect(details?.synopsis).toBe('Second Dune book');
    });
  });

  describe('deleteBook & syncChanges tombstones', () => {
    it('deletes book, detail, and reviews, decrements bookCount, and persists a Firestore tombstone surfaced by syncChanges', async () => {
      const beforeDeleteMs = Date.now() - 100;
      fake.seedDoc('libraries/lib-1', {
        name: 'Home Archive',
        ownerId: 'user-1',
        bookCount: 2,
      });
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Doomed Book',
        author: 'Author X',
      });
      fake.seedDoc('libraries/lib-1/bookDetails/book-1', {
        synopsis: 'Old synopsis',
      });
      fake.seedDoc('libraries/lib-1/books/book-1/reviews/rev-1', {
        userId: 'user-1',
        rating: 4,
        text: 'Good',
      });

      const res = await BookService.deleteBook('user-1', {
        libraryId: 'lib-1',
        bookId: 'book-1',
      });

      expect(res.success).toBe(true);
      expect(fake.inspectDoc('libraries/lib-1/books/book-1')).toBeUndefined();
      expect(
        fake.inspectDoc('libraries/lib-1/bookDetails/book-1'),
      ).toBeUndefined();
      expect(
        fake.inspectDoc('libraries/lib-1/books/book-1/reviews/rev-1'),
      ).toBeUndefined();
      expect(fake.inspectDoc('libraries/lib-1')?.bookCount).toBe(1);
      expect(
        fake.inspectDoc('libraries/lib-1/tombstones/book-1'),
      ).toBeDefined();

      const delta = await BookService.syncChanges('user-1', 'lib-1', {
        sinceUpdatedAtMs: beforeDeleteMs,
      });
      expect(delta.deletedBookIds).toContain('book-1');
    });
  });

  describe('batchUpsert', () => {
    it('executes batch creation/deletion, updates bookCount net delta, and writes tombstones for deleted books', async () => {
      fake.seedDoc('libraries/lib-1', {
        name: 'Home Archive',
        ownerId: 'user-1',
        bookCount: 1,
      });
      fake.seedDoc('libraries/lib-1/books/b-3', {
        id: 'b-3',
        title: 'Old Book',
        author: 'Author 3',
      });

      const res = await BookService.batchUpsert('user-1', {
        libraryId: 'lib-1',
        operations: [
          {
            type: 'create',
            bookId: 'b-1',
            data: {title: 'Book 1', synopsis: 'Synopsis 1'},
          },
          {
            type: 'create',
            bookId: 'b-2',
            data: {title: 'Book 2'},
          },
          {
            type: 'delete',
            bookId: 'b-3',
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(3);
      expect(res.added).toBe(2);
      expect(res.deleted).toBe(1);
      expect(fake.inspectDoc('libraries/lib-1')?.bookCount).toBe(2);
      expect(fake.inspectDoc('libraries/lib-1/tombstones/b-3')).toBeDefined();
    });

    it('handles books array with action flags', async () => {
      fake.seedDoc('libraries/lib-1/books/b-11', {
        id: 'b-11',
        title: 'Existing Book 11',
        author: 'Author 11',
      });
      fake.seedDoc('libraries/lib-1/books/b-12', {
        id: 'b-12',
        title: 'Existing Book 12',
        author: 'Author 12',
      });

      const res = await BookService.batchUpsert('user-1', {
        libraryId: 'lib-1',
        books: [
          {id: 'b-10', title: 'Book 10', action: 'create'},
          {id: 'b-11', title: 'Book 11 Updated', action: 'update'},
          {id: 'b-12', action: 'delete'},
        ],
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(3);
      expect(res.added).toBe(1);
      expect(res.updated).toBe(1);
      expect(res.deleted).toBe(1);
    });

    it('pre-fetches existing core book metadata without reading bookDetails and writes a slim stub to book:<libraryId>:<bookId>', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Ship of Magic',
        author: 'Robin Hobb',
        isbn: '978-0-553-57563-7',
        cleanIsbn: '9780553575637',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9780553575637-L.jpg',
        primaryGenre: 'Fantasy',
        subgenres: ['Epic Fantasy'],
        series: 'Liveship Traders',
        format: 'physical',
        ownershipStatus: 'owned',
      });

      const res = await BookService.batchUpsert('user-1', {
        libraryId: 'lib-1',
        operations: [
          {
            type: 'update',
            bookId: 'book-1',
            data: {readingStatus: 'finished'},
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.updated).toBe(1);

      const state = fake.inspectDoc(
        'users/user-1/readingStates/book:lib-1:book-1',
      );
      expect(state).toMatchObject({
        id: 'book:lib-1:book-1',
        userId: 'user-1',
        keyType: 'book',
        cleanIsbn: '9780553575637',
        bookId: 'book-1',
        libraryId: 'lib-1',
        status: 'finished',
        bookSnapshot: {
          title: 'Ship of Magic',
          author: 'Robin Hobb',
          isbn: '978-0-553-57563-7',
          cleanIsbn: '9780553575637',
          series: 'Liveship Traders',
        },
      });
    });
  });

  describe('getBook', () => {
    it('fetches book, heavy details, and predicted book:<libId>:<bookId> readingState in a single db.getAll RTT', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
      });
      fake.seedDoc('libraries/lib-1/bookDetails/book-1', {
        synopsis: 'Spice world',
      });
      fake.seedDoc('users/user-1/readingStates/book:lib-1:book-1', {
        id: 'book:lib-1:book-1',
        userId: 'user-1',
        keyType: 'book',
        bookId: 'book-1',
        libraryId: 'lib-1',
        status: 'reading',
        rating: 5,
      });

      const getAllSpy = vi.spyOn(fake, 'getAll');
      const res = await BookService.getBook('user-1', 'lib-1', 'book-1');
      expect(getAllSpy).toHaveBeenCalledTimes(1);
      expect(res.id).toBe('book-1');
      expect(res.title).toBe('Dune');
      expect(res.synopsis).toBe('Spice world');
      expect(res.readingStatus).toBe('reading');
      expect(res.userRating).toBe(5);
    });

    it('throws NOT_FOUND when book document does not exist', async () => {
      await expect(
        BookService.getBook('user-1', 'lib-1', 'nonexistent'),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe('listBooks', () => {
    it('returns formatted books and overlays projected readingStates across canonical and legacy keys', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Neuromancer',
        author: 'William Gibson',
        primaryGenre: 'Cyberpunk',
        primaryGenreLower: 'cyberpunk',
        subgenres: ['Sci-Fi'],
        temporalMetadata: {startYear: 1984},
        addedAt: '2026-01-02T00:00:00.000Z',
      });
      fake.seedDoc('libraries/lib-1/books/book-2', {
        id: 'book-2',
        title: 'Snow Crash',
        author: 'Neal Stephenson',
        addedAt: '2026-01-01T00:00:00.000Z',
      });

      const res = await BookService.listBooks('user-1', 'lib-1');
      expect(res.books).toHaveLength(2);
      expect(res.books[0].title).toBe('Neuromancer');
      expect(
        (res.books[0].temporalMetadata as {endYear?: number} | undefined)
          ?.endYear,
      ).toBe(1984);
      expect(res.books[1].title).toBe('Snow Crash');
    });

    it('filters books natively by missingFlags array-contains and primaryGenreLower', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Has Geo',
        author: 'Author A',
        primaryGenre: 'Sci-Fi',
        primaryGenreLower: 'sci-fi',
        geoMetadata: {
          locations: [{name: 'Paris', coordinates: {lat: 10, lng: 20}}],
        },
        missingFlags: ['temporal'],
        addedAt: '2026-01-02T00:00:00.000Z',
      });
      fake.seedDoc('libraries/lib-1/books/book-2', {
        id: 'book-2',
        title: 'Missing Geo',
        author: 'Author B',
        primaryGenre: 'Fantasy',
        primaryGenreLower: 'fantasy',
        missingFlags: ['geo', 'temporal'],
        addedAt: '2026-01-01T00:00:00.000Z',
      });

      const missingRes = await BookService.listBooks('user-1', 'lib-1', {
        filters: {missingMetadata: 'geo'},
      });
      expect(missingRes.books).toHaveLength(1);
      expect(missingRes.books[0].title).toBe('Missing Geo');

      const genreRes = await BookService.listBooks('user-1', 'lib-1', {
        filters: {primaryGenre: 'SCI-FI'},
      });
      expect(genreRes.books).toHaveLength(1);
      expect(genreRes.books[0].title).toBe('Has Geo');
    });

    it('uses limit + 1 lookahead to populate nextCursor and self-heals drifted bookCount', async () => {
      fake.seedDoc('libraries/lib-1', {
        name: 'Home Archive',
        ownerId: 'user-1',
        bookCount: 1000,
      });
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Book 1',
        author: 'Author 1',
        addedAt: '2026-01-03T00:00:00.000Z',
      });
      fake.seedDoc('libraries/lib-1/books/book-2', {
        id: 'book-2',
        title: 'Book 2',
        author: 'Author 2',
        addedAt: '2026-01-02T00:00:00.000Z',
      });
      fake.seedDoc('libraries/lib-1/books/book-3', {
        id: 'book-3',
        title: 'Book 3',
        author: 'Author 3',
        addedAt: '2026-01-01T00:00:00.000Z',
      });

      const paged = await BookService.listBooks('user-1', 'lib-1', {limit: 2});
      expect(paged.books).toHaveLength(2);
      expect(paged.nextCursor).toBe('book-2');

      const unpaged = await BookService.listBooks('user-1', 'lib-1', {
        prefetchedLibraryData: {bookCount: 1000},
      });
      expect(unpaged.totalCount).toBe(3);
    });

    it('filters by caller reading status across canonical book: keys and standalone ext: keys', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Hyperion',
        author: 'Dan Simmons',
        isbn: '978-0-553-28368-6',
        cleanIsbn: '9780553283686',
        addedAt: '2026-01-02T00:00:00.000Z',
      });
      fake.seedDoc('libraries/lib-1/books/book-2', {
        id: 'book-2',
        title: 'Endymion',
        author: 'Dan Simmons',
        addedAt: '2026-01-01T00:00:00.000Z',
      });
      fake.seedDoc('users/user-1/readingStates/ext:9780553283686', {
        id: 'ext:9780553283686',
        userId: 'user-1',
        keyType: 'ext',
        cleanIsbn: '9780553283686',
        status: 'reading',
        rating: 5,
      });
      fake.seedDoc('users/user-1/readingStates/book:lib-1:book-2', {
        id: 'book:lib-1:book-2',
        userId: 'user-1',
        keyType: 'book',
        bookId: 'book-2',
        libraryId: 'lib-1',
        status: 'finished',
      });

      const resStatus = await BookService.listBooks('user-1', 'lib-1', {
        filters: {status: 'reading'},
      });
      expect(resStatus.books).toHaveLength(1);
      expect(resStatus.books[0].title).toBe('Hyperion');
      expect(resStatus.books[0].userRating).toBe(5);
    });
  });

  describe('mergeDuplicates', () => {
    it('merges duplicate books, writes tombstones for removed duplicates, and migrates readingState to canonical survivor key', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
      });
      fake.seedDoc('libraries/lib-1/books/book-dup-1', {
        id: 'book-dup-1',
        title: 'Dune (Duplicate)',
        author: 'Frank Herbert',
      });
      fake.seedDoc('users/user-1/readingStates/book:lib-1:book-dup-1', {
        id: 'book:lib-1:book-dup-1',
        userId: 'user-1',
        keyType: 'book',
        bookId: 'book-dup-1',
        libraryId: 'lib-1',
        status: 'finished',
        rating: 5,
      });

      const res = await BookService.mergeDuplicates('user-1', {
        libraryId: 'lib-1',
        survivorBookId: 'book-1',
        duplicateBookIds: ['book-dup-1'],
        mergedFields: {
          title: 'Dune (Definitive Edition)',
        },
      });

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(1);
      expect(
        fake.inspectDoc('libraries/lib-1/tombstones/book-dup-1'),
      ).toBeDefined();
      expect(
        fake.inspectDoc('users/user-1/readingStates/book:lib-1:book-dup-1'),
      ).toBeUndefined();
      expect(
        fake.inspectDoc('users/user-1/readingStates/book:lib-1:book-1'),
      ).toMatchObject({
        status: 'finished',
        rating: 5,
      });
    });
  });

  describe('addReview & status migration', () => {
    it('commits deterministic review document and syncs rating/reviewText to canonical book:<libId>:<bookId>', async () => {
      fake.seedDoc('libraries/lib-1/books/book-1', {
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '978-0-441-17271-9',
        cleanIsbn: '9780441172719',
      });

      const res = await BookService.addReview(
        'user-1',
        'user1@example.com',
        'Reader One',
        'lib-1',
        'book-1',
        {rating: 5, text: 'Masterpiece!'},
        {skipAccessCheck: true, status: 'finished'},
      );

      expect(res.success).toBe(true);
      expect(res.id).toBe('user-1');
      expect(
        fake.inspectDoc('libraries/lib-1/books/book-1/reviews/user-1'),
      ).toMatchObject({
        userId: 'user-1',
        userName: 'Reader One',
        rating: 5,
        text: 'Masterpiece!',
      });
      expect(
        fake.inspectDoc('users/user-1/readingStates/book:lib-1:book-1'),
      ).toMatchObject({
        id: 'book:lib-1:book-1',
        keyType: 'book',
        cleanIsbn: '9780441172719',
        rating: 5,
        reviewText: 'Masterpiece!',
        status: 'finished',
      });
    });

    it('promotes standalone ext:<cleanIsbn> readingState to canonical book:<libraryId>:<bookId> when tracked on a library', async () => {
      fake.seedDoc('users/user-1/readingStates/ext:9780553573398', {
        id: 'ext:9780553573398',
        userId: 'user-1',
        keyType: 'ext',
        cleanIsbn: '9780553573398',
        bookId: 'book-farseer-1',
        libraryId: 'lib-1',
        status: 'reading',
        bookSnapshot: {
          title: "Assassin's Apprentice",
          author: 'Robin Hobb',
          isbn: '9780553573398',
          cleanIsbn: '9780553573398',
        },
      });

      const res = await BookService.updateBookStatus(
        'user-1',
        'lib-1',
        'book-farseer-1',
        'finished',
        {
          bookSnapshot: {
            title: "Assassin's Apprentice",
            author: 'Robin Hobb',
            isbn: '9780553573398',
            cleanIsbn: '9780553573398',
          },
        },
      );

      expect(res.stateKey).toBe('book:lib-1:book-farseer-1');
      expect(res.id).toBe('book-farseer-1');
      expect(
        fake.inspectDoc('users/user-1/readingStates/book:lib-1:book-farseer-1'),
      ).toMatchObject({
        id: 'book:lib-1:book-farseer-1',
        keyType: 'book',
        cleanIsbn: '9780553573398',
        bookId: 'book-farseer-1',
        status: 'finished',
      });
      expect(
        fake.inspectDoc('users/user-1/readingStates/ext:9780553573398'),
      ).toBeUndefined();
    });
  });

  describe('legacy book & nested metadata background self-healing', () => {
    it('normalizes genres, temporalMetadata.eraLabel, geoMetadata flat coords, and rescues embedded description to bookDetails on read', async () => {
      fake.seedDoc('libraries/vMZu9i2bVwmkOVgrwSyi', {
        name: 'Secondary Library',
        ownerId: 'user-1',
        access: {'user1@example.com': 'owner'},
        collaboratorEmails: ['user1@example.com'],
      });
      fake.seedDoc(
        'libraries/vMZu9i2bVwmkOVgrwSyi/books/XkYKCSHqOfisvfU01EDl',
        {
          title: 'All Quiet on the Western Front',
          author: 'Erich Maria Remarque',
          genres: ['Historical Fiction', 'Anti-War'],
          description: 'Unpartitioned legacy synopsis preserved on first read.',
          temporalMetadata: {
            isNonHistorical: false,
            startYear: 1914,
            endYear: 1918,
            eraLabel: 'World War I',
          },
          geoMetadata: {
            locations: [
              {
                name: 'Western Front',
                adminLevel: 'Region',
                lat: 49.9,
                lng: 2.9,
              },
            ],
          },
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      );

      const firstGet = await BookService.getBook(
        'user-1',
        'vMZu9i2bVwmkOVgrwSyi',
        'XkYKCSHqOfisvfU01EDl',
      );
      expect(firstGet.primaryGenre).toBe('Historical Fiction');
      expect(firstGet.subgenres).toEqual(['Anti-War']);
      expect(firstGet.synopsis).toBe(
        'Unpartitioned legacy synopsis preserved on first read.',
      );
      expect(firstGet.temporalMetadata?.eraName).toBe('World War I');
      expect(firstGet.geoMetadata?.locations?.[0]).toEqual({
        name: 'Western Front',
        adminLevel: 'region',
        coordinates: {lat: 49.9, lng: 2.9},
      });

      // Wait for 15ms micro-batch self-heal WriteBatch to commit to FakeFirestore
      await new Promise(resolve => setTimeout(resolve, 40));

      const healedBook = fake.inspectDoc(
        'libraries/vMZu9i2bVwmkOVgrwSyi/books/XkYKCSHqOfisvfU01EDl',
      );
      expect(healedBook).toBeDefined();
      expect(healedBook && 'genres' in healedBook).toBe(false);
      expect(healedBook && 'description' in healedBook).toBe(false);
      expect(
        (healedBook?.temporalMetadata as Record<string, unknown> | undefined)
          ?.eraLabel,
      ).toBeUndefined();
      expect(
        (healedBook?.temporalMetadata as Record<string, unknown> | undefined)
          ?.eraName,
      ).toBe('World War I');

      const rescuedDetails = fake.inspectDoc(
        'libraries/vMZu9i2bVwmkOVgrwSyi/bookDetails/XkYKCSHqOfisvfU01EDl',
      );
      expect(rescuedDetails?.synopsis).toBe(
        'Unpartitioned legacy synopsis preserved on first read.',
      );
    });
  });
});
