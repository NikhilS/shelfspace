import admin from 'firebase-admin';
import type {AuthUser} from './types';

export class TokenVerifier {
  /**
   * Extracts Firebase JWT token from 'Authorization: Bearer <token>' header.
   * Returns null if not present or malformed.
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7).trim();
    if (!token || token === 'undefined' || token === 'null') {
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
      if (
        !decoded ||
        !decoded.uid ||
        !decoded.email ||
        decoded.email_verified === false
      ) {
        return null;
      }

      return {
        uid: decoded.uid,
        email: decoded.email.toLowerCase(),
        displayName: (decoded.name as string | undefined) || undefined,
        photoURL: (decoded.picture as string | undefined) || undefined,
      };
    } catch (err) {
      console.error('Error verifying JWT token in TRPC context', err);
      return null;
    }
  }
}
