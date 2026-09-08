import {describe, it, expect, vi} from 'vitest';
import {libraryApiRouter, bookApiRouter} from './libraryApi';
import {TRPCError} from '@trpc/server';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';

vi.mock('../../../services/server/libraryService', () => ({
  LibraryService: {
    getUserLibraries: vi.fn(),
    getFilteredBooks: vi.fn(),
    resetMetadata: vi.fn(),
  },
}));

vi.mock('../../../services/server/enrichmentService', () => ({
  EnrichmentService: {
    triggerBatchEnrichment: vi.fn(),
  },
}));

describe('libraryApiRouter & bookApiRouter Phase 5 Retirements', () => {
  const mockCtx = {
    user: {
      uid: 'user-123',
      email: SUPERADMIN_EMAIL,
    },
    isAppAllowed: true,
    isAdmin: true,
  } as any;

  it('rejects trpc.library.list with METHOD_NOT_ALLOWED', async () => {
    const caller = libraryApiRouter.createCaller(mockCtx);

    await expect(caller.list({})).rejects.toThrowError(
      expect.objectContaining({
        code: 'METHOD_NOT_ALLOWED',
        message: expect.stringContaining('retired in Phase 5'),
      }),
    );
  });

  it('rejects trpc.book.list with METHOD_NOT_ALLOWED', async () => {
    const caller = bookApiRouter.createCaller(mockCtx);

    await expect(
      caller.list({
        libraryId: 'lib-123',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'METHOD_NOT_ALLOWED',
        message: expect.stringContaining('retired in Phase 5'),
      }),
    );
  });
});
