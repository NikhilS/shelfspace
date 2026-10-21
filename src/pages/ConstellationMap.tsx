import React, {Suspense, lazy} from 'react';
import {useParams} from 'react-router-dom';
import {RefreshCw} from 'lucide-react';
import {useConstellationData} from '../hooks/useConstellationData';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/book/BookLoader';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {ReadingScopeToggle} from '../components/book/ReadingScopeToggle';

const ConstellationChart = lazy(
  () => import('./constellations/ConstellationChart'),
);

export default function ConstellationMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const {
    loading,
    progress,
    plotData,
    clusterNames,
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
              ? 'An AI-generated celestial atlas of your personal reading life. Books with kindred themes, genres, and synopses form connected constellations and semantic reading paths.'
              : 'An AI-generated celestial atlas of your library. Books with kindred themes, genres, and synopses form connected constellations and semantic reading paths.'}
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
            disabled={loading}
            className="flex items-center gap-2 rounded-lg whitespace-nowrap shrink-0"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Re-Cluster Map
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
        <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-2xl border border-outline-variant p-8">
          <p className="text-on-surface-variant font-medium">{progress}</p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-2xl border border-outline-variant p-8">
              <BookLoader size="lg" className="mb-4" />
              <p className="text-on-surface-variant font-medium animate-pulse">
                Loading Celestial Chart Engine...
              </p>
            </div>
          }
        >
          <ConstellationChart
            plotData={plotData}
            clusterNames={clusterNames}
            libraryId={libraryId}
          />
        </Suspense>
      )}
    </div>
  );
}
