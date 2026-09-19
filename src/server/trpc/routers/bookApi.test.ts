import {describe, it, expect, vi, beforeEach} from 'vitest';
import {bookApiRouter} from './libraryApi';
import {BookService} from '../../../services/server/bookService';
import {PermissionService} from '../../auth/permissions';
import {TRPCError} from '@trpc/server';

vi.mock('../../../services/server/bookService', () => ({
  BookService: {
    createBook: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
    batchUpsert: vi.fn(),
    getBook: vi.fn(),
    listBooks: vi.fn(),
  },
}));

vi.mock('../../auth/permissions', () => ({
  PermissionService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

describe('bookApiRouter - Phase 2 Unified Write Procedures', () => {
  const mockUserCtx = {
    user: {
      uid: 'user-456',
      email: 'editor@example.com',
      authType: 'jwt',
    },
    isAppAllowed: true,
    isAdmin: false,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create mutation', () => {
    it('authorizes editor and calls BookService.createBook', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'editor',
        userId: 'user-456',
      });
      vi.mocked(BookService.createBook).mockResolvedValueOnce({
        success: true,
        id: 'book-new-1',
      });

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.create({
        libraryId: 'lib-1',
        title: 'Neuromancer',
        author: 'William Gibson',
      });

      expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
        mockUserCtx.user,
        'lib-1',
        'editor',
      );
      expect(BookService.createBook).toHaveBeenCalledWith('user-456', {
        libraryId: 'lib-1',
        title: 'Neuromancer',
        author: 'William Gibson',
        format: 'physical',
      });
      expect(res).toEqual({success: true, id: 'book-new-1'});
    });

    it('denies user if PermissionService throws FORBIDDEN', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockRejectedValueOnce(
        new TRPCError({
          code: 'FORBIDDEN',
          message: 'Insufficient library permissions',
        }),
      );

      const caller = bookApiRouter.createCaller(mockUserCtx);
      await expect(
        caller.create({
          libraryId: 'lib-1',
          title: 'Forbidden Book',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        }),
      );
    });
  });

  describe('update mutation', () => {
    it('authorizes editor and calls BookService.updateBook', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'owner',
        userId: 'user-456',
      });
      vi.mocked(BookService.updateBook).mockResolvedValueOnce({
        success: true,
      });

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.update({
        libraryId: 'lib-1',
        bookId: 'book-1',
        updates: {title: 'Neuromancer (2nd Edition)'},
      });

      expect(BookService.updateBook).toHaveBeenCalledWith('user-456', {
        libraryId: 'lib-1',
        bookId: 'book-1',
        updates: {title: 'Neuromancer (2nd Edition)'},
      });
      expect(res).toEqual({success: true});
    });
  });

  describe('delete mutation', () => {
    it('authorizes editor and calls BookService.deleteBook', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'editor',
        userId: 'user-456',
      });
      vi.mocked(BookService.deleteBook).mockResolvedValueOnce({
        success: true,
      });

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.delete({
        libraryId: 'lib-1',
        bookId: 'book-1',
      });

      expect(BookService.deleteBook).toHaveBeenCalledWith('user-456', {
        libraryId: 'lib-1',
        bookId: 'book-1',
      });
      expect(res).toEqual({success: true});
    });
  });

  describe('batchUpsert mutation', () => {
    it('authorizes editor and passes batch operations to BookService.batchUpsert', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'editor',
        userId: 'user-456',
      });
      vi.mocked(BookService.batchUpsert).mockResolvedValueOnce({
        success: true,
        count: 2,
        added: 2,
        updated: 0,
        deleted: 0,
      });

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.batchUpsert({
        libraryId: 'lib-1',
        operations: [
          {type: 'create', bookId: 'b-1', data: {title: 'Book 1'}},
          {type: 'create', bookId: 'b-2', data: {title: 'Book 2'}},
        ],
      });

      expect(BookService.batchUpsert).toHaveBeenCalledWith('user-456', {
        libraryId: 'lib-1',
        operations: [
          {type: 'create', bookId: 'b-1', data: {title: 'Book 1'}},
          {type: 'create', bookId: 'b-2', data: {title: 'Book 2'}},
        ],
      });
      expect(res.count).toBe(2);
    });
  });

  describe('get query', () => {
    it('authorizes viewer and calls BookService.getBook', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'viewer',
        userId: 'user-456',
      });
      vi.mocked(BookService.getBook).mockResolvedValueOnce({
        id: 'b-1',
        title: 'Snow Crash',
        author: 'Neal Stephenson',
      } as any);

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.get({
        libraryId: 'lib-1',
        bookId: 'b-1',
      });

      expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
        mockUserCtx.user,
        'lib-1',
        'viewer',
      );
      expect(res.title).toBe('Snow Crash');
    });
  });

  describe('list query', () => {
    it('authorizes viewer and calls BookService.listBooks', async () => {
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
        role: 'viewer',
        userId: 'user-456',
      });
      vi.mocked(BookService.listBooks).mockResolvedValueOnce({
        books: [
          {id: 'b-1', title: 'Neuromancer'},
          {id: 'b-2', title: 'Count Zero'},
        ],
      });

      const caller = bookApiRouter.createCaller(mockUserCtx);
      const res = await caller.list({
        libraryId: 'lib-1',
      });

      expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
        mockUserCtx.user,
        'lib-1',
        'viewer',
      );
      expect(BookService.listBooks).toHaveBeenCalledWith('user-456', 'lib-1', {
        libraryId: 'lib-1',
        limit: 1000,
      });
      expect(res.books).toHaveLength(2);
    });
  });
});
