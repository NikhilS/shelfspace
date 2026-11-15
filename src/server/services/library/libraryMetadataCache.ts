import type {StoredLibraryDoc} from '../../../schemas/libraryApi';

interface CachedLibraryEntry {
  doc: StoredLibraryDoc;
  expiresAtMs: number;
}

interface DeletedBookTombstone {
  bookId: string;
  deletedAtMs: number;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOMBSTONES_PER_LIBRARY = 500;
const MAX_TOMBSTONE_LIBRARIES = 500;

function cloneStoredLibraryDoc(doc: StoredLibraryDoc): StoredLibraryDoc {
  return {
    ...doc,
    ...(doc.access ? {access: {...doc.access}} : {}),
  };
}

/**
 * Bounded L1 LRU + TTL cache for library metadata and collaborator access maps,
 * paired with a bounded tombstone ring buffer for incremental `book.syncChanges`
 * hard-delete reconciliation.
 *
 * Defaults to pass-through in Vitest unit suites so legacy tests that reuse static
 * library IDs across isolated mocks remain deterministic unless explicitly enabled.
 */
export class LibraryMetadataCache {
  private static entries = new Map<string, CachedLibraryEntry>();
  private static tombstones = new Map<string, DeletedBookTombstone[]>();
  private static enabledForTests: boolean | null = null;

  static isCacheEnabled(): boolean {
    if (this.enabledForTests !== null) {
      return this.enabledForTests;
    }
    const isTestRuntime =
      process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    return !isTestRuntime;
  }

  static setEnabledForTests(enabled: boolean | null): void {
    this.enabledForTests = enabled;
    if (!enabled) {
      this.entries.clear();
    }
  }

  static get(libraryId: string): StoredLibraryDoc | undefined {
    if (!this.isCacheEnabled() || !libraryId) {
      return undefined;
    }
    const now = Date.now();
    const entry = this.entries.get(libraryId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs <= now) {
      this.entries.delete(libraryId);
      return undefined;
    }
    // Refresh insertion order for O(1) LRU eviction
    this.entries.delete(libraryId);
    this.entries.set(libraryId, entry);
    return cloneStoredLibraryDoc(entry.doc);
  }

  static set(
    libraryId: string,
    doc: StoredLibraryDoc,
    ttlMs: number = DEFAULT_TTL_MS,
  ): void {
    if (!this.isCacheEnabled() || !libraryId) {
      return;
    }
    if (this.entries.has(libraryId)) {
      this.entries.delete(libraryId);
    } else if (this.entries.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(libraryId, {
      doc: cloneStoredLibraryDoc(doc),
      expiresAtMs: Date.now() + ttlMs,
    });
  }

  static invalidate(libraryId: string): void {
    if (!libraryId) {
      return;
    }
    this.entries.delete(libraryId);
  }

  static adjustBookCount(libraryId: string, delta: number): void {
    if (!this.isCacheEnabled() || !libraryId || delta === 0) {
      return;
    }
    const entry = this.entries.get(libraryId);
    if (!entry || entry.expiresAtMs <= Date.now()) {
      this.entries.delete(libraryId);
      return;
    }
    if (typeof entry.doc.bookCount === 'number') {
      entry.doc = {
        ...entry.doc,
        bookCount: Math.max(0, entry.doc.bookCount + delta),
        updatedAt: new Date().toISOString(),
      };
    } else {
      this.entries.delete(libraryId);
    }
  }

  static recordDeletedBooks(
    libraryId: string,
    bookIds: string[],
    deletedAtMs: number = Date.now(),
  ): void {
    if (!libraryId || bookIds.length === 0) {
      return;
    }
    const cutoffMs = deletedAtMs - TOMBSTONE_TTL_MS;
    const existing = (this.tombstones.get(libraryId) || []).filter(
      item => item.deletedAtMs > cutoffMs,
    );
    const byBookId = new Map<string, number>();
    for (const item of existing) {
      byBookId.set(item.bookId, item.deletedAtMs);
    }
    for (const rawId of bookIds) {
      const trimmed = rawId.trim();
      if (trimmed) {
        byBookId.set(trimmed, deletedAtMs);
      }
    }
    const merged: DeletedBookTombstone[] = Array.from(byBookId.entries())
      .map(([bookId, ts]) => ({bookId, deletedAtMs: ts}))
      .sort((a, b) => a.deletedAtMs - b.deletedAtMs);

    const bounded =
      merged.length > MAX_TOMBSTONES_PER_LIBRARY
        ? merged.slice(merged.length - MAX_TOMBSTONES_PER_LIBRARY)
        : merged;

    if (this.tombstones.has(libraryId)) {
      this.tombstones.delete(libraryId);
    } else if (this.tombstones.size >= MAX_TOMBSTONE_LIBRARIES) {
      const oldestLib = this.tombstones.keys().next().value;
      if (oldestLib !== undefined) {
        this.tombstones.delete(oldestLib);
      }
    }
    this.tombstones.set(libraryId, bounded);
  }

  static getDeletedBookIdsSince(libraryId: string, sinceMs: number): string[] {
    if (!libraryId) {
      return [];
    }
    const list = this.tombstones.get(libraryId);
    if (!list || list.length === 0) {
      return [];
    }
    const cutoffMs = Date.now() - TOMBSTONE_TTL_MS;
    const result: string[] = [];
    for (const item of list) {
      if (item.deletedAtMs > cutoffMs && item.deletedAtMs >= sinceMs) {
        result.push(item.bookId);
      }
    }
    return result;
  }

  static clear(): void {
    this.entries.clear();
    this.tombstones.clear();
  }
}
