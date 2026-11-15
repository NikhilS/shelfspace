import {describe, expect, it} from 'vitest';
import {
  storedBookDetailsDocSchema,
  storedBookDocSchema,
} from '../../../schemas/book';
import {validateFirestoreWritePayload} from '../../../schemas/common';
import {
  applyNonDestructiveBonusCatalogPatch,
  extractBonusCatalogFields,
  mergeBonusCatalogFields,
} from './bonusCatalogPatcher';

describe('bonusCatalogPatcher', () => {
  it('extracts valid bonus catalog fields while respecting disallowSeries and safe URL rules', () => {
    const extracted = extractBonusCatalogFields(
      {
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        isbn: '9780441478125',
        coverUrl: 'https://covers.example.com/lhod.jpg',
        publishedDate: '1969-03-01',
        series: 'Hainish Cycle #4',
        synopsis:
          'A human envoy visits the winter world of Gethen to invite its nations into an interstellar coalition.',
        sources: ['Apple Books'],
      },
      {disallowSeries: true},
    );

    expect(extracted).toEqual({
      isbn: '9780441478125',
      coverUrl: 'https://covers.example.com/lhod.jpg',
      publishedDate: '1969-03-01',
      synopsis:
        'A human envoy visits the winter world of Gethen to invite its nations into an interstellar coalition.',
      winningProvider: 'Apple Books',
    });
  });

  it('merges bonus catalog fields across pipeline stages without losing earlier hits', () => {
    const merged = mergeBonusCatalogFields(
      {
        isbn: '9780441478125',
        coverUrl: 'https://covers.example.com/lhod.jpg',
        winningProvider: 'Google Books',
      },
      {
        synopsis:
          'A human envoy visits the winter world of Gethen to invite its nations into an interstellar coalition.',
      },
    );

    expect(merged).toEqual({
      isbn: '9780441478125',
      coverUrl: 'https://covers.example.com/lhod.jpg',
      publishedDate: undefined,
      series: undefined,
      synopsis:
        'A human envoy visits the winter world of Gethen to invite its nations into an interstellar coalition.',
      winningProvider: 'Google Books',
    });
  });

  it('applies missing bonus fields non-destructively and passes strict StoredBookDoc & StoredBookDetailsDoc validation', () => {
    const nowIso = '2026-11-15T12:00:00.000Z';
    const rawDoc: Record<string, unknown> = {
      id: 'book-1',
      title: 'Dune',
      author: 'Frank Herbert',
      coverUrl: 'https://existing.example.com/dune.jpg',
      enrichmentStatus: {
        coverImage: 'completed',
      },
      bookDetailsMetadata: {
        hasSynopsis: false,
      },
    };

    const {patch, bonusUpdatedFields} = applyNonDestructiveBonusCatalogPatch({
      rawDoc,
      book: {
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
      },
      primaryStatusKey: 'genre',
      patch: {
        bookUpdate: {
          primaryGenre: 'Science Fiction',
          subgenres: ['Space Opera'],
          isCustomPrimary: false,
          enrichmentStatus: {
            coverImage: 'completed',
            genre: 'completed',
          },
        },
        resultPreview: {
          id: 'book-1',
          primaryGenre: 'Science Fiction',
          subgenres: ['Space Opera'],
          isCustomPrimary: false,
        },
      },
      bonusCatalog: {
        coverUrl: 'https://new-cover.example.com/should-not-overwrite.jpg',
        isbn: '978-0-441-17271-9',
        publishedDate: '1965-08-01',
        series: 'Dune Chronicles #1',
        synopsis:
          'Paul Atreides navigates desert ecology and imperial intrigue on Arrakis.',
      },
      existingStatus: {
        coverImage: 'completed',
      },
      existingDetailsMeta: {
        hasSynopsis: false,
      },
      nowIso,
    });

    // Existing coverUrl was preserved; missing isbn, publishedDate, series, and synopsis were added
    expect(bonusUpdatedFields).toEqual([
      'isbn',
      'publishedDate',
      'series',
      'synopsis',
    ]);
    expect(patch.bookUpdate.coverUrl).toBeUndefined();
    expect(patch.bookUpdate.isbn).toBe('978-0-441-17271-9');
    expect(patch.bookUpdate.cleanIsbn).toBe('9780441172719');
    expect(patch.bookUpdate.publishedDate).toBe('1965-08-01');
    expect(patch.bookUpdate.series).toBe('Dune Chronicles #1');
    expect(Array.isArray(patch.bookUpdate.searchTokens)).toBe(true);
    expect(patch.bookUpdate.searchTokens).toContain('9780441172719');
    expect(patch.bookUpdate.enrichmentStatus).toEqual({
      coverImage: 'completed',
      genre: 'completed',
      series: 'completed',
      synopsis: 'completed',
    });
    expect(patch.detailsUpdate).toEqual({
      synopsis:
        'Paul Atreides navigates desert ecology and imperial intrigue on Arrakis.',
      updatedAt: nowIso,
    });

    const bookValidation = validateFirestoreWritePayload(
      storedBookDocSchema.partial(),
      patch.bookUpdate,
      {
        entity: 'StoredBookDoc',
        documentPath: 'libraries/lib-1/books/book-1',
        operation: 'update',
      },
    );
    expect(bookValidation.success).toBe(true);

    const detailsValidation = validateFirestoreWritePayload(
      storedBookDetailsDocSchema.partial(),
      patch.detailsUpdate!,
      {
        entity: 'StoredBookDetailsDoc',
        documentPath: 'libraries/lib-1/bookDetails/book-1',
        operation: 'update',
      },
    );
    expect(detailsValidation.success).toBe(true);
  });

  it('never writes bonus series when series was gated as standalone unsupported', () => {
    const {patch, bonusUpdatedFields} = applyNonDestructiveBonusCatalogPatch({
      rawDoc: {
        id: 'book-2',
        title: ' Piranesi ',
        author: 'Susanna Clarke',
      },
      book: {
        id: 'book-2',
        title: 'Piranesi',
        author: 'Susanna Clarke',
      },
      primaryStatusKey: 'genre',
      patch: {
        bookUpdate: {
          primaryGenre: 'Fantasy',
          enrichmentStatus: {
            genre: 'completed',
            series: 'unsupported',
          },
        },
        resultPreview: {
          id: 'book-2',
          primaryGenre: 'Fantasy',
        },
      },
      bonusCatalog: {
        series: 'Bloomsbury Modern Classics',
      },
      existingStatus: {
        series: 'unsupported',
      },
      existingDetailsMeta: {},
      nowIso: '2026-11-15T12:00:00.000Z',
    });

    expect(bonusUpdatedFields).toEqual([]);
    expect(patch.bookUpdate.series).toBeUndefined();
  });
});
