import admin from 'firebase-admin';
import {getAdminDb} from '../../services/server/firebaseAdmin';
import {AllowlistService} from './allowlistService';
import type {WaitlistEntry, WaitlistStatus} from '../../schemas/waitlist';

function getDb(): FirebaseFirestore.Firestore {
  try {
    return getAdminDb();
  } catch {
    return admin.firestore();
  }
}

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

    const normalized = email.toLowerCase().trim();
    if (!normalized) {
      return {status: 'not_requested'};
    }

    // If the user is already allowlisted, report as approved
    const perms = await AllowlistService.getPermissions(normalized);
    if (perms.isAppAllowed) {
      return {status: 'approved'};
    }

    try {
      const db = getDb();
      const docSnap = await (
        db.doc(`appSettings/waitlist/entries/${normalized}`) as unknown as {
          get: () => Promise<FirebaseFirestore.DocumentSnapshot>;
        }
      ).get();

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
    const normalized = params.email.toLowerCase().trim();
    const db = getDb();
    const docRef = db
      .collection('appSettings/waitlist/entries')
      .doc(normalized);

    const existingSnap = await (
      docRef as unknown as {
        get: () => Promise<FirebaseFirestore.DocumentSnapshot>;
      }
    ).get();

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
   * Lists waitlist entries for administrator review.
   */
  static async list(
    filter?: 'pending' | 'approved' | 'rejected' | 'all',
  ): Promise<WaitlistEntry[]> {
    const db = getDb();
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
   * Approving also adds the user to the global access allowlist.
   */
  static async review(params: {
    email: string;
    action: 'approve' | 'reject';
    adminEmail: string;
  }): Promise<{success: boolean; status: 'approved' | 'rejected'}> {
    const normalized = params.email.toLowerCase().trim();
    const db = getDb();
    const reviewedAt = new Date().toISOString();
    const reviewedBy = params.adminEmail.toLowerCase().trim();
    const newStatus: 'approved' | 'rejected' =
      params.action === 'approve' ? 'approved' : 'rejected';

    if (params.action === 'approve') {
      await AllowlistService.addUser(normalized, 'user');
    }

    await db.collection('appSettings/waitlist/entries').doc(normalized).set(
      {
        email: normalized,
        status: newStatus,
        reviewedAt,
        reviewedBy,
      },
      {merge: true},
    );

    return {success: true, status: newStatus};
  }
}
