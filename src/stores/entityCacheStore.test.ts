import {beforeEach, describe, expect, it} from 'vitest';
import {
  makeEntityBookKey,
  selectBookWithOverlay,
  selectLibraryBooks,
  useEntityCacheStore,
} from './entityCacheStore';
import type {Book} from '../types';

describe('entityCacheStore', () => {
  beforeEach(() => {
    useEntityCacheStore.getState().clearAllEntities();
  });

  it('hydrates library books, patches canonical reading states, and guards out-of-order rollbacks via version tokens', () => {
    const sampleBook: Book = {
      id: 'book-1',
      libraryId: 'lib-1',
      title: 'Piranesi',
      author: 'Susanna Clarke',
      isbn: '978-1635575637',
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
      readingStatus: 'unset',
    };

    useEntityCacheStore.getState().hydrateLibraryBooks('lib-1', [sampleBook]);
    expect(
      selectLibraryBooks(useEntityCacheStore.getState(), 'lib-1'),
    ).toHaveLength(1);

    // 1. First optimistic patch: unset -> reading (version 1)
    const patch1 = useEntityCacheStore.getState().patchReadingState({
      libraryId: 'lib-1',
      bookId: 'book-1',
      status: 'reading',
      isOptimistic: true,
    });

    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-1')
        ?.readingStatus,
    ).toBe('reading');
    expect(
      useEntityCacheStore.getState().readingStatesByBookKey['book:lib-1:book-1']
        ?.status,
    ).toBe('reading');

    // 2. Stale background hydration must NOT clobber active optimistic reading state
    useEntityCacheStore.getState().hydrateLibraryBooks('lib-1', [sampleBook]);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-1')
        ?.readingStatus,
    ).toBe('reading');

    // 3. Newer authoritative mutation commits finished (version 2)
    useEntityCacheStore.getState().patchReadingState({
      libraryId: 'lib-1',
      bookId: 'book-1',
      status: 'finished',
      rating: 5,
      isOptimistic: false,
    });

    // 4. Stale rollback from patch1 (version 1) must be ignored because version advanced
    const rolledBackStale = useEntityCacheStore
      .getState()
      .rollbackEntitySnapshot(patch1.snapshot, patch1.version);
    expect(rolledBackStale).toBe(false);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-1')
        ?.readingStatus,
    ).toBe('finished');
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-1')
        ?.userRating,
    ).toBe(5);
  });

  it('upserts book deltas, stores reviews, removes deleted books, and clears all entities on sign-out', () => {
    useEntityCacheStore.getState().upsertLibrary({
      id: 'lib-1',
      name: 'Home Study',
      ownerId: 'u1',
      ownerName: 'Reader',
      createdAt: '2026-01-01T00:00:00.000Z',
      bookCount: 0,
    });

    useEntityCacheStore
      .getState()
      .upsertBooksDelta(
        'lib-1',
        [{id: 'b-10', title: 'Exhalation', author: 'Ted Chiang'}],
        {bookCountDelta: 1},
      );

    expect(
      useEntityCacheStore.getState().librariesById['lib-1']?.bookCount,
    ).toBe(1);
    expect(
      useEntityCacheStore.getState().booksByKey[
        makeEntityBookKey('lib-1', 'b-10')
      ]?.title,
    ).toBe('Exhalation');

    useEntityCacheStore.getState().upsertBookReview('lib-1', 'b-10', {
      id: 'u1',
      userId: 'u1',
      userName: 'Reader',
      rating: 5,
      text: 'Luminous.',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    expect(
      useEntityCacheStore.getState().booksByKey[
        makeEntityBookKey('lib-1', 'b-10')
      ]?.userRating,
    ).toBe(5);

    useEntityCacheStore
      .getState()
      .removeBooks('lib-1', ['b-10'], {bookCountDelta: -1});
    expect(
      useEntityCacheStore.getState().librariesById['lib-1']?.bookCount,
    ).toBe(0);
    expect(selectLibraryBooks(useEntityCacheStore.getState(), 'lib-1')).toEqual(
      [],
    );

    useEntityCacheStore.getState().clearAllEntities();
    expect(useEntityCacheStore.getState().librariesById).toEqual({});
  });

  it('patches book fields optimistically with version-guarded rollback and clears enrichment fields', () => {
    const sampleBook: Book = {
      id: 'b-edit',
      libraryId: 'lib-1',
      title: 'Original Title',
      author: 'Original Author',
      primaryGenre: 'Fantasy',
      subgenres: ['Mythic'],
      synopsis: 'Saved summary.',
      bookDetailsMetadata: {
        hasSynopsis: true,
        hasAuthorBio: false,
        hasEmbedding: false,
      },
      enrichmentStatus: {
        genre: 'completed',
        synopsis: 'completed',
      },
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
    };

    useEntityCacheStore.getState().hydrateLibraryBooks('lib-1', [sampleBook]);

    const patch1 = useEntityCacheStore
      .getState()
      .patchBookOptimistically('lib-1', 'b-edit', {
        title: 'Optimistic Draft Title',
        readingStatus: 'reading',
      });

    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'b-edit')
        ?.title,
    ).toBe('Optimistic Draft Title');
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'b-edit')
        ?.readingStatus,
    ).toBe('reading');

    // Supersede with authoritative upsert
    useEntityCacheStore
      .getState()
      .upsertBooksDelta('lib-1', [{id: 'b-edit', title: 'Server Title'}]);

    // Stale rollback from patch1 must be rejected
    expect(
      useEntityCacheStore
        .getState()
        .rollbackEntitySnapshot(patch1.snapshot, patch1.version),
    ).toBe(false);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'b-edit')
        ?.title,
    ).toBe('Server Title');

    // Clear enrichment fields for genre and synopsis
    useEntityCacheStore
      .getState()
      .clearLibraryEnrichmentField('lib-1', 'genre');
    useEntityCacheStore
      .getState()
      .clearLibraryEnrichmentField('lib-1', 'synopsis');

    const cleared = selectBookWithOverlay(
      useEntityCacheStore.getState(),
      'lib-1',
      'b-edit',
    );
    expect(cleared?.primaryGenre).toBeUndefined();
    expect(cleared?.subgenres).toEqual([]);
    expect(cleared?.enrichmentStatus?.genre).toBeUndefined();
    expect(cleared?.synopsis).toBeUndefined();
    expect(cleared?.bookDetailsMetadata?.hasSynopsis).toBe(false);
    expect(cleared?.enrichmentStatus?.synopsis).toBeUndefined();
  });
});
