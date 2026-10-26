import React, {Suspense, lazy} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {RefreshCw, Plus} from 'lucide-react';
import {useConstellationData} from '../hooks/useConstellationData';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {Button} from '@/components/ui/button';
import {ConstellationSkyIllustration} from '@/components/ui/empty-state-illustrations';
import {BookLoader} from '../components/book/BookLoader';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {ReadingScopeToggle} from '../components/book/ReadingScopeToggle';

const ConstellationChart = lazy(() =>
  import('./constellations/ConstellationChart').then(m => ({
    default: m.ConstellationChart,
  })),
);

export function ConstellationMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const {
    loading,
    progress,
    plotData,
    clusterNames,
    clusterTheses,
    crossClusterBridges,
    handleRecluster,
    isReadingMode,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
  } = useConstellationData(libraryId);

  return (
    <div className="layout-page-content">
      <div className="layout-header border-none sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <BackToLibrary
            libraryId={libraryId}
            label={isReadingMode ? 'Back to Reading Room' : 'Back to Library'}
            className="mb-2"
          />
          <h1 className="layout-header-title">Constellation Map</h1>
          <p className="layout-header-subtitle">
            {isReadingMode
              ? 'A star map of your reading life—books with kindred themes and stories cluster together into constellations.'
              : 'A star map of your library—books with kindred themes and stories cluster together into constellations.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isReadingMode && (
            <ReadingScopeToggle
              readAndReadingCount={readAndReadingCount}
              wantToReadCount={wantToReadCount}
              includeWantToRead={includeWantToRead}
              onToggleWantToRead={setIncludeWantToRead}
            />
          )}
          <Button
            variant="outline"
            onClick={handleRecluster}
            disabled={loading || !isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            className="flex items-center gap-2 rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh Map
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-2xl border border-outline-variant p-8">
          <BookLoader size="lg" className="mb-4" />
          <p className="text-on-surface-variant font-medium animate-pulse">
            {progress}
          </p>
        </div>
      ) : plotData.length < 3 ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container-low rounded-2xl border border-outline-variant/50 p-8 text-center">
          <ConstellationSkyIllustration className="mb-3" />
          <h2 className="font-serif text-xl font-semibold text-on-surface mb-1.5">
            A Few More Books Needed
          </h2>
          <p className="font-sans text-sm text-on-surface-variant max-w-md leading-relaxed mb-5">
            {progress}
          </p>
          <Button
            type="button"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={() =>
              void navigate(
                isReadingMode || !libraryId
                  ? '/reading/add?status=want_to_read'
                  : `/library/${libraryId}/add`,
              )
            }
            className="gap-2 rounded-lg font-sans font-semibold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{isReadingMode ? 'Track More Books' : 'Add More Books'}</span>
          </Button>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-2xl border border-outline-variant p-8">
              <BookLoader size="lg" className="mb-4" />
              <p className="text-on-surface-variant font-medium animate-pulse">
                Charting your constellations...
              </p>
            </div>
          }
        >
          <ConstellationChart
            plotData={plotData}
            clusterNames={clusterNames}
            clusterTheses={clusterTheses}
            crossClusterBridges={crossClusterBridges}
            libraryId={libraryId}
          />
        </Suspense>
      )}
    </div>
  );
}
