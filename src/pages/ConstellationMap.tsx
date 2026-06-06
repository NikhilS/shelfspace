import React from 'react';
import {useParams} from 'react-router-dom';
import {RefreshCw} from 'lucide-react';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import ConstellationChart from '../components/ConstellationChart';
import {useConstellationData} from '../hooks/useConstellationData';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/BookLoader';

export default function ConstellationMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const {loading, progress, plotData, clusterNames, handleRecluster} =
    useConstellationData(libraryId);

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />
      <div className="layout-page-content">
        <div className="layout-header border-none sm:flex-row sm:justify-between sm:items-start">
          <div>
            <h1 className="layout-header-title">Constellation Map</h1>
            <p className="layout-header-subtitle">
              An AI-generated semantic map of your books. Books with similar
              themes, genres, and synopses are clustered closer together.
              Navigating the clusters reveals organic reading paths.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleRecluster}
            disabled={loading}
            className="flex items-center gap-2 rounded-full"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Re-Cluster Map
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-3xl border border-outline-variant p-8">
            <BookLoader size="lg" className="mb-4" />
            <p className="text-on-surface-variant font-medium animate-pulse">
              {progress}
            </p>
          </div>
        ) : plotData.length < 3 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-3xl border border-outline-variant p-8">
            <p className="text-on-surface-variant font-medium">{progress}</p>
          </div>
        ) : (
          <ConstellationChart plotData={plotData} clusterNames={clusterNames} />
        )}
      </div>
    </>
  );
}
