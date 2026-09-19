import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createSecurityContext} from '../context';
import {ApiKeyVerifier} from '../apiKeyVerifier';
import {TokenVerifier} from '../tokenVerifier';
import {AllowlistService} from '../allowlistService';
import type express from 'express';

vi.mock('../apiKeyVerifier');
vi.mock('../tokenVerifier');
vi.mock('../allowlistService');

describe('createSecurityContext', () => {
  const mockReq = {
    headers: {},
  } as unknown as express.Request;

  const mockRes = {} as unknown as express.Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds unauthenticated context when no auth headers are provided', async () => {
    vi.mocked(ApiKeyVerifier.extractKeyFromHeaders).mockReturnValue(null);
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

  it('authenticates via API key and resolves allowlist permissions', async () => {
    vi.mocked(ApiKeyVerifier.extractKeyFromHeaders).mockReturnValue(
      'lib_live_valid',
    );
    vi.mocked(ApiKeyVerifier.verify).mockResolvedValueOnce({
      uid: 'api_uid',
      email: 'api@example.com',
      authType: 'api_key',
      apiKeyId: 'hash_123',
    });
    vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
      isAppAllowed: true,
      isAdmin: false,
    });

    const ctx = await createSecurityContext({
      req: {
        headers: {'x-api-key': 'lib_live_valid'},
      } as unknown as express.Request,
      res: mockRes,
    });

    expect(ctx.user).toEqual({
      uid: 'api_uid',
      email: 'api@example.com',
      authType: 'api_key',
      apiKeyId: 'hash_123',
    });
    expect(ctx.isAppAllowed).toBe(true);
    expect(ctx.isAdmin).toBe(false);
    expect(AllowlistService.getPermissions).toHaveBeenCalledWith(
      'api@example.com',
    );
  });

  it('authenticates via JWT and resolves admin permissions', async () => {
    vi.mocked(ApiKeyVerifier.extractKeyFromHeaders).mockReturnValue(null);
    vi.mocked(TokenVerifier.extractTokenFromHeader).mockReturnValue(
      'jwt_token_123',
    );
    vi.mocked(TokenVerifier.verify).mockResolvedValueOnce({
      uid: 'jwt_uid',
      email: 'admin@example.com',
      authType: 'jwt',
    });
    vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
      isAppAllowed: true,
      isAdmin: true,
    });

    const ctx = await createSecurityContext({
      req: {
        headers: {authorization: 'Bearer jwt_token_123'},
      } as unknown as express.Request,
      res: mockRes,
    });

    expect(ctx.user?.email).toBe('admin@example.com');
    expect(ctx.isAppAllowed).toBe(true);
    expect(ctx.isAdmin).toBe(true);
  });
});
