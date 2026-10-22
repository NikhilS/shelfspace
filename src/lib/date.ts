import {FirestoreDate} from '../types';

/**
 * Standardized Date and Firestore Timestamp formatting utilities.
 * Powered by cached native Intl.DateTimeFormat instances.
 */

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const fullDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export function formatFirestoreDate(
  dateValue?: FirestoreDate | unknown,
  fallback = 'Unknown date',
): string {
  if (!dateValue) {
    return fallback;
  }

  const asRecord = dateValue as Record<string, unknown>;
  if (typeof asRecord.toDate === 'function') {
    return (asRecord.toDate as () => Date)().toLocaleDateString();
  }
  if (typeof asRecord.seconds === 'number') {
    return new Date(asRecord.seconds * 1000).toLocaleDateString();
  }

  const dateObj = new Date(dateValue as string | number);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toLocaleDateString();
  }

  return fallback;
}

export function formatDateTime(
  isoString?: string | number | Date | null,
  fallback = 'Never',
): string {
  if (!isoString) {
    return fallback;
  }
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      return fallback;
    }
    return d.toLocaleString();
  } catch {
    return fallback;
  }
}

/**
 * Formats a Date or timestamp as "MMM d, yyyy" (e.g., "Oct 17, 2026").
 */
export function formatShortDate(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return 'Unknown';
  }
  return shortDateFormatter.format(d);
}

/**
 * Formats a Date or timestamp as "PPpp" equivalent (e.g., "Oct 17, 2026, 4:30:00 PM").
 */
export function formatFullDateTime(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return fullDateTimeFormatter.format(d);
}
