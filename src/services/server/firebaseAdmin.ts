/* firebaseAdmin.ts */
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import {initializeApp, getApps, getApp, type FirebaseApp} from 'firebase/app';
import {
  getFirestore as getClientFirestore,
  collection,
  doc,
  query,
  where,
  limit as firestoreLimit,
  orderBy as firestoreOrderBy,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  deleteField,
  increment,
  FieldPath,
  type Firestore as ClientFirestore,
  type QueryConstraint,
  type DocumentData,
  type WhereFilterOp,
} from 'firebase/firestore';

let configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(process.cwd(), '..', 'firebase-applet-config.json');
}

const firebaseConfig = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : null;

// Initialize Firebase Admin for auth token verification (verifyIdToken)
if (firebaseConfig && !admin.apps.length) {
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  } catch (err) {
    console.error('Failed to initialize Firebase Admin app:', err);
  }
}

// Export FieldValue compatible with both admin and client patterns
export const FieldValue = {
  serverTimestamp: () => serverTimestamp(),
  delete: () => deleteField(),
  increment: (n: number) => increment(n),
};

let clientApp: FirebaseApp | null = null;
let clientFirestore: ClientFirestore | null = null;

function getClientDb(): ClientFirestore {
  if (!firebaseConfig) {
    throw new Error('Firebase config not found');
  }
  if (!clientApp) {
    clientApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  if (!clientFirestore) {
    clientFirestore = getClientFirestore(
      clientApp,
      firebaseConfig.firestoreDatabaseId || '(default)',
    );
  }
  return clientFirestore;
}

function sanitizeWritePayload(val: unknown): unknown {
  if (!val || typeof val !== 'object') return val;

  // Detect admin FieldValue or client FieldValue
  const constructorName = (val as {constructor?: {name?: string}}).constructor
    ?.name;
  const methodName = (val as {_methodName?: string})._methodName;

  if (
    constructorName === 'ServerTimestampTransform' ||
    methodName === 'serverTimestamp'
  ) {
    return serverTimestamp();
  }
  if (constructorName === 'DeleteTransform' || methodName === 'delete') {
    return deleteField();
  }
  if (
    constructorName === 'NumericIncrementTransform' ||
    methodName === 'increment'
  ) {
    const operand =
      (val as {operand?: number; _operand?: number}).operand ??
      (val as {_operand?: number})._operand ??
      0;
    return increment(operand);
  }

  if (Array.isArray(val)) {
    return val.map(sanitizeWritePayload);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    result[k] = sanitizeWritePayload(v);
  }
  return result;
}

export interface AdminDocRef {
  id: string;
  path: string;
  collection(subPath: string): AdminColRef;
  get(): Promise<AdminDocSnap>;
  set(data: DocumentData, options?: {merge?: boolean}): Promise<void>;
  update(data: DocumentData): Promise<void>;
  delete(): Promise<void>;
}

export interface AdminDocSnap {
  id: string;
  exists: boolean;
  ref: AdminDocRef;
  data(): DocumentData | undefined;
}

export interface AdminQuerySnap {
  docs: AdminDocSnap[];
  empty: boolean;
  size: number;
  forEach(callback: (doc: AdminDocSnap) => void): void;
}

export interface AdminColRef {
  id: string;
  path: string;
  doc(id?: string): AdminDocRef;
  where(field: string | FieldPath, op: string, val: unknown): AdminColRef;
  limit(n: number): AdminColRef;
  orderBy(field: string | FieldPath, dir?: 'asc' | 'desc'): AdminColRef;
  get(): Promise<AdminQuerySnap>;
}

export interface AdminWriteBatch {
  set(
    ref: AdminDocRef,
    data: DocumentData,
    options?: {merge?: boolean},
  ): AdminWriteBatch;
  update(ref: AdminDocRef, data: DocumentData): AdminWriteBatch;
  delete(ref: AdminDocRef): AdminWriteBatch;
  commit(): Promise<void>;
}

function buildDocRef(db: ClientFirestore, docPath: string): AdminDocRef {
  const cDoc = doc(db, docPath);
  return {
    id: cDoc.id,
    path: cDoc.path,
    collection(subPath: string) {
      return buildColRef(db, `${docPath}/${subPath}`);
    },
    async get() {
      const snap = await getDoc(cDoc);
      return buildDocSnap(db, snap, this);
    },
    async set(data: DocumentData, options?: {merge?: boolean}) {
      const clean = sanitizeWritePayload(data) as DocumentData;
      if (options?.merge) {
        await setDoc(cDoc, clean, {merge: true});
      } else {
        await setDoc(cDoc, clean);
      }
    },
    async update(data: DocumentData) {
      const clean = sanitizeWritePayload(data) as DocumentData;
      await updateDoc(cDoc, clean);
    },
    async delete() {
      await deleteDoc(cDoc);
    },
  };
}

function buildDocSnap(
  db: ClientFirestore,
  rawSnap: {
    id: string;
    exists(): boolean;
    data(): DocumentData | undefined;
    ref: {path: string};
  },
  ref?: AdminDocRef,
): AdminDocSnap {
  const isExisting = rawSnap.exists();
  return {
    id: rawSnap.id,
    get exists() {
      return isExisting;
    },
    get ref() {
      return ref || buildDocRef(db, rawSnap.ref.path);
    },
    data() {
      return rawSnap.data();
    },
  };
}

function buildColRef(
  db: ClientFirestore,
  colPath: string,
  constraints: QueryConstraint[] = [],
): AdminColRef {
  const cCol = collection(db, colPath);

  return {
    id: cCol.id,
    path: cCol.path,
    doc(id?: string) {
      const targetPath = id ? `${colPath}/${id}` : doc(cCol).path;
      return buildDocRef(db, targetPath);
    },
    where(field: string | FieldPath, op: string, val: unknown) {
      let resolvedField: string | FieldPath = field;
      // If querying access map field with dot notation (e.g. 'access.user@example.com'), use FieldPath
      if (typeof field === 'string' && field.startsWith('access.')) {
        resolvedField = new FieldPath('access', field.slice(7));
      }
      return buildColRef(db, colPath, [
        ...constraints,
        where(resolvedField, op as WhereFilterOp, val),
      ]);
    },
    limit(n: number) {
      return buildColRef(db, colPath, [...constraints, firestoreLimit(n)]);
    },
    orderBy(field: string | FieldPath, dir?: 'asc' | 'desc') {
      return buildColRef(db, colPath, [
        ...constraints,
        firestoreOrderBy(field, dir || 'asc'),
      ]);
    },
    async get() {
      const q = constraints.length ? query(cCol, ...constraints) : cCol;
      const snap = await getDocs(q);
      const docs = snap.docs.map(d =>
        buildDocSnap(db, d, buildDocRef(db, d.ref.path)),
      );
      return {
        docs,
        empty: snap.empty,
        size: snap.size,
        forEach(callback: (doc: AdminDocSnap) => void) {
          docs.forEach(callback);
        },
      };
    },
  };
}

export interface AdminFirestoreAdapter {
  collection(colPath: string): AdminColRef;
  doc(docPath: string): AdminDocRef;
  batch(): AdminWriteBatch;
}

export const getAdminDb = (): AdminFirestoreAdapter => {
  const db = getClientDb();

  return {
    collection(colPath: string) {
      return buildColRef(db, colPath);
    },
    doc(docPath: string) {
      return buildDocRef(db, docPath);
    },
    batch(): AdminWriteBatch {
      const b = writeBatch(db);
      return {
        set(ref: AdminDocRef, data: DocumentData, options?: {merge?: boolean}) {
          const cDoc = doc(db, ref.path);
          const clean = sanitizeWritePayload(data) as DocumentData;
          if (options?.merge) {
            b.set(cDoc, clean, {merge: true});
          } else {
            b.set(cDoc, clean);
          }
          return this;
        },
        update(ref: AdminDocRef, data: DocumentData) {
          const cDoc = doc(db, ref.path);
          const clean = sanitizeWritePayload(data) as DocumentData;
          b.update(cDoc, clean);
          return this;
        },
        delete(ref: AdminDocRef) {
          const cDoc = doc(db, ref.path);
          b.delete(cDoc);
          return this;
        },
        async commit() {
          await b.commit();
        },
      };
    },
  };
};
