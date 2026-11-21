import {describe, expect, it} from 'vitest';
import {SchemaValidationError} from '../../../schemas/common';
import {createFakeFirestore} from '../../testing/fakeFirestore';
import {
  bookTombstoneConverter,
  clearBookTombstoneInBatch,
  queryDeletedBookIdsSince,
  stageBookTombstoneInBatch,
} from './bookTombstoneLedger';

describe('bookTombstoneLedger (src/server/services/book/bookTombstoneLedger.ts)', () => {
  it('stages, queries, and clears persistent delete tombstones across batches', async () => {
    const {db} = createFakeFirestore();
    const libRef = db.collection('libraries').doc('lib-1');

    const batch1 = db.batch();
    stageBookTombstoneInBatch(batch1, libRef, 'lib-1', 'book-old', {
      deletedAtMs: 1_000,
      deletedBy: 'user-1',
    });
    stageBookTombstoneInBatch(batch1, libRef, 'lib-1', 'book-recent', {
      deletedAtMs: 5_000,
      deletedBy: 'user-1',
    });
    await batch1.commit();

    const deletedSince3000 = await queryDeletedBookIdsSince(
      libRef,
      'lib-1',
      3_000,
    );
    expect(deletedSince3000).toEqual(['book-recent']);

    const batch2 = db.batch();
    clearBookTombstoneInBatch(batch2, libRef, 'book-recent');
    await batch2.commit();

    const afterRecreate = await queryDeletedBookIdsSince(
      libRef,
      'lib-1',
      3_000,
    );
    expect(afterRecreate).toEqual([]);
  });

  it('rejects malformed or polluted tombstone documents via strict converter', () => {
    expect(() =>
      bookTombstoneConverter.fromFirestore('lib-1', 'book-1', {
        bookId: 'book-1',
        deletedAtMs: 5_000,
        unexpectedField: 'drift',
      }),
    ).toThrow(SchemaValidationError);
  });
});
