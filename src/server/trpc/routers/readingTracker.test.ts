import {describe, it, expect, vi, beforeEach} from 'vitest';
import {appRouter} from './_app';
import {ReadingTrackerService} from '../../services/readingTracker';

vi.mock('../../services/readingTracker', () => ({
  ReadingTrackerService: {
    getPersonalReadingShelf: vi.fn(),
    searchUnifiedCatalog: vi.fn(),
    trackBook: vi.fn(),
  },
}));

describe('readingTrackerRouter', () => {
  const mockUserCtx = {
    user: {
      uid: 'user-1',
      email: 'reader@example.com',
      name: 'Reader One',
      role: 'user' as const,
      isAllowed: true,
    },
    isAppAllowed: true,
    isAdmin: false,
    traceId: 'trace-reading-tracker',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getShelf delegates to ReadingTrackerService.getPersonalReadingShelf', async () => {
    vi.mocked(ReadingTrackerService.getPersonalReadingShelf).mockResolvedValue({
      items: [],
      counts: {
        all: 0,
        want_to_read: 0,
        reading: 0,
        finished: 0,
        abandoned: 0,
      },
    });

    const caller = appRouter.createCaller(mockUserCtx);
    const res = await caller.readingTracker.getShelf({shelf: 'want_to_read'});

    expect(res.counts.all).toBe(0);
    expect(ReadingTrackerService.getPersonalReadingShelf).toHaveBeenCalledWith(
      'user-1',
      'reader@example.com',
      {shelf: 'want_to_read'},
    );
  });

  it('searchUnified delegates to ReadingTrackerService.searchUnifiedCatalog', async () => {
    vi.mocked(ReadingTrackerService.searchUnifiedCatalog).mockResolvedValue({
      libraryMatches: [],
      externalMatches: [],
    });

    const caller = appRouter.createCaller(mockUserCtx);
    const res = await caller.readingTracker.searchUnified({query: 'Le Guin'});

    expect(res).toEqual({libraryMatches: [], externalMatches: []});
    expect(ReadingTrackerService.searchUnifiedCatalog).toHaveBeenCalledWith(
      'user-1',
      'reader@example.com',
      'Le Guin',
    );
  });

  it('trackBook delegates to ReadingTrackerService.trackBook for external unowned books', async () => {
    vi.mocked(ReadingTrackerService.trackBook).mockResolvedValue({
      libraryId: 'virtual_user-1',
      bookId: 'vbook-1',
      status: 'want_to_read',
      ownershipStatus: 'unowned',
    });

    const caller = appRouter.createCaller(mockUserCtx);
    const res = await caller.readingTracker.trackBook({
      source: 'external',
      status: 'want_to_read',
      bookData: {
        title: 'Invisible Cities',
        author: 'Italo Calvino',
      },
    });

    expect(res.ownershipStatus).toBe('unowned');
    expect(ReadingTrackerService.trackBook).toHaveBeenCalledWith(
      'user-1',
      'reader@example.com',
      'Reader One',
      expect.objectContaining({
        source: 'external',
        status: 'want_to_read',
      }),
    );
  });
});
