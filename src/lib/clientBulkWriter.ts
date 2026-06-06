import {
  writeBatch,
  Firestore,
  DocumentReference,
  DocumentData,
  WithFieldValue,
  UpdateData,
} from 'firebase/firestore';

/**
 * A client-side helper that mimics Firestore's native BulkWriter API.
 * It manages automatically chunking operations into WriteBatches,
 * and paces commits with delays to prevent stream exhaustion errors.
 */
export class ClientBulkWriter {
  private db: Firestore;
  private batchSize: number;
  private currentBatch: ReturnType<typeof writeBatch> | null = null;
  private currentCount = 0;
  private pendingPromises: Promise<void>[] = [];

  constructor(db: Firestore, batchSize = 400) {
    this.db = db;
    this.batchSize = batchSize;
  }

  private getBatch(): ReturnType<typeof writeBatch> {
    if (!this.currentBatch) {
      this.currentBatch = writeBatch(this.db);
    }
    return this.currentBatch;
  }

  set<T = DocumentData>(
    docRef: DocumentReference<T>,
    data: WithFieldValue<T>,
    options?: {merge?: boolean},
  ): void {
    const batch = this.getBatch();
    if (options?.merge) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      batch.set(docRef, data as any, {merge: true});
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      batch.set(docRef, data as any);
    }
    this.currentCount++;
    this.checkCommit();
  }

  update<T = DocumentData>(
    docRef: DocumentReference<T>,
    data: UpdateData<T>,
  ): void {
    const batch = this.getBatch();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch.update(docRef, data as any);
    this.currentCount++;
    this.checkCommit();
  }

  delete<T = DocumentData>(docRef: DocumentReference<T>): void {
    const batch = this.getBatch();
    batch.delete(docRef);
    this.currentCount++;
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
    if (this.currentBatch && this.currentCount > 0) {
      const batchToCommit = this.currentBatch!;
      this.currentBatch = null;
      this.currentCount = 0;
      this.pendingPromises.push(batchToCommit.commit());
    }
    await Promise.all(this.pendingPromises);
  }
}
