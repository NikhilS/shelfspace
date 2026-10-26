import {TRPCError} from '@trpc/server';
import {getAdminDb, FieldValue} from '../services/firebaseAdmin';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {
  SchemaValidationError,
  validateAndNormalizeEmail,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import {
  storedAllowlistUserDocSchema,
  storedWaitlistEntryDocSchema,
  type AllowlistRole,
  type StoredAllowlistUserDoc,
} from '../../schemas/waitlist';
import {normalizeFirestoreTimestamp} from '../services/book/bookPartitioner';
import type {SecurityPermissions} from './types';

interface CachedUserPerms {
  perms: SecurityPermissions;
  expiresAt: number;
}

const ALLOWED_ROLES = new Set(['user', 'admin']);

export const allowlistDocConverter = {
  toFirestoreWrite(
    email: string,
    input: {
      role: AllowlistRole;
      hasAiPlan: boolean;
      isCreate?: boolean;
    },
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      email,
      role: input.role,
      hasAiPlan: input.hasAiPlan,
      ...(input.isCreate
        ? {addedAt: FieldValue.serverTimestamp()}
        : {updatedAt: FieldValue.serverTimestamp()}),
    };
    validateFirestoreWritePayload(storedAllowlistUserDocSchema, payload, {
      entity: 'StoredAllowlistUserDoc',
      documentPath: `appSettings/allowlist/users/${email}`,
      operation: input.isCreate ? 'create' : 'upsert',
    });
    return payload;
  },

  fromFirestore(
    email: string,
    raw: Record<string, unknown>,
  ): StoredAllowlistUserDoc {
    const addedAt = normalizeFirestoreTimestamp(raw.addedAt);
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      email:
        typeof raw.email === 'string' && raw.email.trim() ? raw.email : email,
      role: typeof raw.role === 'string' && raw.role.trim() ? raw.role : 'user',
    };
    if (addedAt !== undefined) {
      candidate.addedAt = addedAt;
    } else {
      delete candidate.addedAt;
    }
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    for (const k of Object.keys(candidate)) {
      if (candidate[k] === undefined) {
        delete candidate[k];
      }
    }
    return validateFirestoreReadPayload(
      storedAllowlistUserDocSchema,
      candidate,
      {
        entity: 'StoredAllowlistUserDoc',
        documentPath: `appSettings/allowlist/users/${email}`,
        operation: 'read',
      },
    );
  },
};

export class AllowlistService {
  private static cache = new Map<string, CachedUserPerms>();
  private static DEFAULT_TTL_MS = 1000 * 60 * 3; // 3 minutes

  /**
   * Resolves permission flags (isAppAllowed, isAdmin, hasAiPlan) for an email.
   * Superadmin email bypasses database check completely.
   */
  static async getPermissions(
    email?: string | null,
  ): Promise<SecurityPermissions> {
    if (!email) {
      return {isAppAllowed: false, isAdmin: false, hasAiPlan: false};
    }

    let normalizedEmail: string;
    try {
      normalizedEmail = validateAndNormalizeEmail(email);
    } catch {
      return {isAppAllowed: false, isAdmin: false, hasAiPlan: false};
    }

    // Superadmin bypass
    if (normalizedEmail === SUPERADMIN_EMAIL.toLowerCase().trim()) {
      return {isAppAllowed: true, isAdmin: true, hasAiPlan: true};
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

      let result: SecurityPermissions = {
        isAppAllowed: false,
        isAdmin: false,
        hasAiPlan: false,
      };
      if (docSnap && docSnap.exists) {
        const data = allowlistDocConverter.fromFirestore(
          normalizedEmail,
          (docSnap.data() || {}) as Record<string, unknown>,
        );
        const isAdmin = data.role === 'admin';
        result = {
          isAppAllowed: true,
          isAdmin,
          hasAiPlan: isAdmin || Boolean(data.hasAiPlan),
        };
      }

      this.cache.set(normalizedEmail, {
        perms: result,
        expiresAt: now + this.DEFAULT_TTL_MS,
      });

      return result;
    } catch (err: unknown) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        '[AllowlistService] Error querying allowlist for email:',
        normalizedEmail,
        errMsg,
      );
      return {isAppAllowed: false, isAdmin: false, hasAiPlan: false};
    }
  }

  /**
   * Resolves permission flags for multiple emails in bulk using L1 cache and a single db.getAll() RPC for cache misses.
   */
  static async getPermissionsBulk(
    emails: string[],
  ): Promise<Map<string, SecurityPermissions>> {
    const results = new Map<string, SecurityPermissions>();
    if (!emails || emails.length === 0) {
      return results;
    }

    const now = Date.now();
    const superAdminEmail = SUPERADMIN_EMAIL.toLowerCase().trim();
    const missingEmails: string[] = [];
    const seenNormalized = new Set<string>();

    for (const rawEmail of emails) {
      if (!rawEmail) {
        continue;
      }
      let normalizedEmail: string;
      try {
        normalizedEmail = validateAndNormalizeEmail(rawEmail);
      } catch {
        results.set(rawEmail.toLowerCase().trim(), {
          isAppAllowed: false,
          isAdmin: false,
          hasAiPlan: false,
        });
        continue;
      }

      if (seenNormalized.has(normalizedEmail)) {
        continue;
      }
      seenNormalized.add(normalizedEmail);

      if (normalizedEmail === superAdminEmail) {
        results.set(normalizedEmail, {
          isAppAllowed: true,
          isAdmin: true,
          hasAiPlan: true,
        });
        continue;
      }

      const cached = this.cache.get(normalizedEmail);
      if (cached && cached.expiresAt > now) {
        results.set(normalizedEmail, cached.perms);
        continue;
      }

      missingEmails.push(normalizedEmail);
    }

    if (missingEmails.length > 0) {
      try {
        const db = getAdminDb();
        const refs = missingEmails.map(email =>
          db.doc(`appSettings/allowlist/users/${email}`),
        );
        const snaps = await db.getAll(...refs);

        for (let i = 0; i < missingEmails.length; i++) {
          const email = missingEmails[i];
          const snap = snaps[i];
          let perm: SecurityPermissions = {
            isAppAllowed: false,
            isAdmin: false,
            hasAiPlan: false,
          };
          if (snap && snap.exists) {
            const data = allowlistDocConverter.fromFirestore(
              email,
              (snap.data() || {}) as Record<string, unknown>,
            );
            const isAdmin = data.role === 'admin';
            perm = {
              isAppAllowed: true,
              isAdmin,
              hasAiPlan: isAdmin || Boolean(data.hasAiPlan),
            };
          }
          this.cache.set(email, {
            perms: perm,
            expiresAt: now + this.DEFAULT_TTL_MS,
          });
          results.set(email, perm);
        }
      } catch (err: unknown) {
        if (err instanceof SchemaValidationError) {
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          '[AllowlistService] Error bulk-querying allowlist:',
          errMsg,
        );
        for (const email of missingEmails) {
          results.set(email, {
            isAppAllowed: false,
            isAdmin: false,
            hasAiPlan: false,
          });
        }
      }
    }

    return results;
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
      perms: {
        ...perms,
        hasAiPlan: Boolean(perms.isAdmin || perms.hasAiPlan),
      },
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Lists all allowlisted users for admin dashboard.
   */
  static async listUsers(): Promise<
    Array<{email: string; role: string; hasAiPlan: boolean}>
  > {
    const db = getAdminDb();
    const snap = await db.collection('appSettings/allowlist/users').get();
    const superAdminEmail = SUPERADMIN_EMAIL.toLowerCase().trim();
    return snap.docs.map(doc => {
      const data = allowlistDocConverter.fromFirestore(
        doc.id,
        (doc.data() || {}) as Record<string, unknown>,
      );
      const role = data.role || 'user';
      const isAdmin = role === 'admin' || doc.id === superAdminEmail;
      return {
        email: doc.id,
        role,
        hasAiPlan: isAdmin || Boolean(data.hasAiPlan),
      };
    });
  }

  /**
   * Adds or updates an allowlisted user, and synchronizes any existing waitlist entry to approved.
   * Default AI Plan is OFF (false) for new standard users, ON (true) for admins.
   */
  static async addUser(
    email: string,
    role: string = 'user',
    hasAiPlan?: boolean,
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

    if (!ALLOWED_ROLES.has(role)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid allowlist role '${role}'. Allowed roles: 'user', 'admin'`,
      });
    }

    const validatedRole = role as AllowlistRole;
    const isAdmin =
      validatedRole === 'admin' ||
      normalized === SUPERADMIN_EMAIL.toLowerCase().trim();
    const effectiveAiPlan = isAdmin ? true : Boolean(hasAiPlan);

    const db = getAdminDb();
    const allowlistRef = db
      .collection('appSettings/allowlist/users')
      .doc(normalized);

    let shouldApproveWaitlist = false;
    let waitlistRef: FirebaseFirestore.DocumentReference | undefined;
    try {
      waitlistRef = db.doc(`appSettings/waitlist/entries/${normalized}`);
      const waitlistSnap = await waitlistRef.get();
      if (waitlistSnap && waitlistSnap.exists) {
        const rawWaitlist = (waitlistSnap.data() || {}) as Record<
          string,
          unknown
        >;
        const currentData = validateFirestoreReadPayload(
          storedWaitlistEntryDocSchema.partial(),
          rawWaitlist,
          {
            entity: 'StoredWaitlistEntryDoc',
            documentPath: `appSettings/waitlist/entries/${normalized}`,
            operation: 'read',
          },
        );
        if (currentData.status !== 'approved') {
          shouldApproveWaitlist = true;
        }
      }
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      // Non-fatal if waitlist collection is unavailable
    }

    const batch = db.batch();
    batch.set(
      allowlistRef,
      allowlistDocConverter.toFirestoreWrite(normalized, {
        role: validatedRole,
        hasAiPlan: effectiveAiPlan,
        isCreate: true,
      }),
      {merge: true},
    );
    if (shouldApproveWaitlist && waitlistRef) {
      const waitlistApprovalPayload = {
        email: normalized,
        status: 'approved' as const,
        reviewedAt: new Date().toISOString(),
      };
      validateFirestoreWritePayload(
        storedWaitlistEntryDocSchema.partial(),
        waitlistApprovalPayload,
        {
          entity: 'StoredWaitlistEntryDoc',
          documentPath: `appSettings/waitlist/entries/${normalized}`,
          operation: 'update',
        },
      );
      batch.set(waitlistRef, waitlistApprovalPayload, {merge: true});
    }
    await batch.commit();

    this.setCache(normalized, {
      isAppAllowed: true,
      isAdmin,
      hasAiPlan: effectiveAiPlan,
    });
  }

  /**
   * Updates the orthogonal AI Plan entitlement for an allowlisted user.
   */
  static async updateUserAiPlan(
    email: string,
    hasAiPlan: boolean,
  ): Promise<{email: string; hasAiPlan: boolean}> {
    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(email);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid email address',
      });
    }

    const db = getAdminDb();
    const docRef = db.collection('appSettings/allowlist/users').doc(normalized);
    const snap = await docRef.get();
    const existingData = snap?.exists
      ? allowlistDocConverter.fromFirestore(
          normalized,
          (snap.data() || {}) as Record<string, unknown>,
        )
      : undefined;
    const role: AllowlistRole = existingData?.role || 'user';
    const isAdmin =
      role === 'admin' || normalized === SUPERADMIN_EMAIL.toLowerCase().trim();
    const effectiveAiPlan = isAdmin ? true : Boolean(hasAiPlan);

    await docRef.set(
      allowlistDocConverter.toFirestoreWrite(normalized, {
        role,
        hasAiPlan: effectiveAiPlan,
        isCreate: false,
      }),
      {merge: true},
    );

    this.setCache(normalized, {
      isAppAllowed: true,
      isAdmin,
      hasAiPlan: effectiveAiPlan,
    });

    return {email: normalized, hasAiPlan: effectiveAiPlan};
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
