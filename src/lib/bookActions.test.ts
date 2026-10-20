import {describe, it, expect, vi, beforeEach} from 'vitest';
import {deleteBookAtomic} from './bookActions';
import {trpcVanilla} from './trpc';
import * as telemetry from './telemetry';

vi.mock('./trpc', () => ({
  trpcVanilla: {
    book: {
      delete: {
        mutate: vi.fn().mockResolvedValue({success: true}),
      },
    },
  },
}));

describe('deleteBookAtomic client action helper suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instruments the delete mutation and calls trpcVanilla.book.delete.mutate', async () => {
    const spy = vi.spyOn(telemetry, 'instrumentMutation');

    await deleteBookAtomic('lib-99', 'book-77');

    expect(spy).toHaveBeenCalledWith(
      'delete',
      'libraries/lib-99/books/book-77',
      {libraryId: 'lib-99', bookId: 'book-77', cascade: true},
      expect.any(Function),
    );
    expect(trpcVanilla.book.delete.mutate).toHaveBeenCalledWith({
      libraryId: 'lib-99',
      bookId: 'book-77',
    });
  });
});
