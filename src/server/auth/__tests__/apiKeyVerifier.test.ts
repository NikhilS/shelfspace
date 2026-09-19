import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ApiKeyVerifier} from '../apiKeyVerifier';
import {ApiKeyService} from '../../../services/server/apiKeyService';

vi.mock('../../../services/server/apiKeyService', () => ({
  ApiKeyService: {
    validateApiKey: vi.fn(),
  },
}));

describe('ApiKeyVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractKeyFromHeaders', () => {
    it('extracts API key from x-api-key header', () => {
      const key = ApiKeyVerifier.extractKeyFromHeaders(
        'lib_live_xyz123',
        undefined,
      );
      expect(key).toBe('lib_live_xyz123');
    });

    it('extracts API key from Authorization header when Bearer lib_live_...', () => {
      const key = ApiKeyVerifier.extractKeyFromHeaders(
        undefined,
        'Bearer lib_live_abc456',
      );
      expect(key).toBe('lib_live_abc456');
    });

    it('returns null if neither header contains an API key', () => {
      const key = ApiKeyVerifier.extractKeyFromHeaders(
        undefined,
        'Bearer some_jwt_token',
      );
      expect(key).toBeNull();
    });

    it('prefers x-api-key over Authorization header', () => {
      const key = ApiKeyVerifier.extractKeyFromHeaders(
        'lib_live_first',
        'Bearer lib_live_second',
      );
      expect(key).toBe('lib_live_first');
    });
  });

  describe('verify', () => {
    it('returns null for key without lib_live_ prefix', async () => {
      const user = await ApiKeyVerifier.verify('invalid_prefix_123');
      expect(user).toBeNull();
      expect(ApiKeyService.validateApiKey).not.toHaveBeenCalled();
    });

    it('returns AuthUser object on valid key', async () => {
      vi.mocked(ApiKeyService.validateApiKey).mockResolvedValueOnce({
        uid: 'user_123',
        email: 'api@example.com',
        apiKeyId: 'hash_999',
      });

      const user = await ApiKeyVerifier.verify('lib_live_secret123');
      expect(user).toEqual({
        uid: 'user_123',
        email: 'api@example.com',
        authType: 'api_key',
        apiKeyId: 'hash_999',
      });
    });

    it('returns null if ApiKeyService returns null (revoked or non-existent)', async () => {
      vi.mocked(ApiKeyService.validateApiKey).mockResolvedValueOnce(null);

      const user = await ApiKeyVerifier.verify('lib_live_revoked');
      expect(user).toBeNull();
    });

    it('handles unexpected exceptions and returns null gracefully', async () => {
      vi.mocked(ApiKeyService.validateApiKey).mockRejectedValueOnce(
        new Error('DB failure'),
      );

      const user = await ApiKeyVerifier.verify('lib_live_error');
      expect(user).toBeNull();
    });
  });
});
