import {FirestoreDate} from '../types';
import {BookDetails} from '../services/bookApi';
import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toTitleCase(str: string) {
  if (!str) return '';
  // Match any sequence of non-whitespace characters
  return str.replace(/\S+/g, word => {
    const chars = Array.from(word);
    if (chars.length === 0) return '';
    const first = chars[0].toUpperCase();
    const rest = chars.slice(1).join('').toLowerCase();
    return first + rest;
  });
}

export function toSentenceCase(str: string) {
  if (!str) return '';
  const trimmed = str.trim();
  if (trimmed.length === 0) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function normalizeEmail(email?: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

export function normalizeName(name?: string): string {
  if (!name) return '';
  return toTitleCase(name.trim());
}

export function normalizeTitle(title?: string): string {
  if (!title) return '';
  return title.trim();
}

export function normalizeIsbn(isbn?: string): string {
  if (!isbn) return '';
  return isbn.replace(/[^0-9X]/gi, '').toUpperCase();
}

export function normalizeText(text?: string): string {
  if (!text) return '';
  return text.trim();
}

export function getFirestoreTime(
  dateObj?: string | number | Date | FirestoreDate | null,
): number {
  if (!dateObj) return 0;

  if (
    typeof dateObj === 'object' &&
    'toMillis' in dateObj &&
    typeof dateObj.toMillis === 'function'
  ) {
    return dateObj.toMillis();
  }

  const d = new Date(dateObj as string | number | Date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Parses and normalizes raw genre/category/subject identifiers from books.
 * Commas and semicolons are treated as delimiters, but slashes (e.g. "Fiction / History")
 * are preserved as full category paths.
 */
export function parseGenres(rawGenres: unknown): string[] {
  if (!rawGenres) return [];
  let tempGenres: string[] = [];
  if (Array.isArray(rawGenres)) {
    tempGenres = rawGenres.map(g => String(g));
  } else if (typeof rawGenres === 'string') {
    tempGenres = [rawGenres];
  } else if (typeof rawGenres === 'object' && rawGenres !== null) {
    tempGenres = Object.values(rawGenres).map(g => String(g));
  }

  const result = new Set<string>();
  tempGenres.forEach((g: string) => {
    if (typeof g === 'string') {
      const splits = g
        .split(/[,;]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
      splits.forEach((s: string) => {
        // Clean each segment to title case or sentence case but keep any inner slashes
        const normalized = s
          .split('/')
          .map(seg => seg.trim())
          .filter(Boolean)
          .join(' / ');
        if (normalized) {
          result.add(normalized);
        }
      });
    }
  });
  return Array.from(result);
}

/**
 * Triggers haptic feedback on supported devices.
 */
export function triggerHaptics(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

import {z} from 'zod';

export const bookMetadataSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  author: z.string().min(1, 'Author is required').max(500),
  isbn: z.string().optional(),
  coverUrl: z.string().optional(),
  synopsis: z.string().optional(),
  authorBio: z.string().optional(),
  publishedDate: z.string().optional(),
  genres: z.array(z.string()).optional(),
  series: z.string().optional(),
});

export type ValidatedBookMetadata = z.infer<typeof bookMetadataSchema>;

export interface MergeableBook {
  coverUrl?: string | null;
  synopsis?: string | null;
  authorBio?: string | null;
  publishedDate?: string | null;
  genres?: string[] | null;
}

export function mergeBookMetadata(
  existingBook: MergeableBook,
  enriched: MergeableBook,
  forceResync = false,
) {
  const newData: Record<string, unknown> = {};
  const heavyData: Record<string, unknown> = {};

  if (forceResync) {
    if (enriched.coverUrl) newData.coverUrl = enriched.coverUrl;
    if (enriched.synopsis) heavyData.synopsis = enriched.synopsis;
    if (enriched.authorBio) heavyData.authorBio = enriched.authorBio;
    if (enriched.publishedDate) newData.publishedDate = enriched.publishedDate;
    if (enriched.genres && enriched.genres.length > 0) {
      newData.genres = enriched.genres;
    }
  } else {
    if (!existingBook.coverUrl && enriched.coverUrl) {
      newData.coverUrl = enriched.coverUrl;
    }
    if (!existingBook.synopsis && enriched.synopsis) {
      heavyData.synopsis = enriched.synopsis;
    }
    if (!existingBook.authorBio && enriched.authorBio) {
      heavyData.authorBio = enriched.authorBio;
    }
    if (!existingBook.publishedDate && enriched.publishedDate) {
      newData.publishedDate = enriched.publishedDate;
    }
    if (
      (!existingBook.genres || existingBook.genres.length === 0) &&
      enriched.genres &&
      enriched.genres.length > 0
    ) {
      newData.genres = enriched.genres;
    }
  }

  return {newData, heavyData};
}

/**
 * Throttled mapping helper with automatic exponential retry-on-failure.
 */
export async function throttledMapWithRetry<T, R>(
  items: T[],
  concurrency: number,
  taskFn: (item: T, index: number) => Promise<R>,
  retryOptions?: {
    retries?: number;
    delay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: unknown) => boolean;
  },
): Promise<R[]> {
  const retries = retryOptions?.retries ?? 3;
  const initialDelay = retryOptions?.delay ?? 1000;
  const backoffFactor = retryOptions?.backoffFactor ?? 2;
  const shouldRetry = retryOptions?.shouldRetry ?? (() => true);

  const results = new Array<R>(items.length);
  let currentIndex = 0;

  async function executeWithRetry(item: T, index: number): Promise<R> {
    let attempt = 0;
    while (true) {
      try {
        return await taskFn(item, index);
      } catch (error) {
        attempt++;
        if (attempt > retries || !shouldRetry(error)) {
          throw error;
        }
        const delayTime = initialDelay * Math.pow(backoffFactor, attempt - 1);
        console.warn(
          `[throttledMapWithRetry] Attempt ${attempt} failed for item at index ${index}. Retrying in ${delayTime}ms...`,
          error,
        );
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }
  }

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      try {
        results[index] = await executeWithRetry(item, index);
      } catch (error) {
        console.error(
          `[throttledMapWithRetry] Task failed permanently for item at index ${index}:`,
          error,
        );
        results[index] = undefined as unknown as R;
      }
    }
  }

  const workers = Array.from(
    {length: Math.min(concurrency, items.length)},
    worker,
  );
  await Promise.all(workers);
  return results;
}

export interface GenericBookInput {
  title: string;
  author: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  genres?: string[];
  genresInput?: string;
  series?: string;
  synopsis?: string;
  authorBio?: string;
  format?: 'physical' | 'digital';
}

export function normalizeBookDetails(raw: GenericBookInput): BookDetails {
  const title = normalizeTitle(raw.title || 'Unknown Title');
  const author = normalizeName(raw.author || 'Unknown Author');
  const isbn = normalizeIsbn(raw.isbn || '');

  let genres: string[] = [];
  if (raw.genresInput) {
    genres = raw.genresInput
      .split(',')
      .map(g => toSentenceCase(g.trim()))
      .filter(Boolean);
  } else if (raw.genres) {
    genres = raw.genres;
  }

  return {
    title,
    author,
    isbn: isbn && isbn !== 'NULL' ? isbn : '',
    coverUrl: raw.coverUrl || '',
    publishedDate: raw.publishedDate || '',
    genres,
    series: normalizeText(raw.series || ''),
    synopsis: normalizeText(raw.synopsis || ''),
    authorBio: normalizeText(raw.authorBio || ''),
    format: raw.format || 'physical',
  };
}

export function isDuplicateBook(
  newBook: {isbn?: string; title: string; author: string},
  existingBooks: Array<{isbn?: string; title: string; author: string}>,
): boolean {
  const cleanNewIsbn = normalizeIsbn(newBook.isbn || '');
  const cleanNewTitle = normalizeTitle(newBook.title).toLowerCase();
  const cleanNewAuthor = normalizeName(newBook.author).toLowerCase();

  return existingBooks.some(b => {
    const cleanExistingIsbn = normalizeIsbn(b.isbn || '');
    const cleanExistingTitle = normalizeTitle(b.title).toLowerCase();
    const cleanExistingAuthor = normalizeName(b.author).toLowerCase();

    const hasSameIsbn =
      cleanExistingIsbn.length >= 10 &&
      cleanNewIsbn.length >= 10 &&
      cleanExistingIsbn === cleanNewIsbn;

    const hasSameTitleAndAuthor =
      cleanExistingTitle === cleanNewTitle &&
      cleanExistingAuthor === cleanNewAuthor;

    return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
  });
}

export function filterDuplicateBooks(
  books: GenericBookInput[],
  existingBooks: Array<{isbn?: string; title: string; author: string}>,
): {unique: BookDetails[]; duplicatesFromInput: GenericBookInput[]} {
  const uniqueNormalized: BookDetails[] = [];
  const duplicatesFromInput: GenericBookInput[] = [];

  for (const book of books) {
    const normalized = normalizeBookDetails(book);
    const isDup =
      isDuplicateBook(normalized, existingBooks) ||
      isDuplicateBook(normalized, uniqueNormalized);
    if (isDup) {
      duplicatesFromInput.push(book);
    } else {
      uniqueNormalized.push(normalized);
    }
  }

  return {unique: uniqueNormalized, duplicatesFromInput};
}
