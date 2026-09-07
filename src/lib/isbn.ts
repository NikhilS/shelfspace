/**
 * Standardized ISBN parsing, normalization, and validation utilities.
 */

export function normalizeIsbn(isbn?: string): string {
  if (!isbn) return '';
  return isbn.replace(/[^0-9X]/gi, '').toUpperCase();
}

export function isValidIsbn(isbn?: string): boolean {
  const clean = normalizeIsbn(isbn);
  return clean.length === 10 || clean.length === 13;
}
