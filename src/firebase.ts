import {initializeApp} from 'firebase/app';
import {getAuth, connectAuthEmulator} from 'firebase/auth';
import {getStorage, connectStorageEmulator} from 'firebase/storage';
import {toast} from 'sonner';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Deprecated: Client-side Firestore eliminated in favor of the Unified tRPC/OpenAPI Gateway
export const db = null as unknown;

if (process.env.NODE_ENV === 'test') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

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
