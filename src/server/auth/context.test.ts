import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createSecurityContext} from './context';
import {TokenVerifier} from './tokenVerifier';
import {AllowlistService} from './allowlistService';
import type express from 'express';

vi.mock('./tokenVerifier');
vi.mock('./allowlistService');

describe('createSecurityContext', () => {
  const mockRes = {} as unknown as express.Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds unauthenticated context when no auth headers are provided', async () => {
    vi.mocked(TokenVerifier.extractTokenFromHeader).mockReturnValue(null);

    const ctx = await createSecurityContext({
      req: {headers: {}} as unknown as express.Request,
      res: mockRes,
    });

    expect(ctx.user).toBeNull();
    expect(ctx.isAppAllowed).toBe(false);
    expect(ctx.isAdmin).toBe(false);
    expect(AllowlistService.getPermissions).not.toHaveBeenCalled();
  });

  it('authenticates via Firebase JWT and resolves allowlist permissions', async () => {
    vi.mocked(TokenVerifier.extractTokenFromHeader).mockReturnValue(
      'jwt_token_123',
    );
    vi.mocked(TokenVerifier.verify).mockResolvedValueOnce({
      uid: 'jwt_uid',
      email: 'reader@example.com',
    });
    vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
      isAppAllowed: true,
      isAdmin: false,
    });

    const ctx = await createSecurityContext({
      req: {
        headers: {authorization: 'Bearer jwt_token_123'},
      } as unknown as express.Request,
      res: mockRes,
    });

    expect(ctx.user).toEqual({
      uid: 'jwt_uid',
      email: 'reader@example.com',
    });
    expect(ctx.isAppAllowed).toBe(true);
    expect(ctx.isAdmin).toBe(false);
    expect(AllowlistService.getPermissions).toHaveBeenCalledWith(
      'reader@example.com',
    );
  });

  it('authenticates via Firebase JWT and resolves admin permissions', async () => {
    vi.mocked(TokenVerifier.extractTokenFromHeader).mockReturnValue(
      'jwt_admin_token',
    );
    vi.mocked(TokenVerifier.verify).mockResolvedValueOnce({
      uid: 'jwt_admin_uid',
      email: 'admin@example.com',
    });
    vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
      isAppAllowed: true,
      isAdmin: true,
    });

    const ctx = await createSecurityContext({
      req: {
        headers: {authorization: 'Bearer jwt_admin_token'},
      } as unknown as express.Request,
      res: mockRes,
    });

    expect(ctx.user?.email).toBe('admin@example.com');
    expect(ctx.isAppAllowed).toBe(true);
    expect(ctx.isAdmin).toBe(true);
  });
});
