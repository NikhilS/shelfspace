import {describe, it, expect, vi} from 'vitest';
import {libraryApiRouter, bookApiRouter} from './libraryApi';
import {LibraryService} from '../../../services/server/libraryService';
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

describe('libraryApiRouter list', () => {
  const mockCtx = {
    user: {
      uid: 'user-123',
      email: SUPERADMIN_EMAIL,
    },
    isAppAllowed: true,
    isAdmin: true,
  } as any;

  it('calls LibraryService.getUserLibraries and returns libraries', async () => {
    const mockLibraries = [
      {
        id: 'lib-1',
        name: 'My Library',
        ownerId: 'user-123',
        callerRole: 'owner' as const,
      },
    ];
    vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
      libraries: mockLibraries as any,
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    const res = await caller.list({});

    expect(LibraryService.getUserLibraries).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      ['owned', 'shared'],
      true,
    );
    expect(res).toEqual({libraries: mockLibraries});
  });

  it('passes specific scopes to LibraryService.getUserLibraries', async () => {
    vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
      libraries: [],
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    await caller.list({scopes: ['all']});

    expect(LibraryService.getUserLibraries).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      ['all'],
      true,
    );
  });
});
