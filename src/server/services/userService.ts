import {getAdminDb, formatFirestoreAdminError} from './firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {
  SchemaValidationError,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import {
  storedUserProfileDocSchema,
  type UserProfile,
} from '../../schemas/libraryApi';
import {normalizeFirestoreTimestamp} from './book/bookPartitioner';

export interface StoredUserProfileWritePayload {
  uid?: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt?: unknown;
  updatedAt: unknown;
  [key: string]: unknown;
}

export const userProfileConverter = {
  toCreatePayload(user: {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
  }): StoredUserProfileWritePayload {
    const payload: StoredUserProfileWritePayload = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(storedUserProfileDocSchema, payload, {
      entity: 'StoredUserProfileDoc',
      documentPath: `/users/${user.uid}`,
      operation: 'create',
    });
    return payload;
  },

  toUpdatePayload(user: {
    email?: string;
    displayName?: string;
    photoURL?: string;
  }): StoredUserProfileWritePayload {
    const payload: StoredUserProfileWritePayload = {
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(
      storedUserProfileDocSchema.partial(),
      payload,
      {
        entity: 'StoredUserProfileDoc',
        operation: 'update',
      },
    );
    return payload;
  },

  fromFirestore(uid: string, raw: Record<string, unknown>): UserProfile {
    const createdAt = normalizeFirestoreTimestamp(raw.createdAt);
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);

    const candidate: Record<string, unknown> = {
      ...raw,
      uid,
    };
    if (typeof raw.email === 'string') {
      candidate.email = raw.email;
    } else {
      delete candidate.email;
    }
    if (typeof raw.displayName === 'string') {
      candidate.displayName = raw.displayName;
    } else {
      delete candidate.displayName;
    }
    if (typeof raw.photoURL === 'string') {
      candidate.photoURL = raw.photoURL;
    } else {
      delete candidate.photoURL;
    }
    if (createdAt !== undefined) {
      candidate.createdAt = createdAt;
    } else {
      delete candidate.createdAt;
    }
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }

    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }

    return validateFirestoreReadPayload(storedUserProfileDocSchema, candidate, {
      entity: 'StoredUserProfileDoc',
      documentPath: `/users/${uid}`,
      operation: 'read',
    });
  },
};

export class UserService {
  /**
   * Ensures a user profile document exists in `/users/{uid}`.
   */
  static async syncProfile(user: {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
  }): Promise<{success: true}> {
    if (!user?.uid) {
      return {success: true};
    }

    try {
      const db = getAdminDb();
      const userRef = db.collection('users').doc(user.uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        await userRef.set(userProfileConverter.toCreatePayload(user));
      } else {
        await userRef.update(userProfileConverter.toUpdatePayload(user));
      }
    } catch (err: unknown) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      console.warn(
        '[UserService] syncProfile error:',
        formatFirestoreAdminError(err),
      );
    }

    return {success: true};
  }

  /**
   * Retrieves user profile from `/users/{uid}`.
   */
  static async getProfile(uid: string): Promise<UserProfile | null> {
    try {
      const db = getAdminDb();
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) {
        return null;
      }
      const raw = (snap.data() || {}) as Record<string, unknown>;
      return userProfileConverter.fromFirestore(snap.id || uid, raw);
    } catch (err: unknown) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      console.warn(
        '[UserService] getProfile error:',
        formatFirestoreAdminError(err),
      );
      return null;
    }
  }
}
