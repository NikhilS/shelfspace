import {describe, it, expect, vi, beforeEach} from 'vitest';
import {authRouter} from './auth';
import {WaitlistService} from '../../auth/waitlistService';
import {AllowlistService} from '../../auth/allowlistService';
import {TRPCError} from '@trpc/server';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../auth/waitlistService', () => ({
  WaitlistService: {
    getStatus: vi.fn(),
    join: vi.fn(),
    list: vi.fn(),
    review: vi.fn(),
  },
}));

vi.mock('../../auth/allowlistService', () => ({
  AllowlistService: {
    listUsers: vi.fn(),
    addUser: vi.fn(),
    removeUser: vi.fn(),
  },
}));

describe('authRouter', () => {
  const caller = (ctx: Partial<SecurityContext>) =>
    authRouter.createCaller(ctx as SecurityContext);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPermissions', () => {
    it('returns caller context permissions', async () => {
      const api = caller({
        user: {uid: 'u1', email: 'user@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });
      const res = await api.getPermissions();
      expect(res).toEqual({
        isAppAllowed: true,
        isAdmin: false,
        user: {uid: 'u1', email: 'user@example.com', authType: 'jwt'},
      });
    });
  });

  describe('getWaitlistStatus', () => {
    it('throws UNAUTHORIZED when caller is not logged in', async () => {
      const api = caller({
        user: null,
        isAppAllowed: false,
        isAdmin: false,
      });
      await expect(api.getWaitlistStatus()).rejects.toThrow(TRPCError);
      await expect(api.getWaitlistStatus()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('resolves waitlist status for authenticated user not yet on allowlist', async () => {
      vi.mocked(WaitlistService.getStatus).mockResolvedValueOnce({
        status: 'pending',
        entry: {
          email: 'waiter@example.com',
          status: 'pending',
          requestedAt: '2026-09-21T10:00:00.000Z',
        },
      });

      const api = caller({
        user: {uid: 'u2', email: 'waiter@example.com', authType: 'jwt'},
        isAppAllowed: false,
        isAdmin: false,
      });

      const res = await api.getWaitlistStatus();
      expect(res.status).toBe('pending');
      expect(WaitlistService.getStatus).toHaveBeenCalledWith(
        'waiter@example.com',
      );
    });
  });

  describe('joinWaitlist', () => {
    it('throws UNAUTHORIZED when unauthenticated', async () => {
      const api = caller({
        user: null,
        isAppAllowed: false,
        isAdmin: false,
      });
      await expect(api.joinWaitlist()).rejects.toThrow(TRPCError);
      await expect(api.joinWaitlist()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('allows authenticated caller not on allowlist to join waitlist', async () => {
      vi.mocked(WaitlistService.join).mockResolvedValueOnce({
        email: 'applicant@example.com',
        displayName: 'Applicant Name',
        photoURL: 'https://example.com/avatar.jpg',
        status: 'pending',
        requestedAt: '2026-09-21T11:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
      });

      const api = caller({
        user: {
          uid: 'u3',
          email: 'applicant@example.com',
          authType: 'jwt',
          displayName: 'Applicant Name',
          photoURL: 'https://example.com/avatar.jpg',
        },
        isAppAllowed: false,
        isAdmin: false,
      });

      const res = await api.joinWaitlist();
      expect(res.success).toBe(true);
      expect(WaitlistService.join).toHaveBeenCalledWith({
        email: 'applicant@example.com',
        displayName: 'Applicant Name',
        photoURL: 'https://example.com/avatar.jpg',
      });
    });
  });

  describe('listWaitlist', () => {
    it('throws FORBIDDEN when caller is not an admin', async () => {
      const api = caller({
        user: {uid: 'u4', email: 'regular@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });

      await expect(api.listWaitlist()).rejects.toThrow(TRPCError);
      await expect(api.listWaitlist()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('returns waitlist entries for admin caller', async () => {
      vi.mocked(WaitlistService.list).mockResolvedValueOnce([
        {
          email: 'applicant@example.com',
          status: 'pending',
          requestedAt: '2026-09-21T10:00:00.000Z',
          reviewedAt: null,
          reviewedBy: null,
        },
      ]);

      const api = caller({
        user: {uid: 'admin_1', email: 'admin@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: true,
      });

      const res = await api.listWaitlist({status: 'pending'});
      expect(res.entries).toHaveLength(1);
      expect(WaitlistService.list).toHaveBeenCalledWith('pending');
    });
  });

  describe('reviewWaitlistEntry', () => {
    it('throws FORBIDDEN when non-admin caller attempts review', async () => {
      const api = caller({
        user: {uid: 'u5', email: 'user@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: false,
      });

      await expect(
        api.reviewWaitlistEntry({
          email: 'applicant@example.com',
          action: 'approve',
        }),
      ).rejects.toThrow(TRPCError);
      await expect(
        api.reviewWaitlistEntry({
          email: 'applicant@example.com',
          action: 'approve',
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('approves an applicant when called by an admin', async () => {
      vi.mocked(WaitlistService.review).mockResolvedValueOnce({
        success: true,
        status: 'approved',
      });

      const api = caller({
        user: {uid: 'admin_1', email: 'admin@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: true,
      });

      const res = await api.reviewWaitlistEntry({
        email: 'applicant@example.com',
        action: 'approve',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('approved');
      expect(WaitlistService.review).toHaveBeenCalledWith({
        email: 'applicant@example.com',
        action: 'approve',
        adminEmail: 'admin@example.com',
      });
    });

    it('rejects an applicant when called by an admin', async () => {
      vi.mocked(WaitlistService.review).mockResolvedValueOnce({
        success: true,
        status: 'rejected',
      });

      const api = caller({
        user: {uid: 'admin_1', email: 'admin@example.com', authType: 'jwt'},
        isAppAllowed: true,
        isAdmin: true,
      });

      const res = await api.reviewWaitlistEntry({
        email: 'applicant@example.com',
        action: 'reject',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('rejected');
      expect(WaitlistService.review).toHaveBeenCalledWith({
        email: 'applicant@example.com',
        action: 'reject',
        adminEmail: 'admin@example.com',
      });
    });
  });
});
