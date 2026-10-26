import {TRPCError} from '@trpc/server';
import {getAdminDb} from '../services/firebaseAdmin';
import {AllowlistService, allowlistDocConverter} from './allowlistService';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {
  SchemaValidationError,
  validateAndNormalizeEmail,
  isSafeImageOrHttpUrl,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import {
  storedWaitlistEntryDocSchema,
  type StoredWaitlistEntryDoc,
  type WaitlistEntry,
  type WaitlistStatus,
} from '../../schemas/waitlist';
import {normalizeFirestoreTimestamp} from '../services/book/bookPartitioner';

export const waitlistDocConverter = {
  toFirestoreWrite<T extends object>(
    email: string,
    payload: T,
    operation: 'create' | 'update' | 'upsert' = 'upsert',
  ): T {
    validateFirestoreWritePayload(
      operation === 'update'
        ? storedWaitlistEntryDocSchema.partial()
        : storedWaitlistEntryDocSchema,
      payload,
      {
        entity: 'StoredWaitlistEntryDoc',
        documentPath: `appSettings/waitlist/entries/${email}`,
        operation,
      },
    );
    return payload;
  },

  fromFirestore(
    email: string,
    raw: Record<string, unknown>,
  ): StoredWaitlistEntryDoc {
    const requestedAt =
      normalizeFirestoreTimestamp(raw.requestedAt) ??
      (typeof raw.requestedAt === 'string'
        ? raw.requestedAt
        : new Date().toISOString());
    const reviewedAt =
      raw.reviewedAt === null
        ? null
        : normalizeFirestoreTimestamp(raw.reviewedAt);

    const candidate: Record<string, unknown> = {
      ...raw,
      email:
        typeof raw.email === 'string' && raw.email.trim() ? raw.email : email,
      status:
        typeof raw.status === 'string' && raw.status.trim()
          ? raw.status
          : 'pending',
      requestedAt,
    };

    if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
      candidate.displayName = raw.displayName;
    } else {
      delete candidate.displayName;
    }
    if (typeof raw.photoURL === 'string' || raw.photoURL === null) {
      candidate.photoURL = raw.photoURL;
    } else {
      delete candidate.photoURL;
    }
    if (reviewedAt !== undefined) {
      candidate.reviewedAt = reviewedAt;
    } else {
      delete candidate.reviewedAt;
    }
    if (typeof raw.reviewedBy === 'string' || raw.reviewedBy === null) {
      candidate.reviewedBy = raw.reviewedBy;
    } else {
      delete candidate.reviewedBy;
    }
    if (typeof raw.invitedBy === 'string' || raw.invitedBy === null) {
      candidate.invitedBy = raw.invitedBy;
    } else {
      delete candidate.invitedBy;
    }
    if (
      typeof raw.invitedLibraryName === 'string' ||
      raw.invitedLibraryName === null
    ) {
      candidate.invitedLibraryName = raw.invitedLibraryName;
    } else {
      delete candidate.invitedLibraryName;
    }

    for (const k of Object.keys(candidate)) {
      if (candidate[k] === undefined) {
        delete candidate[k];
      }
    }

    return validateFirestoreReadPayload(
      storedWaitlistEntryDocSchema,
      candidate,
      {
        entity: 'StoredWaitlistEntryDoc',
        documentPath: `appSettings/waitlist/entries/${email}`,
        operation: 'read',
      },
    );
  },
};

export class WaitlistService {
  /**
   * Retrieves current waitlist status for a given email.
   * If the user is already on the allowlist, returns status 'approved'.
   */
  static async getStatus(email?: string | null): Promise<{
    status: WaitlistStatus;
    entry?: WaitlistEntry;
  }> {
    if (!email) {
      return {status: 'not_requested'};
    }

    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(email);
    } catch {
      return {status: 'not_requested'};
    }

    // If the user is already allowlisted, report as approved
    const perms = await AllowlistService.getPermissions(normalized);
    if (perms.isAppAllowed) {
      return {status: 'approved'};
    }

    try {
      const db = getAdminDb();
      const docSnap = await db
        .doc(`appSettings/waitlist/entries/${normalized}`)
        .get();

      if (!docSnap || !docSnap.exists) {
        return {status: 'not_requested'};
      }

      const data = waitlistDocConverter.fromFirestore(
        normalized,
        (docSnap.data() || {}) as Record<string, unknown>,
      );
      const entry: WaitlistEntry = {
        email: normalized,
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || null,
        status: data.status,
        requestedAt: data.requestedAt || new Date().toISOString(),
        reviewedAt: data.reviewedAt || null,
        reviewedBy: data.reviewedBy || null,
        ...(data.invitedBy ? {invitedBy: data.invitedBy} : {}),
        ...(data.invitedLibraryName
          ? {invitedLibraryName: data.invitedLibraryName}
          : {}),
      };

      return {
        status: entry.status,
        entry,
      };
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      console.error(
        '[WaitlistService] Error querying waitlist for email:',
        normalized,
        err,
      );
      return {status: 'not_requested'};
    }
  }

  /**
   * Adds or updates a user in the waitlist with pending status.
   */
  static async join(params: {
    email: string;
    displayName?: string;
    photoURL?: string | null;
  }): Promise<WaitlistEntry> {
    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(params.email);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid email address',
      });
    }

    if (params.photoURL && !isSafeImageOrHttpUrl(params.photoURL)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid photoURL protocol',
      });
    }

    const db = getAdminDb();
    const docRef = db
      .collection('appSettings/waitlist/entries')
      .doc(normalized);

    const existingSnap = await docRef.get();

    const now = new Date().toISOString();
    let entry: WaitlistEntry;

    if (existingSnap && existingSnap.exists) {
      const existing = waitlistDocConverter.fromFirestore(
        normalized,
        (existingSnap.data() || {}) as Record<string, unknown>,
      );
      entry = {
        email: normalized,
        displayName: params.displayName || existing.displayName || undefined,
        photoURL:
          params.photoURL !== undefined
            ? params.photoURL
            : existing.photoURL || null,
        status: existing.status || 'pending',
        requestedAt: existing.requestedAt || now,
        reviewedAt: existing.reviewedAt || null,
        reviewedBy: existing.reviewedBy || null,
        ...(existing.invitedBy ? {invitedBy: existing.invitedBy} : {}),
        ...(existing.invitedLibraryName
          ? {invitedLibraryName: existing.invitedLibraryName}
          : {}),
      };
      await docRef.set(
        waitlistDocConverter.toFirestoreWrite(normalized, entry, 'upsert'),
        {merge: true},
      );
    } else {
      entry = {
        email: normalized,
        displayName: params.displayName || undefined,
        photoURL: params.photoURL || null,
        status: 'pending',
        requestedAt: now,
        reviewedAt: null,
        reviewedBy: null,
      };
      await docRef.set(
        waitlistDocConverter.toFirestoreWrite(normalized, entry, 'create'),
      );
    }

    return entry;
  }

  /**
   * Ensures an invited collaborator who is not yet on the global allowlist
   * has a pending waitlist entry with invitation context for admin review.
   */
  static async ensureInvitedEntry(params: {
    email: string;
    invitedByEmail?: string;
    libraryName?: string;
  }): Promise<WaitlistEntry> {
    const entries = await this.ensureInvitedEntriesBulk([params]);
    return entries[0];
  }

  /**
   * Bulk-ensures multiple invited collaborators have pending waitlist entries
   * using a single db.getAll() read and a single db.batch() commit.
   */
  static async ensureInvitedEntriesBulk(
    items: Array<{
      email: string;
      invitedByEmail?: string;
      libraryName?: string;
    }>,
  ): Promise<WaitlistEntry[]> {
    if (!items || items.length === 0) {
      return [];
    }

    const normalizedItems: Array<{
      email: string;
      invitedBy: string | null;
      invitedLibraryName: string | null;
    }> = [];
    const seen = new Set<string>();

    for (const item of items) {
      let normalized: string;
      try {
        normalized = validateAndNormalizeEmail(item.email);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Invalid email address',
        });
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      normalizedItems.push({
        email: normalized,
        invitedBy: item.invitedByEmail?.toLowerCase().trim() || null,
        invitedLibraryName: item.libraryName?.trim() || null,
      });
    }

    if (normalizedItems.length === 0) {
      return [];
    }

    const db = getAdminDb();
    const entriesCol = db.collection('appSettings/waitlist/entries');
    const docRefs = normalizedItems.map(item => entriesCol.doc(item.email));
    const existingSnaps = await db.getAll(...docRefs);

    const now = new Date().toISOString();
    const batch = db.batch();
    const results: WaitlistEntry[] = [];

    for (let i = 0; i < normalizedItems.length; i++) {
      const {email, invitedBy, invitedLibraryName} = normalizedItems[i];
      const docRef = docRefs[i];
      const existingSnap = existingSnaps[i];

      if (existingSnap && existingSnap.exists) {
        const existing = waitlistDocConverter.fromFirestore(
          email,
          (existingSnap.data() || {}) as Record<string, unknown>,
        );
        const entry: WaitlistEntry = {
          email,
          displayName: existing.displayName || undefined,
          photoURL: existing.photoURL || null,
          status: existing.status === 'approved' ? 'approved' : 'pending',
          requestedAt: existing.requestedAt || now,
          reviewedAt: existing.reviewedAt || null,
          reviewedBy: existing.reviewedBy || null,
          invitedBy: invitedBy || existing.invitedBy || null,
          invitedLibraryName:
            invitedLibraryName || existing.invitedLibraryName || null,
        };
        batch.set(
          docRef,
          waitlistDocConverter.toFirestoreWrite(email, entry, 'upsert'),
          {merge: true},
        );
        results.push(entry);
      } else {
        const entry: WaitlistEntry = {
          email,
          status: 'pending',
          requestedAt: now,
          reviewedAt: null,
          reviewedBy: null,
          invitedBy,
          invitedLibraryName,
        };
        batch.set(
          docRef,
          waitlistDocConverter.toFirestoreWrite(email, entry, 'create'),
        );
        results.push(entry);
      }
    }

    await batch.commit();
    return results;
  }

  /**
   * Lists waitlist entries for administrator review.
   */
  static async list(
    filter?: 'pending' | 'approved' | 'rejected' | 'all',
  ): Promise<WaitlistEntry[]> {
    const db = getAdminDb();
    const snap = await db.collection('appSettings/waitlist/entries').get();

    const entries: WaitlistEntry[] = snap.docs.map(doc => {
      const data = waitlistDocConverter.fromFirestore(
        doc.id,
        (doc.data() || {}) as Record<string, unknown>,
      );
      return {
        email: doc.id,
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || null,
        status: data.status,
        requestedAt: data.requestedAt || '',
        reviewedAt: data.reviewedAt || null,
        reviewedBy: data.reviewedBy || null,
        ...(data.invitedBy ? {invitedBy: data.invitedBy} : {}),
        ...(data.invitedLibraryName
          ? {invitedLibraryName: data.invitedLibraryName}
          : {}),
      };
    });

    // Sort newest requests first
    entries.sort((a, b) =>
      (b.requestedAt || '').localeCompare(a.requestedAt || ''),
    );

    if (!filter || filter === 'all') {
      return entries;
    }

    return entries.filter(e => e.status === filter);
  }

  /**
   * Reviews a waitlist entry (approve or reject).
   * Approving also adds the user to the global access allowlist in a single atomic batch.
   */
  static async review(params: {
    email: string;
    action: 'approve' | 'reject';
    adminEmail: string;
    hasAiPlan?: boolean;
  }): Promise<{success: boolean; status: 'approved' | 'rejected'}> {
    let normalized: string;
    try {
      normalized = validateAndNormalizeEmail(params.email);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid email address',
      });
    }

    const db = getAdminDb();
    const reviewedAt = new Date().toISOString();
    const reviewedBy = validateAndNormalizeEmail(params.adminEmail);
    const newStatus: 'approved' | 'rejected' =
      params.action === 'approve' ? 'approved' : 'rejected';

    const batch = db.batch();
    const waitlistRef = db
      .collection('appSettings/waitlist/entries')
      .doc(normalized);

    if (params.action === 'approve') {
      const isAdmin = normalized === SUPERADMIN_EMAIL.toLowerCase().trim();
      const effectiveAiPlan = isAdmin ? true : Boolean(params.hasAiPlan);
      const allowlistRef = db
        .collection('appSettings/allowlist/users')
        .doc(normalized);

      batch.set(
        allowlistRef,
        allowlistDocConverter.toFirestoreWrite(normalized, {
          role: 'user',
          hasAiPlan: effectiveAiPlan,
          isCreate: true,
        }),
        {merge: true},
      );

      AllowlistService.setCache(normalized, {
        isAppAllowed: true,
        isAdmin,
        hasAiPlan: effectiveAiPlan,
      });
    }

    batch.set(
      waitlistRef,
      waitlistDocConverter.toFirestoreWrite(
        normalized,
        {
          email: normalized,
          status: newStatus,
          reviewedAt,
          reviewedBy,
        },
        'update',
      ),
      {merge: true},
    );

    await batch.commit();

    return {success: true, status: newStatus};
  }
}
