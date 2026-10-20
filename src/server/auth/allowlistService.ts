import {TRPCError} from '@trpc/server';
import {getAdminDb, FieldValue} from '../services/firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {validateAndNormalizeEmail} from '../../schemas/common';
import type {SecurityPermissions} from './types';

interface CachedUserPerms {
  perms: SecurityPermissions;
  expiresAt: number;
}

const ALLOWED_ROLES = new Set(['user', 'admin']);

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

    let normalizedEmail: string;
    try {
      normalizedEmail = validateAndNormalizeEmail(email);
    } catch {
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

    // Query Firestore via firebase-admin
    try {
      const db = getAdminDb();
      const docSnap = await db
        .doc(`appSettings/allowlist/users/${normalizedEmail}`)
        .get();

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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        '[AllowlistService] Error querying allowlist for email:',
        normalizedEmail,
        errMsg,
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
    const db = getAdminDb();
    const snap = await db.collection('appSettings/allowlist/users').get();
    return snap.docs.map(doc => ({
      email: doc.id,
      role: (doc.data() as {role?: string})?.role || 'user',
    }));
  }

  /**
   * Adds or updates an allowlisted user, and synchronizes any existing waitlist entry to approved.
   */
  static async addUser(email: string, role: string = 'user'): Promise<void> {
    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(email);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid email address',
      });
    }

    if (!ALLOWED_ROLES.has(role)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid allowlist role '${role}'. Allowed roles: 'user', 'admin'`,
      });
    }

    const db = getAdminDb();
    await db.collection('appSettings/allowlist/users').doc(normalized).set(
      {
        email: normalized,
        role,
        addedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    this.setCache(normalized, {isAppAllowed: true, isAdmin: role === 'admin'});

    // Synchronize existing waitlist record if one exists so approved users don't remain in pending queue
    try {
      const waitlistRef = db.doc(`appSettings/waitlist/entries/${normalized}`);
      const waitlistSnap = await waitlistRef.get();
      if (waitlistSnap && waitlistSnap.exists) {
        const currentData = waitlistSnap.data() as
          {status?: string} | undefined;
        if (currentData?.status !== 'approved') {
          await waitlistRef.set(
            {
              email: normalized,
              status: 'approved',
              reviewedAt: new Date().toISOString(),
            },
            {merge: true},
          );
        }
      }
    } catch {
      // Non-fatal if waitlist collection is unavailable or unmocked in isolated tests
    }
  }

  /**
   * Removes a user from the allowlist.
   * Blocks removing SUPERADMIN_EMAIL or the acting administrator's own account.
   */
  static async removeUser(
    email: string,
    actingAdminEmail?: string,
  ): Promise<void> {
    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(email);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid email address',
      });
    }

    if (normalized === SUPERADMIN_EMAIL.toLowerCase().trim()) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot remove superadmin from the allowlist',
      });
    }

    if (
      actingAdminEmail &&
      normalized === actingAdminEmail.toLowerCase().trim()
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Administrators cannot remove their own allowlist entry',
      });
    }

    const db = getAdminDb();
    await db.collection('appSettings/allowlist/users').doc(normalized).delete();
    this.cache.delete(normalized);
  }
}
