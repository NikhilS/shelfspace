import { describe, it, expect } from 'vitest';
import { toSentenceCase, toTitleCase, cn } from './utils';

describe('utils', () => {
  describe('toSentenceCase', () => {
    it('returns empty string for empty input', () => {
      expect(toSentenceCase('')).toBe('');
    });

    it('capitalizes the first letter and lowercases the rest', () => {
      expect(toSentenceCase('HELLO WORLD')).toBe('Hello world');
      expect(toSentenceCase('hello world')).toBe('Hello world');
      expect(toSentenceCase('hELLO')).toBe('Hello');
    });
  });

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

  describe('cn', () => {
    it('merges tailwind classes correctly', () => {
      expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
      expect(cn('px-2 py-1', 'p-4')).toBe('p-4'); // twMerge resolves conflicts
      expect(cn('px-2', false && 'py-1', 'text-sm')).toBe('px-2 text-sm'); // clsx handles conditional logic
    });
  });
});
