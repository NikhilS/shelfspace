import admin from 'firebase-admin';
import type {AuthUser} from './types';

export class TokenVerifier {
  /**
   * Extracts Firebase JWT token from 'Authorization: Bearer <token>' header.
   * Returns null if not present or if it is an API key (lib_live_).
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7).trim();
    if (!token || token.startsWith('lib_live_')) {
      return null;
    }

    return token;
  }

  /**
   * Verifies Firebase ID Token and returns AuthUser.
   * Returns null if token is invalid, expired, or revoked.
   */
  static async verify(token: string): Promise<AuthUser | null> {
    if (!token) {
      return null;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      if (!decoded || !decoded.uid || !decoded.email) {
        return null;
      }

      return {
        uid: decoded.uid,
        email: decoded.email.toLowerCase(),
        authType: 'jwt',
      };
    } catch (err) {
      console.error('Error verifying JWT token in TRPC context', err);
      return null;
    }
  }
}
