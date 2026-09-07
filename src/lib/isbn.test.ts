import {describe, it, expect} from 'vitest';
import {normalizeIsbn, isValidIsbn} from './isbn';

describe('ISBN utilities', () => {
  it('normalizes ISBN strings by removing dashes, spaces, and lowercasing X', () => {
    expect(normalizeIsbn('978-3-16-148410-0')).toBe('9783161484100');
    expect(normalizeIsbn('0-19-852663-x')).toBe('019852663X');
    expect(normalizeIsbn('  978 0 201 63361 0 ')).toBe('9780201633610');
    expect(normalizeIsbn(undefined)).toBe('');
    expect(normalizeIsbn('')).toBe('');
  });

  it('validates 10- and 13-digit ISBN lengths accurately', () => {
    expect(isValidIsbn('978-3-16-148410-0')).toBe(true);
    expect(isValidIsbn('0-19-852663-X')).toBe(true);
    expect(isValidIsbn('12345')).toBe(false);
    expect(isValidIsbn('')).toBe(false);
    expect(isValidIsbn(undefined)).toBe(false);
  });
});
