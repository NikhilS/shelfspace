import {describe, it, expect, vi, beforeEach} from 'vitest';
import {TokenVerifier} from './tokenVerifier';

const mockVerifyIdToken = vi.fn();

vi.mock('firebase-admin', () => ({
  default: {
    auth: () => ({
      verifyIdToken: mockVerifyIdToken,
    }),
  },
}));

describe('TokenVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractTokenFromHeader', () => {
    it('extracts JWT token from valid Bearer authorization header', () => {
      const token = TokenVerifier.extractTokenFromHeader(
        'Bearer eyJhbGciOi...',
      );
      expect(token).toBe('eyJhbGciOi...');
    });

    it('returns null if header is not Bearer', () => {
      const token = TokenVerifier.extractTokenFromHeader('Basic dXNlcjpwYXNz');
      expect(token).toBeNull();
    });

    it('returns null if header is empty, undefined, or literal null/undefined', () => {
      expect(TokenVerifier.extractTokenFromHeader(undefined)).toBeNull();
      expect(TokenVerifier.extractTokenFromHeader('')).toBeNull();
      expect(TokenVerifier.extractTokenFromHeader('Bearer null')).toBeNull();
      expect(
        TokenVerifier.extractTokenFromHeader('Bearer undefined'),
      ).toBeNull();
    });
  });

  describe('verify', () => {
    it('verifies valid Firebase ID Token and returns AuthUser', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'firebase_user_1',
        email: 'USER@example.com',
      });

      const user = await TokenVerifier.verify('valid_token_xyz');
      expect(user).toEqual({
        uid: 'firebase_user_1',
        email: 'user@example.com', // normalized to lowercase
      });
      expect(mockVerifyIdToken).toHaveBeenCalledWith('valid_token_xyz');
    });

    it('returns null if token verification fails or throws', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(
        new Error('Firebase ID Token expired'),
      );

      const user = await TokenVerifier.verify('expired_token');
      expect(user).toBeNull();
    });

    it('returns null if decoded token lacks email', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'user_without_email',
      });

      const user = await TokenVerifier.verify('no_email_token');
      expect(user).toBeNull();
    });

    it('returns null if decoded token has email_verified === false', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'unverified_user',
        email: 'spoof@example.com',
        email_verified: false,
      });

      const user = await TokenVerifier.verify('unverified_token');
      expect(user).toBeNull();
    });
  });
});
