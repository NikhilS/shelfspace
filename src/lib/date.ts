import {FirestoreDate} from '../types';

/**
 * Standardized Date and Firestore Timestamp formatting utilities.
 */

export function formatFirestoreDate(
  dateValue?: FirestoreDate | unknown,
  fallback = 'Unknown date',
): string {
  if (!dateValue) return fallback;

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
  if (!isoString) return fallback;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return fallback;
    return d.toLocaleString();
  } catch {
    return fallback;
  }
}
