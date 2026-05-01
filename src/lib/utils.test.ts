import {describe, it, expect} from 'vitest';
import {toTitleCase} from './utils';

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
});
