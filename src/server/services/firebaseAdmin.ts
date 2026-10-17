/* firebaseAdmin.ts */
import admin from 'firebase-admin';
import {
  getFirestore,
  FieldValue,
  FieldPath,
  type Firestore,
} from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(process.cwd(), '..', 'firebase-applet-config.json');
}

export const firebaseConfig = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : null;

let adminApp: admin.app.App | null = null;
let adminDb: Firestore | null = null;

export function getAdminApp(): admin.app.App {
  if (!adminApp) {
    if (admin.apps.length > 0 && admin.apps[0]) {
      adminApp = admin.apps[0];
    } else {
      const rawServiceAccount =
        process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
      if (rawServiceAccount) {
        try {
          const serviceAccount = JSON.parse(rawServiceAccount);
          adminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId:
              firebaseConfig?.projectId ||
              serviceAccount.project_id ||
              serviceAccount.projectId,
            storageBucket: firebaseConfig?.storageBucket,
          });
        } catch (err) {
          console.error(
            '[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:',
            err,
          );
        }
      }

      if (!adminApp) {
        if (firebaseConfig?.projectId) {
          adminApp = admin.initializeApp({
            projectId: firebaseConfig.projectId,
            storageBucket: firebaseConfig.storageBucket,
          });
        } else {
          adminApp = admin.initializeApp();
        }
      }
    }
  }
  return adminApp;
}

export function getAdminDb(): Firestore {
  if (!adminDb) {
    const app = getAdminApp();
    const databaseId = firebaseConfig?.firestoreDatabaseId;
    if (databaseId && databaseId !== '(default)') {
      adminDb = getFirestore(app, databaseId);
    } else {
      adminDb = getFirestore(app);
    }
    adminDb.settings({ignoreUndefinedProperties: true});
  }
  return adminDb;
}

/**
 * Enhances Firestore Admin SDK PERMISSION_DENIED errors with actionable IAM / Secret instructions.
 */
export function formatFirestoreAdminError(err: unknown): string {
  const errMsg = err instanceof Error ? err.message : String(err);
  if (
    errMsg.includes('PERMISSION_DENIED') ||
    errMsg.includes('Missing or insufficient permissions')
  ) {
    const projectId = firebaseConfig?.projectId || 'your-firebase-project';
    const sandboxSa =
      process.env.AUTHORIZED_SERVICE_ACCOUNT_EMAIL ||
      'ais-sandbox@ais-us-east1-90b1e9b198774347a.iam.gserviceaccount.com';
    return (
      `Firestore Admin SDK permission denied on project '${projectId}'. ` +
      'To enable firebase-admin in AI Studio Dev Mode, either grant "Cloud Datastore User" (roles/datastore.user) ' +
      `to '${sandboxSa}' in GCP IAM (https://console.cloud.google.com/iam-admin/iam?project=${projectId}), ` +
      'or set FIREBASE_SERVICE_ACCOUNT_KEY in the AI Studio Secrets panel.'
    );
  }
  return errMsg;
}

export {FieldValue, FieldPath};
