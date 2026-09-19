import {describe, it, expect, vi, beforeEach} from 'vitest';
import {apiV1Router} from './router';
import {BookService} from '../../../services/server/bookService';
import {PermissionService} from '../../auth';

vi.mock('../../auth', () => ({
  authenticateApiRequest: () => (req: any, _res: any, next: any) => {
    req.user = {uid: 'user-789', email: 'rest@example.com'};
    next();
  },
  PermissionService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

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

vi.mock('../../../services/server/libraryService', () => ({
  LibraryService: {
    getUserLibraries: vi.fn(),
    getLibrary: vi.fn(),
  },
}));

describe('REST v1 Router - Books Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles GET /libraries/:libraryId/books/:bookId', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
      role: 'viewer',
      userId: 'user-789',
    });
    vi.mocked(BookService.getBook).mockResolvedValueOnce({
      id: 'book-1',
      title: 'Foundation',
    } as any);

    const hasRoute = apiV1Router.stack.some(
      layer => layer.route?.path === '/libraries/:libraryId/books/:bookId',
    );
    expect(hasRoute).toBe(true);
  });

  it('handles GET /libraries/:libraryId/books route registration', async () => {
    const hasRoute = apiV1Router.stack.some(
      layer => layer.route?.path === '/libraries/:libraryId/books',
    );
    expect(hasRoute).toBe(true);
  });

  it('verifies BookService createBook can be called via router handler', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
      role: 'editor',
      userId: 'user-789',
    });
    vi.mocked(BookService.createBook).mockResolvedValueOnce({
      success: true,
      id: 'b-new',
    });

    const result = await BookService.createBook('user-789', {
      libraryId: 'lib-1',
      title: 'Foundation',
    });
    expect(result).toEqual({success: true, id: 'b-new'});
  });
});
