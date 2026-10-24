import {TRPCError} from '@trpc/server';
import {getAdminDb, FieldValue} from '../services/firebaseAdmin';
import {AllowlistService} from './allowlistService';
import {SUPERADMIN_EMAIL} from '../../constants/auth';
import {
  validateAndNormalizeEmail,
  isSafeImageOrHttpUrl,
} from '../../schemas/common';
import type {WaitlistEntry, WaitlistStatus} from '../../schemas/waitlist';

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

      const data = (docSnap.data() || {}) as Partial<WaitlistEntry>;
      const entry: WaitlistEntry = {
        email: normalized,
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || null,
        status:
          (data.status as 'pending' | 'approved' | 'rejected') || 'pending',
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
      const existing = (existingSnap.data() || {}) as Partial<WaitlistEntry>;
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
      await docRef.set(entry, {merge: true});
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
      await docRef.set(entry);
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
        const existing = (existingSnap.data() || {}) as Partial<WaitlistEntry>;
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
        batch.set(docRef, entry, {merge: true});
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
        batch.set(docRef, entry);
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
      const data = (doc.data() || {}) as Partial<WaitlistEntry>;
      return {
        email: doc.id,
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || null,
        status:
          (data.status as 'pending' | 'approved' | 'rejected') || 'pending',
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
    const reviewedBy = params.adminEmail.toLowerCase().trim();
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
        {
          email: normalized,
          role: 'user',
          hasAiPlan: effectiveAiPlan,
          addedAt: FieldValue.serverTimestamp(),
        },
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
      {
        email: normalized,
        status: newStatus,
        reviewedAt,
        reviewedBy,
      },
      {merge: true},
    );

    await batch.commit();

    return {success: true, status: newStatus};
  }
}
