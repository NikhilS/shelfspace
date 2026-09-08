import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ClientBulkWriter} from './clientBulkWriter';

const mockWriteBatchSet = vi.fn();
const mockWriteBatchUpdate = vi.fn();
const mockWriteBatchDelete = vi.fn();
const mockWriteBatchCommit = vi.fn().mockResolvedValue(undefined);

const mockWriteBatch = vi.fn(() => ({
  set: mockWriteBatchSet,
  update: mockWriteBatchUpdate,
  delete: mockWriteBatchDelete,
  commit: mockWriteBatchCommit,
}));

vi.mock('firebase/firestore', () => ({
  writeBatch: () => mockWriteBatch(),
  doc: vi.fn((_db, ...parts) => ({
    path: parts.join('/'),
  })),
  increment: vi.fn((n: number) => ({_increment: n})),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
}));

describe('ClientBulkWriter - Phase 5 Atomic Counter Reconciliation', () => {
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atomically tracks book additions and applies increment in library on close()', async () => {
    const writer = new ClientBulkWriter(mockDb);

    writer.addBook(
      'lib-123',
      'book-1',
      {title: 'The Hobbit', author: 'J.R.R. Tolkien'},
      {synopsis: 'A great journey'},
    );

    expect(writer.getPendingCount()).toBe(2);

    await writer.close();

    // Verify batch commits
    expect(mockWriteBatchCommit).toHaveBeenCalled();

    // Verify core book write
    expect(mockWriteBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/books/book-1'}),
      expect.objectContaining({title: 'The Hobbit'}),
    );

    // Verify heavy details write
    expect(mockWriteBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/bookDetails/book-1'}),
      expect.objectContaining({synopsis: 'A great journey'}),
    );

    // Verify library bookCount update was batched with increment(1)
    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123'}),
      expect.objectContaining({
        bookCount: {_increment: 1},
        updatedAt: 'MOCK_TIMESTAMP',
      }),
    );
  });

  it('atomically tracks book deletions and applies decrement in library on close()', async () => {
    const writer = new ClientBulkWriter(mockDb);

    writer.deleteBook('lib-123', 'book-999');

    await writer.close();

    // Verify core book delete
    expect(mockWriteBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/books/book-999'}),
    );

    // Verify heavy details delete
    expect(mockWriteBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123/bookDetails/book-999'}),
    );

    // Verify library bookCount update was batched with increment(-1)
    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-123'}),
      expect.objectContaining({
        bookCount: {_increment: -1},
        updatedAt: 'MOCK_TIMESTAMP',
      }),
    );
  });

  it('tracks direct delete(docRef) on books collection and updates bookCount', async () => {
    const writer = new ClientBulkWriter(mockDb);

    writer.delete({path: 'libraries/lib-xyz/books/book-abc'} as any);

    await writer.close();

    expect(mockWriteBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-xyz/books/book-abc'}),
    );

    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-xyz'}),
      expect.objectContaining({
        bookCount: {_increment: -1},
      }),
    );
  });

  it('correctly aggregates multiple additions and deletions per library into net deltas', async () => {
    const writer = new ClientBulkWriter(mockDb);

    // Lib A: +3, -1 => net +2
    writer.addBook('lib-A', 'b1', {title: 'Book 1'});
    writer.addBook('lib-A', 'b2', {title: 'Book 2'});
    writer.addBook('lib-A', 'b3', {title: 'Book 3'});
    writer.deleteBook('lib-A', 'b0');

    // Lib B: +1 => net +1
    writer.addBook('lib-B', 'b10', {title: 'Book 10'});

    await writer.close();

    // Lib A got increment(2)
    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-A'}),
      expect.objectContaining({
        bookCount: {_increment: 2},
      }),
    );

    // Lib B got increment(1)
    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({path: 'libraries/lib-B'}),
      expect.objectContaining({
        bookCount: {_increment: 1},
      }),
    );
  });

  it('does not touch bookCount when autoReconcileBookCount is false', async () => {
    const writer = new ClientBulkWriter(mockDb, {
      autoReconcileBookCount: false,
    });

    writer.addBook('lib-123', 'b1', {title: 'Book'});
    writer.deleteBook('lib-123', 'b2');

    await writer.close();

    // No update on libraries/lib-123
    expect(mockWriteBatchUpdate).not.toHaveBeenCalled();
  });

  it('flushes in chunks according to batchSize', async () => {
    const writer = new ClientBulkWriter(mockDb, {
      batchSize: 2,
      autoReconcileBookCount: false,
    });

    writer.set({path: 'doc/1'} as any, {a: 1});
    writer.set({path: 'doc/2'} as any, {a: 2});
    expect(mockWriteBatchCommit).toHaveBeenCalledTimes(1);

    writer.set({path: 'doc/3'} as any, {a: 3});
    await writer.close();
    expect(mockWriteBatchCommit).toHaveBeenCalledTimes(2);
  });
});
