import {describe, expect, it} from 'vitest';
import type {Book} from '../../types';
import {
  READ_SWIPE_COOLDOWN_MS,
  filterEligibleSwipeBooks,
  formatFriendlyReturnTime,
  getBookLastReviewedAtMs,
  getBookReadingStatusForUser,
  isBookEligibleForReadSwipe,
  isBookInReadSwipeCooldown,
  partitionUnreadSwipeBooks,
  reconcileSwipeQueue,
  shuffleEligibleBooks,
} from './readSwipeMath';

function createMockBook(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    title: `Book ${id}`,
    author: 'Author Name',
    addedAt: '2026-01-01',
    ...overrides,
  };
}

describe('readSwipeMath', () => {
  const fixedNowMs = Date.parse('2026-10-24T12:00:00.000Z');

  describe('getBookReadingStatusForUser', () => {
    it('returns the caller-overlaid readingStatus when present', () => {
      const book = createMockBook('1', {
        readingStatus: 'finished',
      });

      expect(getBookReadingStatusForUser(book)).toBe('finished');
    });

    it('returns null when readingStatus is not present or empty', () => {
      const book = createMockBook('1');
      expect(getBookReadingStatusForUser(book)).toBeNull();
    });
  });

  describe('getBookLastReviewedAtMs and isBookInReadSwipeCooldown', () => {
    it('parses caller-overlaid ISO timestamps and enforces the 2-day (48-hour) pause window', () => {
      expect(READ_SWIPE_COOLDOWN_MS).toBe(2 * 24 * 60 * 60 * 1000);

      const recentIso = new Date(
        fixedNowMs - 12 * 60 * 60 * 1000,
      ).toISOString(); // 12 hours ago
      const expiredIso = new Date(
        fixedNowMs - 50 * 60 * 60 * 1000,
      ).toISOString(); // 50 hours ago

      const recentBook = createMockBook('1', {
        readStatusReviewedAt: recentIso,
      });
      const expiredBook = createMockBook('2', {
        readStatusReviewedAt: expiredIso,
      });
      const unreviewedBook = createMockBook('3');

      expect(getBookLastReviewedAtMs(recentBook)).toBe(Date.parse(recentIso));
      expect(isBookInReadSwipeCooldown(recentBook, fixedNowMs)).toBe(true);
      expect(isBookInReadSwipeCooldown(expiredBook, fixedNowMs)).toBe(false);
      expect(isBookInReadSwipeCooldown(unreviewedBook, fixedNowMs)).toBe(false);
    });
  });

  describe('isBookEligibleForReadSwipe', () => {
    it('includes books with no status, unset, want_to_read, or reading status when not in cooldown', () => {
      expect(isBookEligibleForReadSwipe(createMockBook('1'))).toBe(true);
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('2', {readingStatus: 'unset'}),
        ),
      ).toBe(true);
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('3', {readingStatus: 'reading'}),
        ),
      ).toBe(true);
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('4', {readingStatus: 'want_to_read'}),
        ),
      ).toBe(true);
    });

    it('excludes books marked as finished, completed, or abandoned for the current user', () => {
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('1', {readingStatus: 'finished'}),
        ),
      ).toBe(false);
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('2', {readingStatus: 'completed'}),
        ),
      ).toBe(false);
      expect(
        isBookEligibleForReadSwipe(
          createMockBook('3', {readingStatus: 'abandoned'}),
        ),
      ).toBe(false);
    });

    it('excludes unread books reviewed within the last 2 days unless ignoreCooldown is set', () => {
      const reviewedOneDayAgo = new Date(
        fixedNowMs - 24 * 60 * 60 * 1000,
      ).toISOString();
      const book = createMockBook('1', {
        readStatusReviewedAt: reviewedOneDayAgo,
      });

      expect(isBookEligibleForReadSwipe(book, {nowMs: fixedNowMs})).toBe(false);
      expect(
        isBookEligibleForReadSwipe(book, {
          nowMs: fixedNowMs,
          ignoreCooldown: true,
        }),
      ).toBe(true);
    });
  });

  describe('filterEligibleSwipeBooks and partitionUnreadSwipeBooks', () => {
    it('partitions unread books into readyBooks and recentlyCheckedBooks and computes nextReadyAtMs', () => {
      const sixHoursAgoIso = new Date(
        fixedNowMs - 6 * 60 * 60 * 1000,
      ).toISOString();
      const thirtyHoursAgoIso = new Date(
        fixedNowMs - 30 * 60 * 60 * 1000,
      ).toISOString();
      const threeDaysAgoIso = new Date(
        fixedNowMs - 72 * 60 * 60 * 1000,
      ).toISOString();

      const books = [
        createMockBook('never-reviewed'),
        createMockBook('reviewed-3d-ago', {
          readStatusReviewedAt: threeDaysAgoIso,
        }),
        createMockBook('reviewed-6h-ago', {
          readStatusReviewedAt: sixHoursAgoIso,
        }),
        createMockBook('reviewed-30h-ago', {
          readStatusReviewedAt: thirtyHoursAgoIso,
        }),
        createMockBook('finished-book', {readingStatus: 'finished'}),
      ];

      const partitioned = partitionUnreadSwipeBooks(books, fixedNowMs);

      expect(partitioned.readyBooks.map(b => b.id)).toEqual([
        'never-reviewed',
        'reviewed-3d-ago',
      ]);
      expect(partitioned.recentlyCheckedBooks.map(b => b.id)).toEqual([
        'reviewed-6h-ago',
        'reviewed-30h-ago',
      ]);
      expect(partitioned.allUnreadBooks.map(b => b.id)).toEqual([
        'never-reviewed',
        'reviewed-3d-ago',
        'reviewed-6h-ago',
        'reviewed-30h-ago',
      ]);
      expect(partitioned.nextReadyAtMs).toBe(
        Date.parse(thirtyHoursAgoIso) + READ_SWIPE_COOLDOWN_MS,
      );
      expect(
        formatFriendlyReturnTime(partitioned.nextReadyAtMs, fixedNowMs),
      ).toBe('about 18 hours');

      const readyViaFilter = filterEligibleSwipeBooks(books, {
        nowMs: fixedNowMs,
      });
      expect(readyViaFilter.map(b => b.id)).toEqual([
        'never-reviewed',
        'reviewed-3d-ago',
      ]);
    });
  });

  describe('shuffleEligibleBooks', () => {
    it('returns a new array with the same elements without mutating input', () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const copy = [...ids];
      let seed = 0.15;
      const deterministicRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const shuffled = shuffleEligibleBooks(ids, deterministicRandom);
      expect(ids).toEqual(copy);
      expect([...shuffled].sort()).toEqual(copy);
    });
  });

  describe('reconcileSwipeQueue', () => {
    it('preserves existing queue order and appends newly eligible books', () => {
      const currentQueue = ['b2', 'b1', 'b3'];
      const eligibleIds = new Set(['b1', 'b2', 'b4']);
      const reviewedIds = new Set(['b3']);

      const result = reconcileSwipeQueue(
        currentQueue,
        eligibleIds,
        reviewedIds,
        () => 0.5,
      );
      expect(result).toEqual(['b2', 'b1', 'b4']);
    });
  });
});
