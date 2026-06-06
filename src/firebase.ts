import {initializeApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {
  initializeFirestore,
  getDocFromServer,
  doc,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {getStorage, ref, uploadString, getDownloadURL} from 'firebase/storage';
import {toast} from 'sonner';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);

/**
 * Uploads a base64 image data URL (e.g. data:image/png;base64,...) to Cloud Storage.
 * @param base64Data The base64 data string.
 * @param path The path in Firebase Storage (e.g. 'libraries/123/hero.png')
 */
export async function uploadBase64Image(
  base64Data: string,
  path: string,
): Promise<string> {
  if (!base64Data || !base64Data.startsWith('data:')) {
    // If it's already a URL or empty, return it directly.
    return base64Data;
  }
  const storageRef = ref(storage, path);
  await uploadString(storageRef, base64Data, 'data_url');
  return await getDownloadURL(storageRef);
}

const usePersistentCache = (() => {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV === 'test') return true;
  try {
    // If in an iframe (e.g. AI Studio preview), partitioned storage may cause IndexedDB to fail.
    // We disable local storage caching in iframes to prevent console.error messages from Firestore.
    if (window.self !== window.top) {
      return false;
    }
    if (!window.localStorage) return false;
    const testKey = '__test_local_storage__';
    window.localStorage.setItem(testKey, 'test');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
})();

export const db = initializeFirestore(
  app,
  usePersistentCache
    ? {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      }
    : {},
  firebaseConfig.firestoreDatabaseId,
);

// Validate Connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error(
        'Please check your Firebase configuration. The client is offline.',
      );
    }
    // Skip logging for other errors, as this is simply a connection test.
  }
}
void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  // Determine a polished, descriptive, localized toast message
  const pathLabel = path ? `on "${path.split('/').pop() || path}"` : '';
  const friendlyMsg = `Database operation (${operationType}) failed ${pathLabel}`;

  toast.error(friendlyMsg, {
    description: errMessage.includes('permission-denied')
      ? 'You do not have permission to modify or read this resource. Please make sure you are an owner/editor.'
      : `${errMessage}. Please check your connection and try again.`,
    duration: 6000,
  });

  throw new Error(JSON.stringify(errInfo));
}
