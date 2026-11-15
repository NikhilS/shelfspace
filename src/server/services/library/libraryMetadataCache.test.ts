import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {StoredLibraryDoc} from '../../../schemas/libraryApi';
import {LibraryMetadataCache} from './libraryMetadataCache';

function makeDoc(
  id: string,
  overrides?: Partial<StoredLibraryDoc>,
): StoredLibraryDoc {
  return {
    id,
    name: `Library ${id}`,
    ownerId: 'owner-1',
    access: {'reader@example.com': 'viewer'},
    bookCount: 10,
    ...overrides,
  };
}

describe('LibraryMetadataCache', () => {
  beforeEach(() => {
    LibraryMetadataCache.clear();
    LibraryMetadataCache.setEnabledForTests(true);
  });

  afterEach(() => {
    LibraryMetadataCache.clear();
    LibraryMetadataCache.setEnabledForTests(null);
  });

  it('caches and clones library documents until TTL expiry', () => {
    const doc = makeDoc('lib-1');
    LibraryMetadataCache.set('lib-1', doc, 60_000);

    const hit = LibraryMetadataCache.get('lib-1');
    expect(hit).toEqual(doc);

    if (hit?.access) {
      hit.access['mutated@example.com'] = 'editor';
    }
    expect(LibraryMetadataCache.get('lib-1')?.access).toEqual({
      'reader@example.com': 'viewer',
    });
  });

  it('evicts expired entries on read', () => {
    LibraryMetadataCache.set('lib-expired', makeDoc('lib-expired'), -10);
    expect(LibraryMetadataCache.get('lib-expired')).toBeUndefined();
  });

  it('supports write-through invalidation and bookCount delta adjustments', () => {
    LibraryMetadataCache.set('lib-count', makeDoc('lib-count', {bookCount: 4}));
    LibraryMetadataCache.adjustBookCount('lib-count', 2);
    expect(LibraryMetadataCache.get('lib-count')?.bookCount).toBe(6);

    LibraryMetadataCache.adjustBookCount('lib-count', -10);
    expect(LibraryMetadataCache.get('lib-count')?.bookCount).toBe(0);

    LibraryMetadataCache.invalidate('lib-count');
    expect(LibraryMetadataCache.get('lib-count')).toBeUndefined();
  });

  it('records and queries recent deleted book tombstones by timestamp', () => {
    LibraryMetadataCache.recordDeletedBooks(
      'lib-del',
      ['b-1', 'b-2'],
      1_000_000,
    );
    LibraryMetadataCache.recordDeletedBooks('lib-del', ['b-3'], 2_000_000);

    // Relative to Date.now() within 24h window: use current timestamps
    const baseNow = Date.now();
    LibraryMetadataCache.clear();
    LibraryMetadataCache.recordDeletedBooks(
      'lib-del',
      ['b-old'],
      baseNow - 5000,
    );
    LibraryMetadataCache.recordDeletedBooks(
      'lib-del',
      ['b-new'],
      baseNow - 1000,
    );

    expect(
      LibraryMetadataCache.getDeletedBookIdsSince('lib-del', baseNow - 2500),
    ).toEqual(['b-new']);
    expect(
      LibraryMetadataCache.getDeletedBookIdsSince('lib-del', baseNow - 6000),
    ).toEqual(['b-old', 'b-new']);
  });
});
