import {describe, it, expect, vi, beforeEach} from 'vitest';
import {TokenVerifier} from '../tokenVerifier';
import admin from 'firebase-admin';

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

    it('returns null if header is empty or undefined', () => {
      expect(TokenVerifier.extractTokenFromHeader(undefined)).toBeNull();
      expect(TokenVerifier.extractTokenFromHeader('')).toBeNull();
    });

    it('returns null if header is an API key (Bearer lib_live_...)', () => {
      const token = TokenVerifier.extractTokenFromHeader(
        'Bearer lib_live_somekey',
      );
      expect(token).toBeNull();
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
        authType: 'jwt',
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
  });
});
