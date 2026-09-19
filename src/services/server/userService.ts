import {getAdminDb} from './firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';

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
    const db = getAdminDb();
    const userRef = db.collection('users').doc(user.uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.update({
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {success: true};
  }

  /**
   * Retrieves user profile from `/users/{uid}`.
   */
  static async getProfile(
    uid: string,
  ): Promise<Record<string, unknown> | null> {
    const db = getAdminDb();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) {
      return null;
    }
    return {uid: snap.id, ...snap.data()};
  }
}
