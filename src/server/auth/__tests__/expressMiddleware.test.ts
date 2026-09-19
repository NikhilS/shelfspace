import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  authenticateApiRequest,
  requireAdminMiddleware,
  requireLibraryRoleMiddleware,
} from '../expressMiddleware';
import {createSecurityContext} from '../context';
import {PermissionService} from '../permissions';
import type express from 'express';
import type {AuthenticatedApiRequest} from '../types';

vi.mock('../context');
vi.mock('../permissions');

describe('Express Auth Middleware', () => {
  let mockReq: Partial<AuthenticatedApiRequest>;
  let mockRes: Partial<express.Response>;
  let mockNext: express.NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({json: jsonMock});
    mockReq = {
      path: '/api/v1/test',
      originalUrl: '/api/v1/test',
      headers: {},
      params: {},
    };
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    mockNext = vi.fn();
  });

  describe('authenticateApiRequest', () => {
    it('bypasses /health and /api/health endpoints', async () => {
      mockReq.path = '/health';
      const mw = authenticateApiRequest();
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(createSecurityContext).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests with 401', async () => {
      vi.mocked(createSecurityContext).mockResolvedValueOnce({
        req: mockReq as express.Request,
        res: mockRes as express.Response,
        user: null,
        isAppAllowed: false,
        isAdmin: false,
      });

      const mw = authenticateApiRequest();
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects non-allowlisted users with 403 when requireAllowlist is true', async () => {
      vi.mocked(createSecurityContext).mockResolvedValueOnce({
        req: mockReq as express.Request,
        res: mockRes as express.Response,
        user: {uid: 'u1', email: 'guest@example.com', authType: 'jwt'},
        isAppAllowed: false,
        isAdmin: false,
      });

      const mw = authenticateApiRequest({requireAllowlist: true});
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes authenticated allowlisted user and attaches context to req', async () => {
      vi.mocked(createSecurityContext).mockResolvedValueOnce({
        req: mockReq as express.Request,
        res: mockRes as express.Response,
        user: {uid: 'u1', email: 'allowed@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: true,
      });

      const mw = authenticateApiRequest();
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual({
        uid: 'u1',
        email: 'allowed@example.com',
        authType: 'jwt',
      });
      expect(mockReq.isAppAllowed).toBe(true);
      expect(mockReq.isAdmin).toBe(true);
    });
  });

  describe('requireAdminMiddleware', () => {
    it('returns 401 if req.user is missing', () => {
      const mw = requireAdminMiddleware();
      mw(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 403 if req.isAdmin is false', () => {
      mockReq.user = {uid: 'u1', email: 'user@example.com', authType: 'jwt'};
      mockReq.isAdmin = false;

      const mw = requireAdminMiddleware();
      mw(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() if user is admin', () => {
      mockReq.user = {uid: 'u1', email: 'admin@example.com', authType: 'jwt'};
      mockReq.isAdmin = true;

      const mw = requireAdminMiddleware();
      mw(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireLibraryRoleMiddleware', () => {
    it('returns 400 if libraryId is missing from req.params', async () => {
      mockReq.params = {};
      const mw = requireLibraryRoleMiddleware('editor');
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('delegates to PermissionService and calls next on success', async () => {
      mockReq.params = {libraryId: 'lib_123'};
      mockReq.user = {uid: 'u1', email: 'user@example.com', authType: 'jwt'};
      vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce(
        true,
      );

      const mw = requireLibraryRoleMiddleware('editor');
      await mw(
        mockReq as express.Request,
        mockRes as express.Response,
        mockNext,
      );

      expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
        mockReq.user,
        'lib_123',
        'editor',
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
