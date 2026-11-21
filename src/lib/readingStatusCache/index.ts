export type {
  CanonicalReadingStatus,
  CommitBookDeleteDeltaParams,
  CommitBookReviewDeltaParams,
  CommitBookUpsertDeltaParams,
  CommitReadingStatusDeltaParams,
  OptimisticBookEditParams,
  OptimisticReadingStatusParams,
  ReadingStatusCacheUtils,
  TrpcCacheSlot,
} from './types';

export {
  buildBookSnapshotHint,
  normalizeReadingStatus,
  patchBookInListCache,
  recalculateShelfCounts,
} from './snapshotHelpers';

export {
  commitBookDeleteDelta,
  commitBookReviewDelta,
  commitBookUpsertDelta,
  commitReadingStatusDelta,
  invalidateReadingStatusQueries,
  removeBookFromReadingCaches,
} from './deltaCommitters';

export {
  applyOptimisticBookEditPatch,
  applyOptimisticReadingStatusPatch,
} from './optimisticPatches';
