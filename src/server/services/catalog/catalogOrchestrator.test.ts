import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  ProviderQuotaScheduler,
  ProviderSkippedError,
} from '../scheduler/providerQuotaScheduler';
import {CatalogOrchestrator} from './catalogOrchestrator';
import type {ICatalogSourceProvider, ProviderBookHit} from './types';

function createMockProvider(
  overrides: Partial<ICatalogSourceProvider> & {
    id: ICatalogSourceProvider['id'];
    name: string;
  },
): ICatalogSourceProvider {
  const scheduler =
    overrides.scheduler ??
    new ProviderQuotaScheduler({
      providerId: overrides.id,
      maxConcurrent: 2,
      minSpacingMs: 0,
      maxRequestsPerMinute: 60,
      burstCapacity: 5,
    });

  return {
    id: overrides.id,
    name: overrides.name,
    authorityWeight: overrides.authorityWeight ?? 80,
    capabilities: overrides.capabilities ?? {
      isbnSearch: true,
      titleSearch: true,
      coverResolution: true,
      synopsis: true,
      series: true,
      genre: true,
    },
    scheduler,
    isAvailable: overrides.isAvailable ?? (() => true),
    searchByIsbn: overrides.searchByIsbn ?? vi.fn().mockResolvedValue(null),
    searchByQuery: overrides.searchByQuery ?? vi.fn().mockResolvedValue([]),
    resolveCovers: overrides.resolveCovers,
  };
}

describe('ProviderQuotaScheduler & CatalogOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('ProviderQuotaScheduler', () => {
    it('preempts BATCH jobs with INTERACTIVE jobs in the dual-priority queue', async () => {
      const executionOrder: string[] = [];
      const scheduler = new ProviderQuotaScheduler({
        providerId: 'test-provider',
        maxConcurrent: 1,
        minSpacingMs: 10,
        maxRequestsPerMinute: 600,
        burstCapacity: 10,
      });

      // Occupy the single active concurrency slot first
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });

      const job1 = scheduler.schedule({priority: 'BATCH'}, async () => {
        executionOrder.push('job1-batch-initial');
        await firstGate;
      });

      // Enqueue two BATCH jobs followed by an INTERACTIVE job while job1 is in-flight
      const job2 = scheduler.schedule({priority: 'BATCH'}, async () => {
        executionOrder.push('job2-batch');
      });
      const job3 = scheduler.schedule({priority: 'BATCH'}, async () => {
        executionOrder.push('job3-batch');
      });
      const job4Interactive = scheduler.schedule(
        {priority: 'INTERACTIVE'},
        async () => {
          executionOrder.push('job4-interactive');
        },
      );

      releaseFirst();
      await Promise.all([job1, job2, job3, job4Interactive]);

      expect(executionOrder).toEqual([
        'job1-batch-initial',
        'job4-interactive',
        'job2-batch',
        'job3-batch',
      ]);
    });

    it('trips cooldown circuit breaker on HTTP 429 and skips subsequent tasks when maxWaitMs is exceeded', async () => {
      const scheduler = new ProviderQuotaScheduler({
        providerId: 'rate-limited-provider',
        maxConcurrent: 2,
        minSpacingMs: 0,
        maxRequestsPerMinute: 60,
        burstCapacity: 4,
        defaultCooldownMs: 10_000,
        maxRetries: 0,
      });

      const rateLimitErr = Object.assign(new Error('429 Too Many Requests'), {
        status: 429,
        retryAfterMs: 8000,
      });

      await expect(
        scheduler.schedule({priority: 'INTERACTIVE'}, async () => {
          throw rateLimitErr;
        }),
      ).rejects.toThrow('429');

      const snapshot = scheduler.inspectCapacity('INTERACTIVE');
      expect(snapshot.status).toBe('COOLDOWN');
      expect(snapshot.cooldownRemainingMs).toBeGreaterThan(5000);

      await expect(
        scheduler.schedule(
          {priority: 'INTERACTIVE', maxWaitMs: 500},
          async () => 'should-not-run',
        ),
      ).rejects.toBeInstanceOf(ProviderSkippedError);
    });
  });

  describe('CatalogOrchestrator', () => {
    it('stiches the richest fields and ranks covers across multiple providers while skipping providers in cooldown', async () => {
      const appleProvider = createMockProvider({
        id: 'apple-books',
        name: 'Apple Books',
        authorityWeight: 94,
        searchByIsbn: vi.fn().mockResolvedValue({
          providerId: 'apple-books',
          providerName: 'Apple Books',
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
          coverUrl:
            'https://is1-ssl.mzstatic.com/image/thumb/dune/1000x1000bb.jpg',
          coverResolutionTier: 'ultra',
          primaryGenre: 'Science Fiction',
          subgenres: ['Space Opera'],
          synopsis:
            'Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world.',
        } satisfies ProviderBookHit),
      });

      const hardcoverProvider = createMockProvider({
        id: 'hardcover',
        name: 'Hardcover',
        authorityWeight: 92,
        searchByIsbn: vi.fn().mockResolvedValue({
          providerId: 'hardcover',
          providerName: 'Hardcover',
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
          coverUrl: 'https://assets.hardcover.app/dune.jpg',
          coverResolutionTier: 'high',
          series: 'Dune Chronicles #1',
          subgenres: ['Classics'],
        } satisfies ProviderBookHit),
      });

      const exhaustedScheduler = new ProviderQuotaScheduler({
        providerId: 'library-of-congress',
        maxConcurrent: 1,
        minSpacingMs: 0,
        maxRequestsPerMinute: 15,
      });
      exhaustedScheduler.recordCooldown(15_000);

      const locProvider = createMockProvider({
        id: 'library-of-congress',
        name: 'Library of Congress',
        authorityWeight: 78,
        scheduler: exhaustedScheduler,
        searchByIsbn: vi.fn(),
      });

      const orchestrator = new CatalogOrchestrator([
        appleProvider,
        hardcoverProvider,
        locProvider,
      ]);

      const merged = await orchestrator.searchByIsbn('9780441172719', {
        priority: 'INTERACTIVE',
        verifyCovers: false,
      });

      expect(merged).not.toBeNull();
      expect(merged?.title).toBe('Dune');
      expect(merged?.author).toBe('Frank Herbert');
      // Ultra-res Apple Books cover wins primary coverUrl
      expect(merged?.coverUrl).toBe(
        'https://is1-ssl.mzstatic.com/image/thumb/dune/1000x1000bb.jpg',
      );
      // Series is stitched from Hardcover
      expect(merged?.series).toBe('Dune Chronicles #1');
      // Both covers are preserved in coverCandidates for the Cover Gallery Picker
      expect(merged?.coverCandidates).toHaveLength(2);
      expect(merged?.sources).toEqual(
        expect.arrayContaining(['Apple Books', 'Hardcover']),
      );
      // Cooldown provider was skipped without being invoked
      expect(locProvider.searchByIsbn).not.toHaveBeenCalled();
    });

    it('aggregates and ranks unique cover candidates in fetchCoverCandidates', async () => {
      const prhProvider = createMockProvider({
        id: 'penguin-random-house',
        name: 'Penguin Random House',
        resolveCovers: vi.fn().mockResolvedValue([
          {
            url: 'https://images.penguinrandomhouse.com/cover/9780143127741',
            source: 'Penguin Random House',
            resolutionTier: 'ultra',
          },
        ]),
      });

      const googleProvider = createMockProvider({
        id: 'google-books',
        name: 'Google Books',
        resolveCovers: vi.fn().mockResolvedValue([
          {
            url: 'https://books.google.com/books/content?id=123&zoom=2',
            source: 'Google Books',
            resolutionTier: 'standard',
          },
        ]),
      });

      const orchestrator = new CatalogOrchestrator([
        googleProvider,
        prhProvider,
      ]);

      const res = await orchestrator.fetchCoverCandidates(
        {isbn: '9780143127741', title: 'The Martian', author: 'Andy Weir'},
        {priority: 'INTERACTIVE', verifyCovers: false},
      );

      expect(res.candidates).toHaveLength(2);
      expect(res.candidates[0].source).toBe('Penguin Random House');
      expect(res.candidates[1].source).toBe('Google Books');
    });

    it('exits early after Wave 1 in BATCH fetchCoverCandidates when a high/ultra cover is found', async () => {
      const appleProvider = createMockProvider({
        id: 'apple-books',
        name: 'Apple Books',
        resolveCovers: vi.fn().mockResolvedValue([
          {
            url: 'https://is1-ssl.mzstatic.com/image/thumb/martian/1000x1000bb.jpg',
            source: 'Apple Books',
            resolutionTier: 'ultra',
          },
        ]),
      });

      const locProvider = createMockProvider({
        id: 'library-of-congress',
        name: 'Library of Congress',
        resolveCovers: vi.fn().mockResolvedValue([
          {
            url: 'https://loc.gov/martian.jpg',
            source: 'Library of Congress',
            resolutionTier: 'high',
          },
        ]),
      });

      const orchestrator = new CatalogOrchestrator([
        appleProvider,
        locProvider,
      ]);

      const res = await orchestrator.fetchCoverCandidates(
        {isbn: '9780143127741', title: 'The Martian', author: 'Andy Weir'},
        {priority: 'BATCH', verifyCovers: false},
      );

      expect(res.candidates).toHaveLength(1);
      expect(res.candidates[0].source).toBe('Apple Books');
      expect(locProvider.resolveCovers).not.toHaveBeenCalled();
    });

    it('rejects Google Books 9,103-byte placeholder PNG covers via HEAD headers or GET byteLength fallback', async () => {
      const orchestrator = new CatalogOrchestrator([]);
      const placeholderUrl1 =
        'https://books.google.com/books/content?id=QRlkvgEACAAJ&printsec=frontcover&img=1&zoom=3&source=gbs_api';
      const placeholderUrl2 =
        'https://books.google.com/books/content?id=CHUNKED123&printsec=frontcover&img=1&zoom=1&source=gbs_api';
      const validUrl =
        'https://books.google.com/books/content?id=VALID999&printsec=frontcover&img=1&zoom=3&source=gbs_api';

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url === placeholderUrl1) {
            return new Response(null, {
              status: 200,
              headers: {'content-length': '9103', 'content-type': 'image/png'},
            });
          }
          if (url === placeholderUrl2) {
            if (init?.method === 'HEAD') {
              // Simulate missing content-length on HEAD
              return new Response(null, {
                status: 200,
                headers: {'content-type': 'image/png'},
              });
            }
            // Simulate 9103-byte body on GET fallback
            return new Response(new Uint8Array(9103), {
              status: 200,
              headers: {'content-type': 'image/png'},
            });
          }
          return new Response(null, {
            status: 200,
            headers: {'content-length': '48512', 'content-type': 'image/jpeg'},
          });
        });

      expect(await orchestrator.verifyCoverUrl(placeholderUrl1)).toBe(false);
      expect(await orchestrator.verifyCoverUrl(placeholderUrl2)).toBe(false);
      expect(await orchestrator.verifyCoverUrl(validUrl)).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('falls back to secondary provider cover during stitching when Google Books cover is a 9,103-byte placeholder', async () => {
      const placeholderUrl =
        'https://books.google.com/books/content?id=QRlkvgEACAAJ&printsec=frontcover&img=1&zoom=3&source=gbs_api';
      const validOpenLibraryUrl =
        'https://covers.openlibrary.org/b/isbn/9780143127741-L.jpg?default=false';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        if (url === placeholderUrl) {
          return new Response(null, {
            status: 200,
            headers: {'content-length': '9103', 'content-type': 'image/png'},
          });
        }
        return new Response(null, {
          status: 200,
          headers: {'content-length': '36200', 'content-type': 'image/jpeg'},
        });
      });

      const googleProvider = createMockProvider({
        id: 'google-books',
        name: 'Google Books',
        authorityWeight: 85,
        searchByIsbn: vi.fn().mockResolvedValue({
          providerId: 'google-books',
          providerName: 'Google Books',
          title: 'Placeholder Cover Book',
          author: 'Jane Doe',
          isbn: '9780143127741',
          coverUrl: placeholderUrl,
          coverResolutionTier: 'high',
        } satisfies ProviderBookHit),
      });

      const openLibraryProvider = createMockProvider({
        id: 'open-library',
        name: 'Open Library',
        authorityWeight: 75,
        searchByIsbn: vi.fn().mockResolvedValue({
          providerId: 'open-library',
          providerName: 'Open Library',
          title: 'Placeholder Cover Book',
          author: 'Jane Doe',
          isbn: '9780143127741',
          coverUrl: validOpenLibraryUrl,
          coverResolutionTier: 'high',
        } satisfies ProviderBookHit),
      });

      const orchestrator = new CatalogOrchestrator([
        googleProvider,
        openLibraryProvider,
      ]);

      const merged = await orchestrator.searchByIsbn('9780143127741', {
        priority: 'BATCH',
        verifyCovers: true,
      });

      expect(merged?.coverUrl).toBe(validOpenLibraryUrl);
      expect(merged?.fieldSources?.coverImage).toBe('Open Library');
    });

    it('returns a normalized array in searchByQuery and fetchCoverCandidates even when upstream providers return null or malformed items', async () => {
      const nullReturningProvider = createMockProvider({
        id: 'apple-books',
        name: 'Apple Books',
        searchByQuery: vi
          .fn()
          .mockResolvedValue(null as unknown as ProviderBookHit[]),
        resolveCovers: vi.fn().mockResolvedValue(null),
      });

      const partialReturningProvider = createMockProvider({
        id: 'google-books',
        name: 'Google Books',
        searchByQuery: vi.fn().mockResolvedValue([
          null as unknown as ProviderBookHit,
          {
            providerId: 'google-books',
            providerName: 'Google Books',
          } as unknown as ProviderBookHit,
          {
            providerId: 'google-books',
            providerName: 'Google Books',
            title: 'Born a Crime',
            author: 'Trevor Noah',
            isbn: '9780399588174',
            coverUrl: 'https://example.com/born-a-crime.jpg',
          } satisfies ProviderBookHit,
        ]),
      });

      const orchestrator = new CatalogOrchestrator([
        nullReturningProvider,
        partialReturningProvider,
      ]);

      const queryRes = await orchestrator.searchByQuery('Born a Crime', {
        priority: 'INTERACTIVE',
        verifyCovers: false,
      });

      expect(Array.isArray(queryRes.books)).toBe(true);
      expect(queryRes.books).toHaveLength(1);
      expect(queryRes.books[0].title).toBe('Born a Crime');

      const emptyOrchestrator = new CatalogOrchestrator([
        nullReturningProvider,
      ]);
      const emptyRes = await emptyOrchestrator.searchByQuery(
        {rawQuery: 'Unknown Nonexistent Book'},
        {priority: 'BATCH', verifyCovers: false},
      );
      expect(emptyRes.books).toEqual([]);

      const coverRes = await emptyOrchestrator.fetchCoverCandidates(
        {title: 'Unknown Nonexistent Book'},
        {priority: 'INTERACTIVE', verifyCovers: false},
      );
      expect(coverRes.candidates).toEqual([]);
    });
  });
});
