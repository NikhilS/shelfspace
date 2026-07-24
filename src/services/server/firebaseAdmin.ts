/* firebaseAdmin.ts */
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import {getFirestore} from 'firebase-admin/firestore';

let configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(process.cwd(), '..', 'firebase-applet-config.json');
}

const firebaseConfig = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : null;

if (firebaseConfig && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

export const getAdminDb = () => {
  if (!firebaseConfig) {
    throw new Error('Firebase config not found');
  }
  return getFirestore(
    admin.app(),
    firebaseConfig.firestoreDatabaseId || '(default)',
  );
};
