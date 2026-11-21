import {useEntityCacheStore} from '../../stores/entityCacheStore';
import type {ReadingShelfSummary} from '../../types';
import {commitReadingStatusDeltaInternal} from './deltaCommitters';
import {normalizeReadingStatus, patchBookInListCache} from './snapshotHelpers';
import type {
  OptimisticBookEditParams,
  OptimisticReadingStatusParams,
  ReadingStatusCacheUtils,
} from './types';

/**
 * Optimistically synchronizes a reading status change across the normalized
 * `useEntityCacheStore` and coupled TanStack Query projections:
 * - `book.get({ libraryId, bookId })`
 * - `book.list({ libraryId })`
 * - `readingTracker.getShelf({ shelf: 'all' })`
 * - `readingTracker.getUnreadLibraryBooks(undefined)`
 *
 * Returns a version-guarded rollback closure that restores pre-mutation state
 * unless superseded by a newer mutation on the same entity.
 */
export function applyOptimisticReadingStatusPatch(
  utils: ReadingStatusCacheUtils | undefined,
  params: OptimisticReadingStatusParams,
): () => void {
  if (!utils || !params.libraryId || !params.bookId) {
    return () => {};
  }

  const {libraryId, bookId, reviewedAtIso, bookHint} = params;
  const normalizedStatus = normalizeReadingStatus(params.status);

  const prevBookGet = utils.book?.get?.getData?.({libraryId, bookId});
  const prevBookList = utils.book?.list?.getData?.({libraryId});
  const prevShelfAll = utils.readingTracker?.getShelf?.getData?.({
    shelf: 'all',
  });
  const prevUnread =
    utils.readingTracker?.getUnreadLibraryBooks?.getData?.(undefined);

  const entityPatch = commitReadingStatusDeltaInternal(
    utils,
    {
      libraryId,
      bookId,
      status: normalizedStatus,
      reviewedAt: reviewedAtIso,
      bookHint,
    },
    {isOptimistic: true},
  );

  return () => {
    if (entityPatch) {
      const didRollback = useEntityCacheStore
        .getState()
        .rollbackEntitySnapshot(entityPatch.snapshot, entityPatch.version);
      if (!didRollback) {
        // Newer mutation superseded this optimistic patch; skip stale cache rollback
        return;
      }
    }
    if (prevBookGet !== undefined) {
      utils.book?.get?.setData?.({libraryId, bookId}, prevBookGet);
    }
    if (prevBookList !== undefined) {
      utils.book?.list?.setData?.({libraryId}, prevBookList);
    }
    if (prevShelfAll !== undefined) {
      utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, prevShelfAll);
    }
    if (prevUnread !== undefined) {
      utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
        undefined,
        prevUnread,
      );
    }
  };
}

/**
 * Optimistically synchronizes a single-book edit across `useEntityCacheStore`,
 * `book.get`, `book.list`, `readingTracker.getShelf`, and `readingTracker.getUnreadLibraryBooks`.
 *
 * Returns a version-guarded rollback closure that will NOT clobber newer
 * authoritative mutations committed while the optimistic edit was in flight.
 */
export function applyOptimisticBookEditPatch(
  utils: ReadingStatusCacheUtils | undefined,
  params: OptimisticBookEditParams,
): () => void {
  if (!utils || !params.libraryId || !params.bookId) {
    return () => {};
  }

  const {libraryId, bookId, patch, bookHint} = params;

  const prevBookGet = utils.book?.get?.getData?.({libraryId, bookId});
  const prevBookList = utils.book?.list?.getData?.({libraryId});
  const prevShelfAll = utils.readingTracker?.getShelf?.getData?.({
    shelf: 'all',
  });
  const prevUnread =
    utils.readingTracker?.getUnreadLibraryBooks?.getData?.(undefined);

  const entityPatch = useEntityCacheStore
    .getState()
    .patchBookOptimistically(libraryId, bookId, patch);

  if (patch.readingStatus !== undefined) {
    commitReadingStatusDeltaInternal(
      utils,
      {
        libraryId,
        bookId,
        status: patch.readingStatus,
        bookHint: {...bookHint, ...patch},
      },
      {isOptimistic: true, skipEntityPatch: true},
    );
  }

  utils.book?.get?.setData?.({libraryId, bookId}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    return {
      ...(old as Record<string, unknown>),
      ...patch,
    };
  });

  utils.book?.list?.setData?.({libraryId}, (old: unknown) =>
    patchBookInListCache(old, bookId, existing => ({
      ...existing,
      ...patch,
      synopsis:
        patch.synopsis !== undefined
          ? (patch.synopsis ?? undefined)
          : existing.synopsis,
      authorBio:
        patch.authorBio !== undefined
          ? (patch.authorBio ?? undefined)
          : existing.authorBio,
      embedding:
        patch.embedding !== undefined
          ? (patch.embedding ?? undefined)
          : existing.embedding,
      clusterCoordinates:
        patch.clusterCoordinates !== undefined
          ? (patch.clusterCoordinates ?? undefined)
          : existing.clusterCoordinates,
    })),
  );

  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const summary = old as ReadingShelfSummary;
    if (!Array.isArray(summary.items)) {
      return old;
    }
    const idx = summary.items.findIndex(
      item => item.id === bookId && item.libraryId === libraryId,
    );
    if (idx === -1) {
      return old;
    }
    return {
      ...summary,
      items: summary.items.map((item, i) =>
        i === idx
          ? {
              ...item,
              ...(patch.title !== undefined ? {title: patch.title} : {}),
              ...(patch.author !== undefined ? {author: patch.author} : {}),
              ...(patch.coverUrl !== undefined
                ? {coverUrl: patch.coverUrl}
                : {}),
              ...(patch.isbn !== undefined ? {isbn: patch.isbn} : {}),
              ...(patch.primaryGenre !== undefined
                ? {primaryGenre: patch.primaryGenre}
                : {}),
              ...(patch.subgenres !== undefined
                ? {subgenres: patch.subgenres}
                : {}),
              ...(patch.series !== undefined ? {series: patch.series} : {}),
              ...(patch.synopsis !== undefined
                ? {synopsis: patch.synopsis}
                : {}),
            }
          : item,
      ),
    };
  });

  return () => {
    const didRollback = useEntityCacheStore
      .getState()
      .rollbackEntitySnapshot(entityPatch.snapshot, entityPatch.version);
    if (!didRollback) {
      return;
    }
    if (prevBookGet !== undefined) {
      utils.book?.get?.setData?.({libraryId, bookId}, prevBookGet);
    }
    if (prevBookList !== undefined) {
      utils.book?.list?.setData?.({libraryId}, prevBookList);
    }
    if (prevShelfAll !== undefined) {
      utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, prevShelfAll);
    }
    if (prevUnread !== undefined) {
      utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
        undefined,
        prevUnread,
      );
    }
  };
}
