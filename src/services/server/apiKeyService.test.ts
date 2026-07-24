import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ApiKeyService} from './apiKeyService';

// Mock firebaseAdmin module
const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocUpdate = vi.fn().mockResolvedValue(undefined);
const mockDocGet = vi.fn();
const mockWhereGet = vi.fn();

const mockCollection = vi.fn().mockReturnValue({
  doc: vi.fn((docId?: string) => ({
    set: mockDocSet,
    get: mockDocGet,
    update: mockDocUpdate,
  })),
  where: vi.fn(() => ({
    get: mockWhereGet,
  })),
});

vi.mock('./firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
  }),
}));

describe('ApiKeyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('creates a secret key prefixed with lib_live_ and stores hash in firestore', async () => {
      const ownerId = 'user_123';
      const ownerEmail = 'user@example.com';
      const name = 'Production API Key';

      const result = await ApiKeyService.generateApiKey(ownerId, ownerEmail, name);

      expect(result.key).toMatch(/^lib_live_[a-f0-9]{64}$/);
      expect(result.keyPrefix).toBe(result.key.substring(0, 16));
      expect(result.keySuffix).toBe(result.key.substring(result.key.length - 4));
      expect(result.name).toBe(name);

      expect(mockCollection).toHaveBeenCalledWith('apiKeys');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Production API Key',
          ownerId: 'user_123',
          ownerEmail: 'user@example.com',
          revoked: false,
          lastUsedAt: null,
        }),
      );
    });
  });

  describe('validateApiKey', () => {
    it('returns user context and updates lastUsedAt for valid active key', async () => {
      const ownerId = 'user_123';
      const ownerEmail = 'user@example.com';
      const keyName = 'Test Key';

      const created = await ApiKeyService.generateApiKey(ownerId, ownerEmail, keyName);
      const rawKey = created.key;

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: created.id,
          keyHash: created.id,
          keyPrefix: created.keyPrefix,
          keySuffix: created.keySuffix,
          name: keyName,
          ownerId,
          ownerEmail,
          createdAt: created.createdAt,
          lastUsedAt: null,
          revoked: false,
        }),
        ref: {
          update: mockDocUpdate,
        },
      });

      const validated = await ApiKeyService.validateApiKey(rawKey);

      expect(validated).not.toBeNull();
      expect(validated?.uid).toBe(ownerId);
      expect(validated?.email).toBe(ownerEmail);
      expect(validated?.apiKeyId).toBe(created.id);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          lastUsedAt: expect.any(String),
        }),
      );
    });

    it('returns null for empty or non-lib_live_ key strings', async () => {
      expect(await ApiKeyService.validateApiKey('')).toBeNull();
      expect(await ApiKeyService.validateApiKey('invalid_key_prefix')).toBeNull();
      expect(await ApiKeyService.validateApiKey(123 as unknown as string)).toBeNull();
    });

    it('returns null if key hash does not exist in Firestore', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: false,
      });

      const rawKey = 'lib_live_0000000000000000000000000000000000000000000000000000000000000000';
      const result = await ApiKeyService.validateApiKey(rawKey);
      expect(result).toBeNull();
    });

    it('returns null if key has been revoked', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'user_123',
          ownerEmail: 'user@example.com',
          revoked: true,
        }),
      });

      const rawKey = 'lib_live_1111111111111111111111111111111111111111111111111111111111111111';
      const result = await ApiKeyService.validateApiKey(rawKey);
      expect(result).toBeNull();
    });

    it('catches and logs errors during lastUsedAt timestamp update without breaking validation', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDocUpdate.mockRejectedValueOnce(new Error('Firestore write timeout'));

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: 'hash123',
          ownerId: 'user_123',
          ownerEmail: 'user@example.com',
          revoked: false,
        }),
        ref: {
          update: mockDocUpdate,
        },
      });

      const rawKey = 'lib_live_2222222222222222222222222222222222222222222222222222222222222222';
      const validated = await ApiKeyService.validateApiKey(rawKey);

      expect(validated?.uid).toBe('user_123');
      // Wait for background promise catch
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ApiKeyService] Failed to update lastUsedAt timestamp:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('listApiKeys', () => {
    it('returns formatted list of keys for user sorted by createdAt descending', async () => {
      const ownerId = 'user_123';

      const mockSnapshots = [
        {
          id: 'hash_old',
          data: () => ({
            keyPrefix: 'lib_live_11111111',
            keySuffix: '1111',
            name: 'Old Key',
            ownerId,
            ownerEmail: 'user@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            revoked: false,
          }),
        },
        {
          id: 'hash_new',
          data: () => ({
            keyPrefix: 'lib_live_22222222',
            keySuffix: '2222',
            name: 'New Key',
            ownerId,
            ownerEmail: 'user@example.com',
            createdAt: '2026-06-01T00:00:00.000Z',
            lastUsedAt: '2026-06-02T00:00:00.000Z',
            revoked: false,
          }),
        },
      ];

      mockWhereGet.mockResolvedValueOnce({
        forEach: (cb: (doc: unknown) => void) => mockSnapshots.forEach(cb),
      });

      const list = await ApiKeyService.listApiKeys(ownerId);

      expect(list.length).toBe(2);
      expect(list[0].name).toBe('New Key'); // sorted descending
      expect(list[1].name).toBe('Old Key');
      expect(list[0]).not.toHaveProperty('keyHash');
    });
  });

  describe('revokeApiKey', () => {
    it('revokes key successfully when caller is owner', async () => {
      const ownerId = 'user_123';
      const keyId = 'hash_to_revoke';

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId,
          revoked: false,
        }),
      });

      const result = await ApiKeyService.revokeApiKey(ownerId, keyId);
      expect(result).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({revoked: true});
    });

    it('throws error if key not found', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: false,
      });

      await expect(ApiKeyService.revokeApiKey('user_123', 'nonexistent')).rejects.toThrow(
        'API key not found',
      );
    });

    it('throws unauthorized error if caller does not match owner', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerId: 'other_user_456',
          revoked: false,
        }),
      });

      await expect(ApiKeyService.revokeApiKey('user_123', 'hash123')).rejects.toThrow(
        'Unauthorized: You do not own this API key',
      );
    });
  });
});
