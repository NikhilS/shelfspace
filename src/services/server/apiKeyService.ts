import crypto from 'node:crypto';
import {getAdminDb} from './firebaseAdmin';

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  keyPrefix: string;
  keySuffix: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface GeneratedApiKeyResponse {
  id: string;
  key: string; // Present ONLY on creation
  keyPrefix: string;
  keySuffix: string;
  name: string;
  createdAt: string;
}

export class ApiKeyService {
  /**
   * Generates a cryptographically secure secret API key prefixed with 'lib_live_'
   * Stores SHA-256 hash in Firestore 'apiKeys' collection.
   */
  static async generateApiKey(
    ownerId: string,
    ownerEmail: string,
    name: string,
  ): Promise<GeneratedApiKeyResponse> {
    const randomHex = crypto.randomBytes(32).toString('hex');
    const rawKey = `lib_live_${randomHex}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const keyPrefix = rawKey.substring(0, 16);
    const keySuffix = rawKey.substring(rawKey.length - 4);
    const createdAt = new Date().toISOString();

    const db = getAdminDb();
    const docRef = db.collection('apiKeys').doc(keyHash);

    const record: ApiKeyRecord = {
      id: keyHash,
      keyHash,
      keyPrefix,
      keySuffix,
      name,
      ownerId,
      ownerEmail,
      createdAt,
      lastUsedAt: null,
      revoked: false,
    };

    await docRef.set(record);

    return {
      id: keyHash,
      key: rawKey,
      keyPrefix,
      keySuffix,
      name,
      createdAt,
    };
  }

  /**
   * Validates a raw secret API key.
   * Returns user context if valid and active, or null if invalid/revoked.
   */
  static async validateApiKey(rawKey: string): Promise<{
    uid: string;
    email: string;
    apiKeyId: string;
  } | null> {
    if (
      !rawKey ||
      typeof rawKey !== 'string' ||
      !rawKey.startsWith('lib_live_')
    ) {
      return null;
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const db = getAdminDb();
    const docSnap = await db.collection('apiKeys').doc(keyHash).get();

    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data() as ApiKeyRecord;

    if (data.revoked) {
      return null;
    }

    // Touch lastUsedAt timestamp asynchronously
    const now = new Date().toISOString();
    docSnap.ref.update({lastUsedAt: now}).catch((err: unknown) => {
      console.error(
        '[ApiKeyService] Failed to update lastUsedAt timestamp:',
        err,
      );
    });

    return {
      uid: data.ownerId,
      email: data.ownerEmail,
      apiKeyId: keyHash,
    };
  }

  /**
   * Lists all API key records owned by a specific user.
   */
  static async listApiKeys(
    ownerId: string,
  ): Promise<Omit<ApiKeyRecord, 'keyHash'>[]> {
    const db = getAdminDb();
    const snap = await db
      .collection('apiKeys')
      .where('ownerId', '==', ownerId)
      .get();

    const keys: Omit<ApiKeyRecord, 'keyHash'>[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as ApiKeyRecord;
      keys.push({
        id: docSnap.id,
        keyPrefix: data.keyPrefix,
        keySuffix: data.keySuffix,
        name: data.name,
        ownerId: data.ownerId,
        ownerEmail: data.ownerEmail,
        createdAt: data.createdAt,
        lastUsedAt: data.lastUsedAt || null,
        revoked: data.revoked,
      });
    });

    // Sort by createdAt descending
    keys.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return keys;
  }

  /**
   * Revokes an API key owned by a specific user.
   */
  static async revokeApiKey(ownerId: string, keyId: string): Promise<boolean> {
    const db = getAdminDb();
    const docRef = db.collection('apiKeys').doc(keyId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new Error('API key not found');
    }

    const data = docSnap.data() as ApiKeyRecord;
    if (data.ownerId !== ownerId) {
      throw new Error('Unauthorized: You do not own this API key');
    }

    await docRef.update({revoked: true});
    return true;
  }
}
