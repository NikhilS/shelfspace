import {ApiKeyService} from '../../services/server/apiKeyService';
import type {AuthUser} from './types';

export class ApiKeyVerifier {
  /**
   * Extracts API key string from headers (either 'x-api-key' or 'Authorization: Bearer lib_live_...')
   */
  static extractKeyFromHeaders(
    apiKeyHeader?: string,
    authHeader?: string,
  ): string | null {
    if (apiKeyHeader && apiKeyHeader.trim()) {
      return apiKeyHeader.trim();
    }
    if (authHeader && authHeader.startsWith('Bearer lib_live_')) {
      return authHeader.substring(7).trim();
    }
    return null;
  }

  /**
   * Validates a secret API key string.
   * Returns AuthUser on success, or null if invalid / revoked.
   */
  static async verify(rawApiKey: string): Promise<AuthUser | null> {
    if (!rawApiKey || !rawApiKey.startsWith('lib_live_')) {
      return null;
    }

    try {
      const validated = await ApiKeyService.validateApiKey(rawApiKey);
      if (!validated) {
        return null;
      }

      return {
        uid: validated.uid,
        email: validated.email,
        authType: 'api_key',
        apiKeyId: validated.apiKeyId,
      };
    } catch (err) {
      console.error('[ApiKeyVerifier] Failed to validate API key:', err);
      return null;
    }
  }
}
