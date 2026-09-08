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

export interface ClientBulkWriterOptions {
  batchSize?: number;
  autoReconcileBookCount?: boolean;
}

/**
 * A client-side helper that mimics Firestore's native BulkWriter API.
 * It manages automatically chunking operations into WriteBatches,
 * paces commits with delays to prevent stream exhaustion errors,
 * and atomically maintains library bookCount metrics upon book additions/deletions.
 */
export class ClientBulkWriter {
  private db: Firestore;
  private batchSize: number;
  private autoReconcileBookCount: boolean;
  private currentBatch: ReturnType<typeof writeBatch> | null = null;
  private currentCount = 0;
  private pendingPromises: Promise<void>[] = [];
  private bookCountDeltas = new Map<string, number>();
  private processedBookOperations = new Set<string>();

  constructor(
    db: Firestore,
    optionsOrBatchSize: number | ClientBulkWriterOptions = 400,
  ) {
    this.db = db;
    if (typeof optionsOrBatchSize === 'number') {
      this.batchSize = optionsOrBatchSize;
      this.autoReconcileBookCount = true;
    } else {
      this.batchSize = optionsOrBatchSize.batchSize ?? 400;
      this.autoReconcileBookCount =
        optionsOrBatchSize.autoReconcileBookCount ?? true;
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
    return this.currentCount;
  }

  public getBookCountDelta(libraryId: string): number {
    return this.bookCountDeltas.get(libraryId) || 0;
  }

  /**
   * Schedules addition of a new book and optional heavy details, automatically queuing an
   * atomic increment(1) on the parent library document's bookCount.
   */
  addBook<T extends DocumentData = DocumentData>(
    libraryId: string,
    bookId: string,
    bookData: WithFieldValue<T>,
    detailsData?: WithFieldValue<DocumentData>,
  ): void {
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
   * Schedules deletion of a book and its corresponding heavy details, automatically queuing an
   * atomic increment(-1) on the parent library document's bookCount.
   */
  deleteBook(libraryId: string, bookId: string): void {
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
    const batch = this.getBatch();
    batch.update(docRef, data);
    this.currentCount++;
    this.checkCommit();
  }

  delete<T = DocumentData>(docRef: DocumentReference<T>): void {
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

  private checkCommit(): void {
    if (this.currentCount >= this.batchSize) {
      const batchToCommit = this.currentBatch!;
      this.currentBatch = null;
      this.currentCount = 0;

      const commitPromise = batchToCommit.commit().then(async () => {
        // Enforce safe spacing between back-to-back batch commits on the client
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      this.pendingPromises.push(commitPromise);
    }
  }

  async close(): Promise<void> {
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
