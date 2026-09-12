import {describe, it, expect} from 'vitest';
import {toTitleCase, formatCompactNumber} from './utils';

describe('utils', () => {
  describe('toTitleCase', () => {
    it('returns empty string for empty input', () => {
      expect(toTitleCase('')).toBe('');
    });

    it('capitalizes the first letter of each word', () => {
      expect(toTitleCase('hello world')).toBe('Hello World');
      expect(toTitleCase('HELLO WORLD')).toBe('Hello World');
      expect(toTitleCase('hELLO wORLD')).toBe('Hello World');
    });
  });

  describe('formatCompactNumber', () => {
    it('formats counts under 1,000 without suffix', () => {
      expect(formatCompactNumber(0)).toBe('0');
      expect(formatCompactNumber(12)).toBe('12');
      expect(formatCompactNumber(999)).toBe('999');
    });

    it('formats counts 1,000 and above with compact notation', () => {
      expect(formatCompactNumber(1000)).toBe('1k');
      expect(formatCompactNumber(1620)).toBe('1.6k');
      expect(formatCompactNumber(15400)).toBe('15.4k');
      expect(formatCompactNumber(1000000)).toBe('1m');
    });
  });
});
