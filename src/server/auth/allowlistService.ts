import admin from 'firebase-admin';
import {getAdminDb} from '../../services/server/firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import type {SecurityPermissions} from './types';

interface CachedUserPerms {
  perms: SecurityPermissions;
  expiresAt: number;
}

export class AllowlistService {
  private static cache = new Map<string, CachedUserPerms>();
  private static DEFAULT_TTL_MS = 1000 * 60 * 3; // 3 minutes

  /**
   * Resolves permission flags (isAppAllowed, isAdmin) for an email.
   * Superadmin email bypasses database check completely.
   */
  static async getPermissions(
    email?: string | null,
  ): Promise<SecurityPermissions> {
    if (!email) {
      return {isAppAllowed: false, isAdmin: false};
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      return {isAppAllowed: false, isAdmin: false};
    }

    // Superadmin bypass
    if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
      return {isAppAllowed: true, isAdmin: true};
    }

    // Cache lookup
    const now = Date.now();
    const cached = this.cache.get(normalizedEmail);
    if (cached && cached.expiresAt > now) {
      return cached.perms;
    }

    // Query Firestore
    try {
      let db:
        | FirebaseFirestore.Firestore
        | {doc: (path: string) => {get: () => Promise<unknown>}};
      try {
        db = getAdminDb();
      } catch {
        db = admin.firestore();
      }

      const docSnap = await (
        db.doc(`appSettings/allowlist/users/${normalizedEmail}`) as unknown as {
          get: () => Promise<FirebaseFirestore.DocumentSnapshot>;
        }
      ).get();

      let result: SecurityPermissions = {isAppAllowed: false, isAdmin: false};
      if (docSnap && docSnap.exists) {
        const data = docSnap.data() as {role?: string} | undefined;
        result = {
          isAppAllowed: true,
          isAdmin: data?.role === 'admin',
        };
      }

      this.cache.set(normalizedEmail, {
        perms: result,
        expiresAt: now + this.DEFAULT_TTL_MS,
      });

      return result;
    } catch (err) {
      console.error(
        '[AllowlistService] Error querying allowlist for email:',
        normalizedEmail,
        err,
      );
      return {isAppAllowed: false, isAdmin: false};
    }
  }

  /**
   * Manually invalidate or clear the permission cache (useful for testing or admin updates).
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Sets cache directly (useful in unit tests or when admin grants permissions).
   */
  static setCache(
    email: string,
    perms: SecurityPermissions,
    ttlMs: number = this.DEFAULT_TTL_MS,
  ): void {
    const normalizedEmail = email.toLowerCase().trim();
    this.cache.set(normalizedEmail, {
      perms,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Lists all allowlisted users for admin dashboard.
   */
  static async listUsers(): Promise<Array<{email: string; role: string}>> {
    let db: FirebaseFirestore.Firestore;
    try {
      db = getAdminDb();
    } catch {
      db = admin.firestore();
    }
    const snap = await db.collection('appSettings/allowlist/users').get();
    return snap.docs.map(doc => ({
      email: doc.id,
      role: (doc.data() as {role?: string})?.role || 'user',
    }));
  }

  /**
   * Adds or updates an allowlisted user.
   */
  static async addUser(email: string, role: string = 'user'): Promise<void> {
    const normalized = email.toLowerCase().trim();
    let db: FirebaseFirestore.Firestore;
    try {
      db = getAdminDb();
    } catch {
      db = admin.firestore();
    }
    await db.collection('appSettings/allowlist/users').doc(normalized).set(
      {
        email: normalized,
        role,
        addedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    this.setCache(normalized, {isAppAllowed: true, isAdmin: role === 'admin'});
  }

  /**
   * Removes a user from the allowlist.
   */
  static async removeUser(email: string): Promise<void> {
    const normalized = email.toLowerCase().trim();
    let db: FirebaseFirestore.Firestore;
    try {
      db = getAdminDb();
    } catch {
      db = admin.firestore();
    }
    await db.collection('appSettings/allowlist/users').doc(normalized).delete();
    this.cache.delete(normalized);
  }
}
