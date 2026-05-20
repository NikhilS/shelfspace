import {FirestoreDate} from '../types';
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
 * Triggers haptic feedback on supported devices.
 * @param pattern Number of milliseconds to vibrate, or an array of vibration/pause/vibration sequences.
 */
export function triggerHaptics(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
