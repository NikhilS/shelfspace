/**
 * @fileoverview Spec-compliant in-memory Firestore engine for server unit tests.
 * Replaces fragile 5-line mock objects and eliminates the need for production
 * `typeof col.where === 'function'` or `typeof query.onSnapshot === 'function'` guards.
 */

import {
  cloneValue,
  comparePrimitives,
  createFakeTimestamp,
  extractFieldSegments,
  type FakeTimestamp,
  getCollectionPathFromDocPath,
  getDocIdFromPath,
  getNestedValue,
  matchesWhereClause,
  normalizePath,
  normalizeUpdateArgs,
  type OrderByClause,
  type QueryOptions,
  setBySegments,
  type WhereOp,
} from './fakeFirestoreHelpers';

export {createFakeTimestamp, type FakeTimestamp};

export class FakeDocumentSnapshot {
  readonly id: string;
  readonly ref: FakeDocumentReference;
  readonly exists: boolean;
  private readonly rawData: Record<string, unknown> | undefined;

  constructor(
    ref: FakeDocumentReference,
    rawData: Record<string, unknown> | undefined,
  ) {
    this.id = ref.id;
    this.ref = ref;
    this.exists = rawData !== undefined;
    this.rawData = rawData ? cloneValue(rawData) : undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.rawData ? cloneValue(this.rawData) : undefined;
  }

  get(fieldPath: string): unknown {
    if (!this.rawData) {
      return undefined;
    }
    return getNestedValue(
      this.id,
      this.rawData,
      extractFieldSegments(fieldPath),
    );
  }
}

export class FakeQuerySnapshot {
  readonly docs: FakeDocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;

  constructor(docs: FakeDocumentSnapshot[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(callback: (doc: FakeDocumentSnapshot) => void): void {
    for (const doc of this.docs) {
      callback(doc);
    }
  }
}

export class FakeDocumentReference {
  readonly id: string;
  readonly path: string;
  private readonly store: FakeFirestore;

  constructor(store: FakeFirestore, docPath: string) {
    this.store = store;
    this.path = normalizePath(docPath);
    this.id = getDocIdFromPath(this.path);
  }

  collection(subcollectionName: string): FakeCollectionReference {
    return new FakeCollectionReference(
      this.store,
      `${this.path}/${normalizePath(subcollectionName)}`,
    );
  }

  async get(): Promise<FakeDocumentSnapshot> {
    return this.store.readDocSnapshot(this);
  }

  async set(
    data: Record<string, unknown>,
    options?: {merge?: boolean},
  ): Promise<void> {
    this.store.writeDoc(this.path, data, Boolean(options?.merge), false);
  }

  async update(
    dataOrField: Record<string, unknown> | unknown,
    ...moreFieldsAndValues: unknown[]
  ): Promise<void> {
    const normalizedUpdate = normalizeUpdateArgs(
      dataOrField,
      moreFieldsAndValues,
    );
    this.store.writeDoc(this.path, normalizedUpdate, true, true);
  }

  async delete(): Promise<void> {
    this.store.deleteDoc(this.path);
  }

  onSnapshot(
    onNext: (snapshot: FakeDocumentSnapshot) => void,
    onError?: (err: Error) => void,
  ): () => void {
    void onError;
    return this.store.registerDocListener(this, onNext);
  }
}

export class FakeQuery {
  protected readonly store: FakeFirestore;
  protected readonly collectionPath: string;
  protected readonly options: QueryOptions;

  constructor(
    store: FakeFirestore,
    collectionPath: string,
    options?: Partial<QueryOptions>,
  ) {
    this.store = store;
    this.collectionPath = normalizePath(collectionPath);
    this.options = {
      wheres: options?.wheres ? [...options.wheres] : [],
      orderBys: options?.orderBys ? [...options.orderBys] : [],
      limitCount: options?.limitCount,
      startAfterValues: options?.startAfterValues,
      selectedFields: options?.selectedFields,
    };
  }

  where(fieldPath: unknown, opStr: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, {
      ...this.options,
      wheres: [
        ...this.options.wheres,
        {
          segments: extractFieldSegments(fieldPath),
          op: opStr,
          value,
        },
      ],
    });
  }

  orderBy(fieldPath: unknown, directionStr: 'asc' | 'desc' = 'asc'): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, {
      ...this.options,
      orderBys: [
        ...this.options.orderBys,
        {
          segments: extractFieldSegments(fieldPath),
          direction: directionStr,
        },
      ],
    });
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, {
      ...this.options,
      limitCount: n,
    });
  }

  startAfter(...values: unknown[]): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, {
      ...this.options,
      startAfterValues: values,
    });
  }

  select(...fieldPaths: unknown[]): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, {
      ...this.options,
      selectedFields: fieldPaths.map(fp => extractFieldSegments(fp)),
    });
  }

  count(): {get: () => Promise<{data: () => {count: number}}>} {
    return {
      get: async () => {
        const snap = await this.get();
        return {
          data: () => ({count: snap.size}),
        };
      },
    };
  }

  async get(): Promise<FakeQuerySnapshot> {
    return this.store.executeQuery(this.collectionPath, this.options);
  }

  onSnapshot(
    onNext: (snapshot: FakeQuerySnapshot) => void,
    onError?: (err: Error) => void,
  ): () => void {
    void onError;
    return this.store.registerQueryListener(
      this.collectionPath,
      this.options,
      onNext,
    );
  }
}

export class FakeCollectionReference extends FakeQuery {
  readonly id: string;
  readonly path: string;

  constructor(store: FakeFirestore, collectionPath: string) {
    super(store, collectionPath);
    this.path = normalizePath(collectionPath);
    this.id = getDocIdFromPath(this.path);
  }

  doc(docId?: string): FakeDocumentReference {
    const resolvedId =
      docId && docId.trim().length > 0 ? docId.trim() : this.store.nextAutoId();
    return new FakeDocumentReference(this.store, `${this.path}/${resolvedId}`);
  }

  async add(data: Record<string, unknown>): Promise<FakeDocumentReference> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

type QueuedWriteOp =
  | {
      kind: 'set';
      path: string;
      data: Record<string, unknown>;
      merge: boolean;
    }
  | {
      kind: 'update';
      path: string;
      data: Record<string, unknown>;
    }
  | {
      kind: 'delete';
      path: string;
    };

export class FakeWriteBatch {
  private readonly store: FakeFirestore;
  private readonly ops: QueuedWriteOp[] = [];

  constructor(store: FakeFirestore) {
    this.store = store;
  }

  set(
    ref: FakeDocumentReference,
    data: Record<string, unknown>,
    options?: {merge?: boolean},
  ): this {
    this.ops.push({
      kind: 'set',
      path: ref.path,
      data,
      merge: Boolean(options?.merge),
    });
    return this;
  }

  update(
    ref: FakeDocumentReference,
    dataOrField: Record<string, unknown> | unknown,
    ...moreFieldsAndValues: unknown[]
  ): this {
    this.ops.push({
      kind: 'update',
      path: ref.path,
      data: normalizeUpdateArgs(dataOrField, moreFieldsAndValues),
    });
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.ops.push({
      kind: 'delete',
      path: ref.path,
    });
    return this;
  }

  async commit(): Promise<void> {
    this.store.commitBatchOps(this.ops);
  }
}

export class FakeTransaction {
  private readonly store: FakeFirestore;
  private readonly ops: QueuedWriteOp[] = [];

  constructor(store: FakeFirestore) {
    this.store = store;
  }

  async get(
    refOrQuery: FakeDocumentReference | FakeQuery,
  ): Promise<FakeDocumentSnapshot | FakeQuerySnapshot> {
    if (refOrQuery instanceof FakeDocumentReference) {
      return refOrQuery.get();
    }
    return refOrQuery.get();
  }

  async getAll(
    ...refs: FakeDocumentReference[]
  ): Promise<FakeDocumentSnapshot[]> {
    return this.store.getAll(...refs);
  }

  set(
    ref: FakeDocumentReference,
    data: Record<string, unknown>,
    options?: {merge?: boolean},
  ): this {
    this.ops.push({
      kind: 'set',
      path: ref.path,
      data,
      merge: Boolean(options?.merge),
    });
    return this;
  }

  update(
    ref: FakeDocumentReference,
    dataOrField: Record<string, unknown> | unknown,
    ...moreFieldsAndValues: unknown[]
  ): this {
    this.ops.push({
      kind: 'update',
      path: ref.path,
      data: normalizeUpdateArgs(dataOrField, moreFieldsAndValues),
    });
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.ops.push({
      kind: 'delete',
      path: ref.path,
    });
    return this;
  }

  flush(): void {
    this.store.commitBatchOps(this.ops);
  }
}

interface DocListenerEntry {
  ref: FakeDocumentReference;
  callback: (snapshot: FakeDocumentSnapshot) => void;
}

interface QueryListenerEntry {
  collectionPath: string;
  options: QueryOptions;
  callback: (snapshot: FakeQuerySnapshot) => void;
}

export class FakeFirestore {
  private readonly docs = new Map<string, Record<string, unknown>>();
  private readonly docListeners = new Set<DocListenerEntry>();
  private readonly queryListeners = new Set<QueryListenerEntry>();
  private autoIdCounter = 0;

  nextAutoId(): string {
    this.autoIdCounter += 1;
    return `fake_doc_${this.autoIdCounter}`;
  }

  collection(collectionPath: string): FakeCollectionReference {
    return new FakeCollectionReference(this, collectionPath);
  }

  doc(docPath: string): FakeDocumentReference {
    return new FakeDocumentReference(this, docPath);
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this);
  }

  async getAll(
    ...refs: FakeDocumentReference[]
  ): Promise<FakeDocumentSnapshot[]> {
    return refs.map(ref => this.readDocSnapshot(ref));
  }

  async runTransaction<Result>(
    updateFunction: (transaction: FakeTransaction) => Promise<Result>,
  ): Promise<Result> {
    const tx = new FakeTransaction(this);
    const result = await updateFunction(tx);
    tx.flush();
    return result;
  }

  readDocSnapshot(ref: FakeDocumentReference): FakeDocumentSnapshot {
    return new FakeDocumentSnapshot(ref, this.docs.get(ref.path));
  }

  seedDoc(docPath: string, data: Record<string, unknown>): void {
    this.writeDoc(normalizePath(docPath), data, false, false);
  }

  inspectDoc(docPath: string): Record<string, unknown> | undefined {
    const found = this.docs.get(normalizePath(docPath));
    return found ? cloneValue(found) : undefined;
  }

  clearAll(): void {
    this.docs.clear();
  }

  writeDoc(
    rawPath: string,
    incomingData: Record<string, unknown>,
    merge: boolean,
    requireExisting: boolean,
  ): void {
    const path = normalizePath(rawPath);
    const existing = this.docs.get(path);
    if (requireExisting && !existing) {
      throw new Error(`5 NOT_FOUND: No document to update: ${path}`);
    }

    const nextDoc: Record<string, unknown> =
      merge && existing ? cloneValue(existing) : {};

    for (const [key, val] of Object.entries(incomingData)) {
      if (requireExisting && key.includes('.')) {
        setBySegments(nextDoc, key.split('.').filter(Boolean), val, false);
      } else if (merge && key.includes('.')) {
        setBySegments(nextDoc, key.split('.').filter(Boolean), val, true);
      } else {
        setBySegments(nextDoc, [key], val, merge && !requireExisting);
      }
    }

    this.docs.set(path, nextDoc);
    this.notifyListeners(new Set([path]));
  }

  deleteDoc(rawPath: string): void {
    const path = normalizePath(rawPath);
    if (this.docs.delete(path)) {
      this.notifyListeners(new Set([path]));
    }
  }

  commitBatchOps(ops: QueuedWriteOp[]): void {
    const touchedPaths = new Set<string>();
    for (const op of ops) {
      const path = normalizePath(op.path);
      touchedPaths.add(path);
      if (op.kind === 'delete') {
        this.docs.delete(path);
        continue;
      }
      const existing = this.docs.get(path);
      if (op.kind === 'update' && !existing) {
        throw new Error(`5 NOT_FOUND: No document to update: ${path}`);
      }
      const isMerge = op.kind === 'update' || op.merge;
      const nextDoc: Record<string, unknown> =
        isMerge && existing ? cloneValue(existing) : {};

      for (const [key, val] of Object.entries(op.data)) {
        if (op.kind === 'update' && key.includes('.')) {
          setBySegments(nextDoc, key.split('.').filter(Boolean), val, false);
        } else if (isMerge && key.includes('.')) {
          setBySegments(nextDoc, key.split('.').filter(Boolean), val, true);
        } else {
          setBySegments(nextDoc, [key], val, op.kind === 'set' && op.merge);
        }
      }
      this.docs.set(path, nextDoc);
    }

    if (touchedPaths.size > 0) {
      this.notifyListeners(touchedPaths);
    }
  }

  executeQuery(
    rawCollectionPath: string,
    options: QueryOptions,
  ): FakeQuerySnapshot {
    const targetCollectionPath = normalizePath(rawCollectionPath);
    const matchingEntries: Array<{
      id: string;
      path: string;
      data: Record<string, unknown>;
    }> = [];

    for (const [docPath, data] of this.docs.entries()) {
      if (getCollectionPathFromDocPath(docPath) !== targetCollectionPath) {
        continue;
      }
      const docId = getDocIdFromPath(docPath);
      const passesAll = options.wheres.every(clause =>
        matchesWhereClause(docId, data, clause),
      );
      if (passesAll) {
        matchingEntries.push({id: docId, path: docPath, data});
      }
    }

    const effectiveOrders: OrderByClause[] =
      options.orderBys.length > 0
        ? options.orderBys
        : [{segments: ['__name__'], direction: 'asc'}];

    matchingEntries.sort((a, b) => {
      for (const order of effectiveOrders) {
        const valA = getNestedValue(a.id, a.data, order.segments);
        const valB = getNestedValue(b.id, b.data, order.segments);
        const cmp = comparePrimitives(valA, valB);
        if (cmp !== 0) {
          return order.direction === 'desc' ? -cmp : cmp;
        }
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    let sliced = matchingEntries;
    if (options.startAfterValues && options.startAfterValues.length > 0) {
      const firstArg = options.startAfterValues[0];
      if (
        firstArg &&
        typeof firstArg === 'object' &&
        'id' in (firstArg as Record<string, unknown>) &&
        typeof (firstArg as {data?: unknown}).data === 'function'
      ) {
        const cursorId = String((firstArg as {id: string}).id);
        const cursorIndex = sliced.findIndex(entry => entry.id === cursorId);
        if (cursorIndex >= 0) {
          sliced = sliced.slice(cursorIndex + 1);
        }
      } else {
        const cursorValues = options.startAfterValues;
        sliced = sliced.filter(entry => {
          for (let i = 0; i < cursorValues.length; i++) {
            const order = effectiveOrders[i] || {
              segments: ['__name__'],
              direction: 'asc',
            };
            const entryVal = getNestedValue(
              entry.id,
              entry.data,
              order.segments,
            );
            const cmp = comparePrimitives(entryVal, cursorValues[i]);
            if (cmp !== 0) {
              return order.direction === 'desc' ? cmp < 0 : cmp > 0;
            }
          }
          return false;
        });
      }
    }

    if (typeof options.limitCount === 'number' && options.limitCount >= 0) {
      sliced = sliced.slice(0, options.limitCount);
    }

    const snapshots = sliced.map(entry => {
      const ref = new FakeDocumentReference(this, entry.path);
      if (!options.selectedFields || options.selectedFields.length === 0) {
        return new FakeDocumentSnapshot(ref, entry.data);
      }
      const projected: Record<string, unknown> = {};
      for (const segments of options.selectedFields) {
        const value = getNestedValue(entry.id, entry.data, segments);
        if (value !== undefined) {
          setBySegments(projected, segments, value, false);
        }
      }
      return new FakeDocumentSnapshot(ref, projected);
    });

    return new FakeQuerySnapshot(snapshots);
  }

  registerDocListener(
    ref: FakeDocumentReference,
    callback: (snapshot: FakeDocumentSnapshot) => void,
  ): () => void {
    const entry: DocListenerEntry = {ref, callback};
    this.docListeners.add(entry);
    queueMicrotask(() => {
      if (this.docListeners.has(entry)) {
        callback(this.readDocSnapshot(ref));
      }
    });
    return () => {
      this.docListeners.delete(entry);
    };
  }

  registerQueryListener(
    collectionPath: string,
    options: QueryOptions,
    callback: (snapshot: FakeQuerySnapshot) => void,
  ): () => void {
    const normalizedCol = normalizePath(collectionPath);
    const entry: QueryListenerEntry = {
      collectionPath: normalizedCol,
      options,
      callback,
    };
    this.queryListeners.add(entry);
    queueMicrotask(() => {
      if (this.queryListeners.has(entry)) {
        callback(this.executeQuery(normalizedCol, options));
      }
    });
    return () => {
      this.queryListeners.delete(entry);
    };
  }

  private notifyListeners(touchedDocPaths: Set<string>): void {
    const touchedCollections = new Set<string>();
    for (const p of touchedDocPaths) {
      touchedCollections.add(getCollectionPathFromDocPath(p));
    }

    for (const entry of this.docListeners) {
      if (touchedDocPaths.has(entry.ref.path)) {
        const snap = this.readDocSnapshot(entry.ref);
        queueMicrotask(() => {
          if (this.docListeners.has(entry)) {
            entry.callback(snap);
          }
        });
      }
    }

    for (const entry of this.queryListeners) {
      if (touchedCollections.has(entry.collectionPath)) {
        const snap = this.executeQuery(entry.collectionPath, entry.options);
        queueMicrotask(() => {
          if (this.queryListeners.has(entry)) {
            entry.callback(snap);
          }
        });
      }
    }
  }
}

export function createFakeFirestore(): {
  db: FirebaseFirestore.Firestore;
  fake: FakeFirestore;
} {
  const fake = new FakeFirestore();
  return {
    db: fake as unknown as FirebaseFirestore.Firestore,
    fake,
  };
}
