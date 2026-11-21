import React, {useCallback} from 'react';
import {Link} from 'react-router-dom';
import {Loader2, Square, Wand2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {EnrichmentTier} from '../../constants/enrichment';
import {ENRICHMENT_DESCRIPTORS} from '../../constants/enrichmentDescriptors';
import {useBulkEnrichment} from '../../hooks/useBulkEnrichment';
import type {Book} from '../../types';

interface ActiveLibraryEnrichmentBannerProps {
  libraryId: string;
  books: Book[];
  canEdit: boolean;
  isAdmin: boolean;
}

function formatWaveLabel(tier: EnrichmentTier): string {
  switch (tier) {
    case 'decision':
      return 'Quick pass';
    case 'catalog':
      return 'Catalog lookup';
    case 'generative':
      return 'AI pass';
    case 'embedding':
      return 'Indexing';
    default:
      return 'Enriching';
  }
}

export function ActiveLibraryEnrichmentBanner({
  libraryId,
  books,
  canEdit,
  isAdmin,
}: ActiveLibraryEnrichmentBannerProps) {
  const neverAutoFilter = useCallback(() => false, []);

  const {
    isBackfilling,
    progress,
    activeEnrichmentType,
    activeWave,
    cancelEnrichment,
  } = useBulkEnrichment({
    books,
    isBooksLoading: false,
    libraryId,
    providerKey: 'geo',
    metadataField: 'geo',
    filterPredicate: neverAutoFilter,
    autoTrigger: false,
    autoReattach: true,
    reattachAnyType: true,
    canEdit,
  });

  if (!isBackfilling) {
    return null;
  }

  const descriptorLabel =
    ENRICHMENT_DESCRIPTORS.find(d => d.statusKey === activeEnrichmentType)
      ?.label || 'Book Details';

  const totalCount = progress.total;
  const processedCount = progress.completed + progress.failed;
  const percentage =
    totalCount > 0 ? Math.min(100, (processedCount / totalCount) * 100) : 0;

  return (
    <div
      className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-4"
      data-testid="active-library-enrichment-banner"
    >
      <div className="rounded-xl bg-surface-container-low border border-outline-variant/50 px-4 py-3 flex flex-col gap-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-sans">
            <span className="inline-flex items-center gap-1.5 font-semibold text-on-surface">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              <span>Enriching {descriptorLabel}</span>
            </span>
            {activeWave && activeWave.totalWaves > 1 && (
              <>
                <span aria-hidden="true" className="text-outline-variant">
                  ·
                </span>
                <span className="text-on-surface-variant tabular-nums">
                  Pass {activeWave.waveNumber} of {activeWave.totalWaves}:{' '}
                  {formatWaveLabel(activeWave.tier)}
                </span>
              </>
            )}
            {totalCount > 0 && (
              <>
                <span aria-hidden="true" className="text-outline-variant">
                  ·
                </span>
                <span className="font-mono text-on-surface-variant tabular-nums">
                  {progress.completed} enriched
                  {progress.failed > 0
                    ? `, ${progress.failed} unchanged`
                    : ''}{' '}
                  of {totalCount} {totalCount === 1 ? 'book' : 'books'}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {isAdmin && canEdit && (
              <Link
                to={`/library/${libraryId}/spruce-up`}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-sans font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface transition-colors whitespace-nowrap"
              >
                <Wand2 className="w-3 h-3" />
                <span>View in Shelf Care</span>
              </Link>
            )}
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void cancelEnrichment()}
                className="h-7 px-2.5 text-xs rounded-lg text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Stop</span>
              </Button>
            )}
          </div>
        </div>

        <div className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 rounded-full bg-primary transition-all duration-200"
            style={{width: `${percentage}%`}}
          />
        </div>
      </div>
    </div>
  );
}
