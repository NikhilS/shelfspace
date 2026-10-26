import React, {useMemo} from 'react';
import {useParams, useSearchParams} from 'react-router-dom';
import {motion} from 'motion/react';
import {
  WifiOff,
  LibraryBig,
  Layers,
  Database,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {ErrorBoundary} from '../components/layout/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {ManualEnrichmentSection} from './spruce-up/ManualEnrichmentSection';
import {ResetMetadataSection} from './spruce-up/ResetMetadataSection';
import {PageLoading} from '../components/layout/PageLoading';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {hasHeavyLeaks} from '../lib/sanitizeStorage';

export type ShelfCareTab = 'enrichment' | 'duplicates' | 'maintenance';

function isBookMissingAnyMetadata(book: {
  coverUrl?: string;
  coverUrlRaw?: string;
  primaryGenre?: string;
  series?: string;
  geoMetadata?: {isNonEarth?: boolean; locations?: unknown[]};
  temporalMetadata?: {
    isNonHistorical?: boolean;
    startYear?: number;
    eraName?: string;
    eraLabel?: string;
    rationale?: string;
  };
  bookDetailsMetadata?: {
    hasSynopsis?: boolean;
    hasAuthorBio?: boolean;
    hasEmbedding?: boolean;
  };
  enrichmentStatus?: Record<string, string | undefined>;
}): boolean {
  const status = book.enrichmentStatus || {};
  const hasCover = Boolean(
    book.coverUrl ||
    book.coverUrlRaw ||
    status.coverImage === 'completed' ||
    status.coverImage === 'unsupported',
  );
  const hasGenre = Boolean(
    (book.primaryGenre && book.primaryGenre.trim()) ||
    status.genre === 'completed' ||
    status.genre === 'unsupported',
  );
  const hasSynopsis = Boolean(
    book.bookDetailsMetadata?.hasSynopsis ||
    status.synopsis === 'completed' ||
    status.synopsis === 'unsupported',
  );
  const hasBio = Boolean(
    book.bookDetailsMetadata?.hasAuthorBio ||
    status.authorBio === 'completed' ||
    status.authorBio === 'unsupported',
  );
  const hasGeo = Boolean(
    book.geoMetadata?.isNonEarth ||
    (Array.isArray(book.geoMetadata?.locations) &&
      book.geoMetadata.locations.length > 0) ||
    status.geo === 'completed' ||
    status.geo === 'unsupported',
  );
  const hasTemporal = Boolean(
    (book.temporalMetadata &&
      (book.temporalMetadata.isNonHistorical ||
        book.temporalMetadata.startYear !== undefined ||
        book.temporalMetadata.eraName ||
        book.temporalMetadata.eraLabel ||
        book.temporalMetadata.rationale)) ||
    status.temporal === 'completed' ||
    status.temporal === 'unsupported',
  );
  return !(
    hasCover &&
    hasGenre &&
    hasSynopsis &&
    hasBio &&
    hasGeo &&
    hasTemporal
  );
}

export function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOnline = useOnlineStatus();
  const {
    loading,
    isCheckingDuplicates,
    isAuditingCovers,
    books,
    duplicates,
    duplicateGroupsWithMeta,
    processingIds,
    handleDelete,
    handleAllowDuplicateGroup,
    handleMergeDuplicates,
  } = useSpruceUp(libraryId);

  const rawTab = searchParams.get('tab');
  const activeTab: ShelfCareTab =
    rawTab === 'duplicates' ||
    rawTab === 'maintenance' ||
    rawTab === 'enrichment'
      ? rawTab
      : 'enrichment';

  const setActiveTab = (tab: ShelfCareTab) => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      {replace: true},
    );
  };

  const incompleteCount = useMemo(() => {
    if (!books) {
      return 0;
    }
    return books.filter(isBookMissingAnyMetadata).length;
  }, [books]);

  const leaksCount = useMemo(() => {
    if (!books) {
      return 0;
    }
    return books.filter(hasHeavyLeaks).length;
  }, [books]);

  if (loading) {
    return (
      <PageLoading
        title="Opening Shelf Care..."
        subtitle="Preparing your collection workspace."
      />
    );
  }

  return (
    <div className="layout-page-content pb-24 lg:pb-8">
      <div className="layout-header mb-6">
        <div>
          <BackToLibrary libraryId={libraryId} className="mb-2" />
          <h1 className="layout-header-title">Shelf Care</h1>
          <p className="layout-header-subtitle">
            Keep your shelves in great shape—fill in missing book details, merge
            duplicate copies, and tidy up library storage.
          </p>
        </div>
      </div>

      {!isOnline && (
        <div
          role="status"
          className="mb-6 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-3 rounded-xl flex items-center gap-3 text-xs font-medium"
          data-testid="spruce-up-offline-notice"
        >
          <WifiOff className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            You&apos;re offline. Finding duplicates and filling in book details
            require an internet connection.
          </span>
        </div>
      )}

      {/* 3-Tab Curator Workspace Bar */}
      <div
        role="tablist"
        aria-label="Shelf Care Workspace Tabs"
        className="mb-6 flex flex-wrap items-center gap-2 border-b border-outline-variant/30 pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'enrichment'}
          data-testid="shelf-care-tab-enrichment"
          onClick={() => setActiveTab('enrichment')}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-sans font-semibold transition-all cursor-pointer ${
            activeTab === 'enrichment'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-outline-variant/30'
          }`}
        >
          <LibraryBig className="w-4 h-4 shrink-0" />
          <span>Missing Details</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono ${
              activeTab === 'enrichment'
                ? 'bg-on-primary/20 text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {incompleteCount > 0 ? `${incompleteCount} incomplete` : 'Complete'}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'duplicates'}
          data-testid="shelf-care-tab-duplicates"
          onClick={() => setActiveTab('duplicates')}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-sans font-semibold transition-all cursor-pointer ${
            activeTab === 'duplicates'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-outline-variant/30'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span>Duplicates</span>
          {isCheckingDuplicates ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono ${
                activeTab === 'duplicates'
                  ? 'bg-on-primary/20 text-on-primary'
                  : 'bg-primary/10 text-primary'
              }`}
              data-testid="tab-duplicates-scanning"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              Scanning
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono ${
                activeTab === 'duplicates'
                  ? 'bg-on-primary/20 text-on-primary'
                  : duplicates.length > 0
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {duplicates.length === 0 && <CheckCircle2 className="w-3 h-3" />}
              {duplicates.length} {duplicates.length === 1 ? 'group' : 'groups'}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'maintenance'}
          data-testid="shelf-care-tab-maintenance"
          onClick={() => setActiveTab('maintenance')}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-sans font-semibold transition-all cursor-pointer ${
            activeTab === 'maintenance'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-outline-variant/30'
          }`}
        >
          <Database className="w-4 h-4 shrink-0" />
          <span>Storage &amp; Reset</span>
          {leaksCount > 0 && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono ${
                activeTab === 'maintenance'
                  ? 'bg-on-primary/20 text-on-primary'
                  : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              {leaksCount}
            </span>
          )}
        </button>
      </div>

      <ErrorBoundary name="Spruce Up View Workspace">
        <motion.div
          key={activeTab}
          initial={{opacity: 0, y: 6}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.2, ease: 'easeOut'}}
        >
          {activeTab === 'enrichment' && (
            <ManualEnrichmentSection
              books={books || []}
              libraryId={libraryId!}
              isAuditingCovers={isAuditingCovers}
            />
          )}

          {activeTab === 'duplicates' && (
            <DuplicateSection
              libraryId={libraryId}
              duplicates={duplicates}
              duplicateGroupsWithMeta={duplicateGroupsWithMeta}
              processingIds={processingIds}
              isCheckingDuplicates={isCheckingDuplicates}
              handleAllowDuplicateGroup={handleAllowDuplicateGroup}
              handleDelete={handleDelete}
              handleMergeDuplicates={handleMergeDuplicates}
            />
          )}

          {activeTab === 'maintenance' && (
            <ResetMetadataSection libraryId={libraryId!} books={books || []} />
          )}
        </motion.div>
      </ErrorBoundary>
    </div>
  );
}
