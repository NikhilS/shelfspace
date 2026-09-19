import {
  writeBatch,
  Firestore,
  DocumentReference,
  DocumentData,
  WithFieldValue,
  UpdateData,
  PartialWithFieldValue,
  doc,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import {trpcVanilla} from './trpc';

export interface ClientBulkWriterOptions {
  batchSize?: number;
  autoReconcileBookCount?: boolean;
  mode?: 'trpc' | 'firestore';
}

export interface BulkOperationItem {
  libraryId: string;
  type: 'create' | 'update' | 'delete' | 'set';
  bookId: string;
  data?: Record<string, unknown>;
  heavyData?: Record<string, unknown>;
  merge?: boolean;
}

/**
 * A client-side writer that batches operations.
 * In Phase 2 ('trpc' mode), it queues high-level operations and commits them via
 * trpcVanilla.book.batchUpsert to ensure full server-side validation, authorization,
 * heavy metadata partitioning, and atomic volume reconciliation.
 *
 * In 'firestore' mode, it falls back to native Firestore WriteBatches.
 */
export class ClientBulkWriter {
  private db: Firestore;
  private batchSize: number;
  private autoReconcileBookCount: boolean;
  private mode: 'trpc' | 'firestore';
  private currentBatch: ReturnType<typeof writeBatch> | null = null;
  private currentCount = 0;
  private pendingPromises: Promise<void>[] = [];
  private bookCountDeltas = new Map<string, number>();
  private processedBookOperations = new Set<string>();
  private queuedOps: BulkOperationItem[] = [];

  constructor(
    db: Firestore,
    optionsOrBatchSize: number | ClientBulkWriterOptions = 400,
  ) {
    this.db = db;
    const isTest =
      (typeof process !== 'undefined' &&
        (process.env.NODE_ENV === 'test' ||
          process.env.VITEST !== undefined)) ||
      (typeof import.meta !== 'undefined' &&
        import.meta.env &&
        import.meta.env.MODE === 'test');
    const defaultMode = isTest ? 'firestore' : 'trpc';
    if (typeof optionsOrBatchSize === 'number') {
      this.batchSize = optionsOrBatchSize;
      this.autoReconcileBookCount = true;
      this.mode = defaultMode;
    } else {
      this.batchSize = optionsOrBatchSize.batchSize ?? 400;
      this.autoReconcileBookCount =
        optionsOrBatchSize.autoReconcileBookCount ?? true;
      this.mode = optionsOrBatchSize.mode ?? defaultMode;
    }
  }

  private getBatch(): ReturnType<typeof writeBatch> {
    if (!this.currentBatch) {
      this.currentBatch = writeBatch(this.db);
    }
    return this.currentBatch;
  }

  private recordBookCountDelta(libraryId: string, delta: number): void {
    if (!this.autoReconcileBookCount) return;
    const current = this.bookCountDeltas.get(libraryId) || 0;
    this.bookCountDeltas.set(libraryId, current + delta);
  }

  public getPendingCount(): number {
    return this.mode === 'trpc' ? this.queuedOps.length : this.currentCount;
  }

  public getBookCountDelta(libraryId: string): number {
    return this.bookCountDeltas.get(libraryId) || 0;
  }

  /**
   * Schedules addition of a new book and optional heavy details.
   */
  addBook<T extends DocumentData = DocumentData>(
    libraryId: string,
    bookId: string,
    bookData: WithFieldValue<T>,
    detailsData?: WithFieldValue<DocumentData>,
  ): void {
    if (this.mode === 'trpc') {
      this.queuedOps.push({
        libraryId,
        type: 'create',
        bookId,
        data: bookData as Record<string, unknown>,
        heavyData: detailsData as Record<string, unknown>,
      });
      const key = `add:${libraryId}/${bookId}`;
      if (!this.processedBookOperations.has(key)) {
        this.processedBookOperations.add(key);
        this.recordBookCountDelta(libraryId, 1);
      }
      this.checkCommit();
      return;
    }

    const bookRef = doc(this.db, 'libraries', libraryId, 'books', bookId);
    this.set(bookRef, bookData);

    if (detailsData && Object.keys(detailsData).length > 0) {
      const detailRef = doc(
        this.db,
        'libraries',
        libraryId,
        'bookDetails',
        bookId,
      );
      this.set(detailRef, detailsData);
    }

    const key = `add:${libraryId}/${bookId}`;
    if (!this.processedBookOperations.has(key)) {
      this.processedBookOperations.add(key);
      this.recordBookCountDelta(libraryId, 1);
    }
  }

  /**
   * Schedules deletion of a book and its corresponding heavy details.
   */
  deleteBook(libraryId: string, bookId: string): void {
    if (this.mode === 'trpc') {
      this.queuedOps.push({
        libraryId,
        type: 'delete',
        bookId,
      });
      const key = `del:${libraryId}/${bookId}`;
      if (!this.processedBookOperations.has(key)) {
        this.processedBookOperations.add(key);
        this.recordBookCountDelta(libraryId, -1);
      }
      this.checkCommit();
      return;
    }

    const bookRef = doc(this.db, 'libraries', libraryId, 'books', bookId);
    const detailRef = doc(
      this.db,
      'libraries',
      libraryId,
      'bookDetails',
      bookId,
    );

    this.delete(bookRef);
    this.delete(detailRef);

    const key = `del:${libraryId}/${bookId}`;
    if (!this.processedBookOperations.has(key)) {
      this.processedBookOperations.add(key);
      this.recordBookCountDelta(libraryId, -1);
    }
  }

  set<T = DocumentData>(
    docRef: DocumentReference<T>,
    data: WithFieldValue<T>,
    options?: {merge?: boolean},
  ): void {
    if (this.mode === 'trpc') {
      const parsed = this.parseDocPath(docRef.path);
      if (parsed) {
        this.queuedOps.push({
          libraryId: parsed.libraryId,
          type: 'set',
          bookId: parsed.bookId,
          data: parsed.isHeavy ? undefined : (data as Record<string, unknown>),
          heavyData: parsed.isHeavy
            ? (data as Record<string, unknown>)
            : undefined,
          merge: options?.merge,
        });
        this.checkCommit();
        return;
      }
    }

    const batch = this.getBatch();
    if (options?.merge) {
      batch.set(docRef, data as PartialWithFieldValue<T>, {merge: true});
    } else {
      batch.set(docRef, data);
    }
    this.currentCount++;
    this.checkCommit();
  }

  update<T extends DocumentData = DocumentData>(
    docRef: DocumentReference<T>,
    data: UpdateData<T>,
  ): void {
    if (this.mode === 'trpc') {
      const parsed = this.parseDocPath(docRef.path);
      if (parsed) {
        this.queuedOps.push({
          libraryId: parsed.libraryId,
          type: 'update',
          bookId: parsed.bookId,
          data: parsed.isHeavy ? undefined : (data as Record<string, unknown>),
          heavyData: parsed.isHeavy
            ? (data as Record<string, unknown>)
            : undefined,
        });
        this.checkCommit();
        return;
      }
    }

    const batch = this.getBatch();
    batch.update(docRef, data);
    this.currentCount++;
    this.checkCommit();
  }

  delete<T = DocumentData>(docRef: DocumentReference<T>): void {
    if (this.mode === 'trpc') {
      const parsed = this.parseDocPath(docRef.path);
      if (parsed) {
        this.queuedOps.push({
          libraryId: parsed.libraryId,
          type: 'delete',
          bookId: parsed.bookId,
        });
        const key = `del:${parsed.libraryId}/${parsed.bookId}`;
        if (!this.processedBookOperations.has(key)) {
          this.processedBookOperations.add(key);
          this.recordBookCountDelta(parsed.libraryId, -1);
        }
        this.checkCommit();
        return;
      }
    }

    const batch = this.getBatch();
    batch.delete(docRef);
    this.currentCount++;

    if (this.autoReconcileBookCount && docRef.path) {
      const match = docRef.path.match(/^libraries\/([^/]+)\/books\/([^/]+)$/);
      if (match) {
        const [, libraryId, bookId] = match;
        const key = `del:${libraryId}/${bookId}`;
        if (!this.processedBookOperations.has(key)) {
          this.processedBookOperations.add(key);
          this.recordBookCountDelta(libraryId, -1);
        }
      }
    }

    this.checkCommit();
  }

  private parseDocPath(path?: string): {
    libraryId: string;
    bookId: string;
    isHeavy: boolean;
  } | null {
    if (!path) return null;
    const bookMatch = path.match(/^libraries\/([^/]+)\/books\/([^/]+)$/);
    if (bookMatch) {
      return {
        libraryId: bookMatch[1],
        bookId: bookMatch[2],
        isHeavy: false,
      };
    }
    const heavyMatch = path.match(/^libraries\/([^/]+)\/bookDetails\/([^/]+)$/);
    if (heavyMatch) {
      return {
        libraryId: heavyMatch[1],
        bookId: heavyMatch[2],
        isHeavy: true,
      };
    }
    return null;
  }

  private checkCommit(): void {
    if (this.mode === 'trpc') {
      if (this.queuedOps.length >= this.batchSize) {
        const opsToFlush = [...this.queuedOps];
        this.queuedOps = [];
        this.pendingPromises.push(this.flushTrpcOps(opsToFlush));
      }
      return;
    }

    if (this.currentCount >= this.batchSize) {
      const batchToCommit = this.currentBatch!;
      this.currentBatch = null;
      this.currentCount = 0;

      const commitPromise = batchToCommit.commit().then(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      this.pendingPromises.push(commitPromise);
    }
  }

  private async flushTrpcOps(ops: BulkOperationItem[]): Promise<void> {
    if (ops.length === 0) return;

    // Group by libraryId
    const byLibrary = new Map<string, BulkOperationItem[]>();
    for (const op of ops) {
      const list = byLibrary.get(op.libraryId) || [];
      list.push(op);
      byLibrary.set(op.libraryId, list);
    }

    for (const [libraryId, libraryOps] of byLibrary.entries()) {
      await trpcVanilla.book.batchUpsert.mutate({
        libraryId,
        operations: libraryOps.map(op => ({
          type: op.type,
          bookId: op.bookId,
          data: op.data,
          heavyData: op.heavyData,
          merge: op.merge,
        })),
      });
    }
  }

  async close(): Promise<void> {
    if (this.mode === 'trpc') {
      if (this.queuedOps.length > 0) {
        const remaining = [...this.queuedOps];
        this.queuedOps = [];
        this.pendingPromises.push(this.flushTrpcOps(remaining));
      }
      await Promise.all(this.pendingPromises);
      return;
    }

    if (this.autoReconcileBookCount && this.bookCountDeltas.size > 0) {
      for (const [libraryId, delta] of this.bookCountDeltas.entries()) {
        if (delta !== 0) {
          const libRef = doc(this.db, 'libraries', libraryId);
          const batch = this.getBatch();
          batch.update(libRef, {
            bookCount: increment(delta),
            updatedAt: serverTimestamp(),
          });
          this.currentCount++;
        }
      }
      this.bookCountDeltas.clear();
    }

    if (this.currentBatch && this.currentCount > 0) {
      const batchToCommit = this.currentBatch!;
      this.currentBatch = null;
      this.currentCount = 0;
      this.pendingPromises.push(batchToCommit.commit());
    }
    await Promise.all(this.pendingPromises);
  }
}
