import type {Book} from '../../types';

export const READ_SWIPE_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

export interface SwipeCandidateShape {
  id: string;
  readingStatus?: string;
  readStatusReviewedAt?: string | null;
}

export type SwipeCandidateBook = Book | SwipeCandidateShape;

export interface ReadSwipeEligibilityOptions {
  nowMs?: number;
  cooldownMs?: number;
  ignoreCooldown?: boolean;
}

export interface PartitionedSwipeBooks<T extends SwipeCandidateBook> {
  readyBooks: T[];
  recentlyCheckedBooks: T[];
  allUnreadBooks: T[];
  nextReadyAtMs: number | null;
}

const TERMINAL_READ_OR_ABANDONED_STATUSES = new Set([
  'finished',
  'completed',
  'abandoned',
]);

/**
 * Resolves the effective reading status for a given book from the caller-overlaid `readingStatus` field.
 */
export function getBookReadingStatusForUser(
  book: SwipeCandidateBook,
): string | null {
  if (
    typeof book.readingStatus === 'string' &&
    book.readingStatus.trim().length > 0
  ) {
    return book.readingStatus.trim();
  }
  return null;
}

/**
 * Returns the epoch millisecond timestamp of when the user last reviewed
 * this book in "Have You Read It?", or null if never reviewed or invalid.
 */
export function getBookLastReviewedAtMs(
  book: SwipeCandidateBook,
): number | null {
  const raw = book.readStatusReviewedAt;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Returns true if the user reviewed this book within the resting window (default 2 days).
 */
export function isBookInReadSwipeCooldown(
  book: SwipeCandidateBook,
  nowMs: number = Date.now(),
  cooldownMs: number = READ_SWIPE_COOLDOWN_MS,
): boolean {
  const reviewedAtMs = getBookLastReviewedAtMs(book);
  if (reviewedAtMs === null) {
    return false;
  }
  const elapsedMs = nowMs - reviewedAtMs;
  return elapsedMs >= 0 && elapsedMs < cooldownMs;
}

/**
 * Returns true if the book does NOT have a terminal status of read ('finished' or 'completed')
 * or 'abandoned' for the active user, regardless of whether it was checked recently.
 */
export function isBookUnreadForReadSwipe(book: SwipeCandidateBook): boolean {
  const status = getBookReadingStatusForUser(book);
  if (!status) {
    return true;
  }
  return !TERMINAL_READ_OR_ABANDONED_STATUSES.has(status.toLowerCase());
}

/**
 * Returns true if the book is eligible for the "Have You Read It?" swipe deck right now:
 * 1. Does not have a status of 'finished', 'completed', or 'abandoned'.
 * 2. Was not reviewed within the 2-day resting window (unless `ignoreCooldown` is true).
 */
export function isBookEligibleForReadSwipe(
  book: SwipeCandidateBook,
  options?: ReadSwipeEligibilityOptions,
): boolean {
  if (!isBookUnreadForReadSwipe(book)) {
    return false;
  }
  if (options?.ignoreCooldown) {
    return true;
  }
  return !isBookInReadSwipeCooldown(book, options?.nowMs, options?.cooldownMs);
}

/**
 * Filters a collection of books down to those eligible for the "Have You Read It?" swipe deck.
 */
export function filterEligibleSwipeBooks<T extends SwipeCandidateBook>(
  books: readonly T[],
  options?: ReadSwipeEligibilityOptions,
): T[] {
  return books.filter(book => isBookEligibleForReadSwipe(book, options));
}

/**
 * Splits a library's books into:
 * - `readyBooks`: unread books outside the 2-day resting window
 * - `recentlyCheckedBooks`: unread books reviewed within the last 2 days
 * - `allUnreadBooks`: all unread books combined
 * - `nextReadyAtMs`: earliest timestamp when a recently checked book returns to `readyBooks`
 */
export function partitionUnreadSwipeBooks<T extends SwipeCandidateBook>(
  books: readonly T[],
  nowMs: number = Date.now(),
  cooldownMs: number = READ_SWIPE_COOLDOWN_MS,
): PartitionedSwipeBooks<T> {
  const readyBooks: T[] = [];
  const recentlyCheckedBooks: T[] = [];
  const allUnreadBooks: T[] = [];
  let nextReadyAtMs: number | null = null;

  for (const book of books) {
    if (!isBookUnreadForReadSwipe(book)) {
      continue;
    }
    allUnreadBooks.push(book);

    const reviewedAtMs = getBookLastReviewedAtMs(book);
    const elapsedMs = reviewedAtMs !== null ? nowMs - reviewedAtMs : Infinity;
    if (reviewedAtMs !== null && elapsedMs >= 0 && elapsedMs < cooldownMs) {
      recentlyCheckedBooks.push(book);
      const readyAt = reviewedAtMs + cooldownMs;
      if (nextReadyAtMs === null || readyAt < nextReadyAtMs) {
        nextReadyAtMs = readyAt;
      }
    } else {
      readyBooks.push(book);
    }
  }

  return {
    readyBooks,
    recentlyCheckedBooks,
    allUnreadBooks,
    nextReadyAtMs,
  };
}

/**
 * Formats the time until `nextReadyAtMs` in a warm, conversational phrase.
 */
export function formatFriendlyReturnTime(
  nextReadyAtMs: number | null,
  nowMs: number = Date.now(),
): string {
  if (nextReadyAtMs === null) {
    return 'a couple of days';
  }
  const remainingMs = Math.max(0, nextReadyAtMs - nowMs);
  const hourMs = 60 * 60 * 1000;
  const remainingHours = Math.ceil(remainingMs / hourMs);

  if (remainingHours <= 1) {
    return 'less than an hour';
  }
  if (remainingHours < 24) {
    return `about ${remainingHours} hours`;
  }
  if (remainingHours <= 30) {
    return 'about a day';
  }
  return 'about 2 days';
}

/**
 * Performs an unbiased Fisher-Yates shuffle on a list of items.
 * Accepts an optional RNG function (defaults to Math.random) for deterministic testing.
 */
export function shuffleEligibleBooks<T>(
  items: readonly T[],
  randomFn: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Reconciles an existing shuffled queue of book IDs against an updated set of eligible IDs
 * without reshuffling the existing order or re-inserting books skipped in the current pass.
 */
export function reconcileSwipeQueue(
  currentQueueIds: readonly string[],
  eligibleBookIds: ReadonlySet<string>,
  reviewedInCurrentPassIds: ReadonlySet<string>,
  randomFn: () => number = Math.random,
): string[] {
  const kept = currentQueueIds.filter(
    id => eligibleBookIds.has(id) && !reviewedInCurrentPassIds.has(id),
  );
  const keptSet = new Set(kept);

  const newlyEligible: string[] = [];
  for (const id of eligibleBookIds) {
    if (!keptSet.has(id) && !reviewedInCurrentPassIds.has(id)) {
      newlyEligible.push(id);
    }
  }

  if (newlyEligible.length === 0) {
    return kept;
  }

  return [...kept, ...shuffleEligibleBooks(newlyEligible, randomFn)];
}
