import {describe, it, expect} from 'vitest';
import {
  BOOK_TAXONOMY,
  getCanonicalPrimaryGenres,
  getSubgenresFor,
  bookGenreSchema,
  sanitizeGenrePayload,
  mapLegacyGenreToTaxonomy,
} from './taxonomy';

describe('BOOK_TAXONOMY', () => {
  it('contains exactly 18 canonical genres plus Other', () => {
    const canonical = getCanonicalPrimaryGenres();
    expect(canonical.length).toBe(18);
    expect(canonical).toContain('Humor & Satire');
    expect(canonical).toContain('Literary & Classic Fiction');
    expect(canonical).toContain('Travel & Exploration');
    expect(canonical).toContain('Science Fiction');
  });

  it('provides subgenres for canonical genres', () => {
    const humorSubs = getSubgenresFor('Humor & Satire');
    expect(humorSubs).toContain('Farce & Comic Fiction');
    expect(humorSubs).toContain('British Humor');

    const litSubs = getSubgenresFor('Literary & Classic Fiction');
    expect(litSubs).toContain('Postmodern & Experimental');
    expect(litSubs).toContain('Metafiction');
  });

  it('returns empty array for invalid or other genres', () => {
    expect(getSubgenresFor('Other')).toEqual([]);
    expect(getSubgenresFor('NonExistentGenre')).toEqual([]);
  });
});

describe('bookGenreSchema validation', () => {
  it('validates a valid primary genre without subgenres (subgenres optional)', () => {
    const result = bookGenreSchema.safeParse({
      primaryGenre: 'Humor & Satire',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryGenre).toBe('Humor & Satire');
      expect(result.data.subgenres).toEqual([]);
    }
  });

  it('validates valid subgenres matching the canonical primary genre', () => {
    const result = bookGenreSchema.safeParse({
      primaryGenre: 'Humor & Satire',
      subgenres: ['Farce & Comic Fiction', 'British Humor'],
    });
    expect(result.success).toBe(true);
  });

  it('fails if a subgenre does not match the canonical primary genre', () => {
    const result = bookGenreSchema.safeParse({
      primaryGenre: 'Science Fiction',
      subgenres: ['Cozy Mystery'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'not a valid subgenre for "Science Fiction"',
      );
    }
  });

  it('fails if more than 3 subgenres are provided', () => {
    const result = bookGenreSchema.safeParse({
      primaryGenre: 'Science Fiction',
      subgenres: ['Hard Sci-Fi', 'Space Opera', 'Cyberpunk', 'Time Travel'],
    });
    expect(result.success).toBe(false);
  });

  it('allows custom subgenres if isCustomPrimary is true', () => {
    const result = bookGenreSchema.safeParse({
      primaryGenre: 'Cyberpunk Noir',
      subgenres: ['High Tech', 'Low Life'],
      isCustomPrimary: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('sanitizeGenrePayload', () => {
  it('strips mismatched subgenres and retains valid subgenres', () => {
    const sanitized = sanitizeGenrePayload({
      primaryGenre: 'Science Fiction',
      subgenres: ['Space Opera', 'Cozy Mystery', 'Cyberpunk'],
    });
    expect(sanitized.primaryGenre).toBe('Science Fiction');
    expect(sanitized.subgenres).toEqual(['Space Opera', 'Cyberpunk']);
    expect(sanitized.isCustomPrimary).toBe(false);
  });

  it('caps subgenres at 3', () => {
    const sanitized = sanitizeGenrePayload({
      primaryGenre: 'Science Fiction',
      subgenres: [
        'Space Opera',
        'Cyberpunk',
        'Time Travel',
        'Solarpunk & Climate Fiction',
      ],
    });
    expect(sanitized.subgenres.length).toBe(3);
  });

  it('handles empty or missing primary genre gracefully', () => {
    const sanitized = sanitizeGenrePayload({});
    expect(sanitized.primaryGenre).toBe('Other');
    expect(sanitized.isCustomPrimary).toBe(true);
  });
});

describe('mapLegacyGenreToTaxonomy', () => {
  it('maps sci-fi and space opera strings correctly', () => {
    const mapped = mapLegacyGenreToTaxonomy(
      'FICTION / Science Fiction / Space Opera',
    );
    expect(mapped.primaryGenre).toBe('Science Fiction');
    expect(mapped.subgenres).toContain('Space Opera');
  });

  it('maps mystery and cozy correctly', () => {
    const mapped = mapLegacyGenreToTaxonomy('Cozy Mystery / Cats');
    expect(mapped.primaryGenre).toBe('Mystery & Crime');
    expect(mapped.subgenres).toContain('Cozy Mystery');
  });

  it('maps unmatchable strings to custom genre', () => {
    const mapped = mapLegacyGenreToTaxonomy('Afrofuturism');
    expect(mapped.primaryGenre).toBe('Afrofuturism');
    expect(mapped.isCustomPrimary).toBe(true);
  });

  it('maps historical fiction BISAC strings', () => {
    const mapped = mapLegacyGenreToTaxonomy(
      'FICTION / Historical / World War II',
    );
    expect(mapped.primaryGenre).toBe('Historical Fiction');
  });

  it('handles array of legacy genre strings', () => {
    const mapped = mapLegacyGenreToTaxonomy([
      'Computers / Artificial Intelligence',
      'Science Fiction',
      'Cyberpunk',
    ]);
    expect(mapped.primaryGenre).toBe('Science Fiction');
    expect(mapped.subgenres).toContain('Cyberpunk');
    expect(mapped.isCustomPrimary).toBe(false);
  });

  it('handles empty input gracefully', () => {
    const mapped = mapLegacyGenreToTaxonomy([]);
    expect(mapped.primaryGenre).toBe('Other');
    expect(mapped.isCustomPrimary).toBe(true);
  });
});
