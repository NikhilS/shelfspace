import {describe, it, expect} from 'vitest';
import {formatFirestoreDate, formatDateTime} from './date';

describe('Date utilities', () => {
  it('formats Firestore toDate object correctly', () => {
    const fakeTimestamp = {
      toDate: () => new Date('2026-03-15T12:00:00.000Z'),
    };
    expect(formatFirestoreDate(fakeTimestamp)).toBe(
      new Date('2026-03-15T12:00:00.000Z').toLocaleDateString(),
    );
  });

  it('formats Firestore seconds object correctly', () => {
    const fakeSeconds = {
      seconds: 1742040000,
    };
    expect(formatFirestoreDate(fakeSeconds)).toBe(
      new Date(1742040000 * 1000).toLocaleDateString(),
    );
  });

  it('falls back to default fallback if date is missing or invalid', () => {
    expect(formatFirestoreDate(null)).toBe('Unknown date');
    expect(formatFirestoreDate(undefined, 'N/A')).toBe('N/A');
    expect(formatFirestoreDate('invalid-date-string')).toBe('Unknown date');
  });

  it('formats ISO dateTime strings and falls back gracefully', () => {
    const iso = '2026-05-20T14:30:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatDateTime(null)).toBe('Never');
    expect(formatDateTime('', 'No Record')).toBe('No Record');
    expect(formatDateTime('invalid-date')).toBe('Never');
  });
});
