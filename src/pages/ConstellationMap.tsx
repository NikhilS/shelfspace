import React from 'react';
import {useParams, Link} from 'react-router-dom';
import {ArrowLeft, Loader2, RefreshCw} from 'lucide-react';
import SidebarActions from '../components/SidebarActions';
import ConstellationChart from '../components/ConstellationChart';
import {useConstellationData} from '../hooks/useConstellationData';

export default function ConstellationMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const {loading, progress, plotData, clusterNames, handleRecluster} =
    useConstellationData(libraryId);

  return (
    <>
      <SidebarActions>
        <Link
          to={`/library/${libraryId}`}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-display text-on-surface mb-2">
              Constellation Map
            </h1>
            <p className="text-on-surface-variant text-sm max-w-xl">
              An AI-generated semantic map of your books. Books with similar
              themes, genres, and synopses are clustered closer together.
              Navigating the clusters reveals organic reading paths.
            </p>
          </div>

          <button
            onClick={handleRecluster}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-surface-container hover:bg-surface-variant text-on-surface text-sm font-medium rounded-full transition-colors border border-outline-variant disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Re-cluster Map
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-3xl border border-outline-variant p-8">
            <Loader2 size={48} className="text-primary animate-spin mb-4" />
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
