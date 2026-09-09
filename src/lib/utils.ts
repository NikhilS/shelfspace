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

export function normalizeName(name?: string): string {
  if (!name) return '';
  return toTitleCase(name.trim());
}

export function normalizeTitle(title?: string): string {
  if (!title) return '';
  return title.trim();
}

import {normalizeIsbn} from './isbn';
export {normalizeIsbn};

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
 * Triggers haptic feedback on supported devices.
 */
export function triggerHaptics(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

export interface GenericBookInput {
  title: string;
  author: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  series?: string;
  synopsis?: string;
  authorBio?: string;
  format?: 'physical' | 'digital';
}

export function normalizeBookDetails(raw: GenericBookInput): BookDetails {
  const title = normalizeTitle(raw.title || 'Unknown Title');
  const author = normalizeName(raw.author || 'Unknown Author');
  const isbn = normalizeIsbn(raw.isbn || '');

  return {
    title,
    author,
    isbn: isbn && isbn !== 'NULL' ? isbn : '',
    coverUrl: raw.coverUrl || '',
    publishedDate: raw.publishedDate || '',
    primaryGenre: raw.primaryGenre || undefined,
    subgenres: raw.subgenres || [],
    isCustomPrimary: raw.isCustomPrimary || false,
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
