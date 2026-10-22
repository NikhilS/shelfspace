import React, {useState, useMemo, useCallback, useEffect} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {useCollectionScope} from '../hooks/useCollectionScope';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {useBulkEnrichment} from '../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../components/import/BulkEnrichmentBanner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {ReadingScopeToggle} from '../components/book/ReadingScopeToggle';
import {Flame, Grid, Search} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Book} from '../types';
import {
  FlattenedLocationPin,
  MapCluster,
  WorldMapMode,
} from './world-map/types';
import {
  extractLocationPins,
  filterLocationPins,
  extractGenresList,
  computeScaleClusters,
} from './world-map/worldMapMath';
import {WorldMapCanvas} from './world-map/WorldMapCanvas';
import {WorldMapInspector} from './world-map/WorldMapInspector';

// Read API keys from the environment securely
const GOOGLE_MAPS_KEY =
  (import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY) || '';

export default function WorldMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();

  // 1. Fetch collection or reading scope data using unified hook
  const {
    isReadingMode,
    books,
    isBooksLoading,
    canEdit,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
    refetchShelf,
  } = useCollectionScope(libraryId);
  const {hasAiPlan} = useAppPermissions();

  // Map settings and presentation controls
  const [zoom, setZoom] = useState<number>(1.5);
  const [center, setCenter] = useState<{lat: number; lng: number}>({
    lat: 10,
    lng: 0,
  });
  const [selectedCluster, setSelectedCluster] = useState<MapCluster | null>(
    null,
  );
  const [selectedSinglePin, setSelectedSinglePin] =
    useState<FlattenedLocationPin | null>(null);
  const [activeTab, setActiveTab] = useState<WorldMapMode>('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('all');

  // UI states for sidebar panel details and drawer
  const [isNonEarthExpanded, setIsNonEarthExpanded] = useState(false);
  const [showApiSetupModal, setShowApiSetupModal] = useState(false);

  // 2. Scan and check for books needing automated backfill enrichment via our unified hook
  const filterGeoPredicate = useCallback((b: Book) => !b.geoMetadata, []);

  const targetEnrichmentLibId = useMemo(() => {
    if (libraryId) return libraryId;
    const missing = books.find(
      b =>
        b.libraryId &&
        b.enrichmentStatus?.geo !== 'unsupported' &&
        filterGeoPredicate(b),
    );
    return missing?.libraryId;
  }, [libraryId, books, filterGeoPredicate]);

  const enrichmentScopedBooks = useMemo(() => {
    if (libraryId) return books;
    if (!targetEnrichmentLibId) return [];
    return books.filter(b => b.libraryId === targetEnrichmentLibId);
  }, [libraryId, books, targetEnrichmentLibId]);

  const {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
  } = useBulkEnrichment({
    books: enrichmentScopedBooks,
    isBooksLoading,
    libraryId: targetEnrichmentLibId,
    providerKey: 'geoMetadata',
    metadataField: 'geoMetadata',
    filterPredicate: filterGeoPredicate,
    canEdit: Boolean(canEdit && hasAiPlan),
    successToastMessage:
      'Successfully backfilled literary settings map references!',
    errorToastMessage:
      'Gaps were found in geocoding; some settings could not be loaded.',
    onComplete: isReadingMode ? () => void refetchShelf() : undefined,
  });

  // Telemetry logs for integration with the Debug Console
  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[WorldMap] Loaded and mounted for library: ${libraryId}`,
      {libraryId},
    );
  }, [libraryId]);

  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[WorldMap] Map render mode toggled to: ${activeTab === 'map' ? 'Marker Clusters' : 'Density Heatmap'}`,
      {activeTab},
    );
  }, [activeTab]);

  // 3. Process books into flat mapping location pins
  const flattenedPins = useMemo(() => extractLocationPins(books), [books]);

  // Handle Filtering (Search + Genre filter options)
  const filteredPins = useMemo(
    () => filterLocationPins(flattenedPins, searchQuery, selectedGenre),
    [flattenedPins, searchQuery, selectedGenre],
  );

  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[WorldMap] Active filters changed: query="${searchQuery}", genre="${selectedGenre}"`,
      {searchQuery, selectedGenre, resultsCount: filteredPins.length},
    );
  }, [searchQuery, selectedGenre, filteredPins.length]);

  // Group filterable genres
  const genresList = useMemo(
    () => extractGenresList(flattenedPins),
    [flattenedPins],
  );

  // Non-Earth reference archive compiled neatly
  const nonEarthBooks = useMemo(() => {
    return books.filter(b => b.geoMetadata?.isNonEarth);
  }, [books]);

  // 4. Custom deterministic Grid-Based map clustering function
  const scaleClusters = useMemo(
    () => computeScaleClusters(filteredPins, zoom),
    [filteredPins, zoom],
  );

  const handleClusterClick = (cluster: MapCluster) => {
    setSelectedCluster(cluster);
    setSelectedSinglePin(null);

    if (cluster.pins.length === 1) {
      setSelectedSinglePin(cluster.pins[0]);
    }
  };

  const handleFallbackPinClick = (pin: FlattenedLocationPin, index: number) => {
    setSelectedSinglePin(pin);
    setSelectedCluster({
      id: `fallback-cluster-${index}`,
      center: {lat: pin.lat, lng: pin.lng},
      pins: [pin],
    });
  };

  const handleMapClick = () => {
    setSelectedCluster(null);
    setSelectedSinglePin(null);
  };

  const hasMapsApiKey = Boolean(
    GOOGLE_MAPS_KEY && GOOGLE_MAPS_KEY !== 'YOUR_API_KEY',
  );

  return (
    <div className="layout-page-content" id="world-map-layout">
      {/* Dynamic header information block */}
      <div className="layout-header border-none flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div>
          <BackToLibrary
            libraryId={libraryId}
            label={isReadingMode ? 'Back to Reading Room' : 'Back to Library'}
            className="mb-2"
          />
          <h1 className="layout-header-title">Literary World Map</h1>
          <p className="layout-header-subtitle max-w-3xl">
            {isReadingMode
              ? 'Explore the real-world cities, regions, and landscapes where the books on your reading shelf take place.'
              : 'Explore the real-world cities, regions, and landscapes where your books take place.'}
          </p>
        </div>

        {/* Presentation and Map settings toggles */}
        <div className="flex flex-col items-start md:items-end gap-2.5">
          {isReadingMode && (
            <ReadingScopeToggle
              readAndReadingCount={readAndReadingCount}
              wantToReadCount={wantToReadCount}
              includeWantToRead={includeWantToRead}
              onToggleWantToRead={setIncludeWantToRead}
            />
          )}
          <div className="bg-surface-variant p-1 rounded-lg flex border border-outline-variant">
            <button
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === 'map'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              id="toggle-cluster-view"
            >
              <Grid size={14} /> Pin Clusters
            </button>
            <button
              onClick={() => setActiveTab('heat')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all ${
                activeTab === 'heat'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              id="toggle-heatmap-view"
            >
              <Flame size={14} /> Heat Map
            </button>
          </div>
        </div>
      </div>

      {/* Backfilling and Sync progress loader indicator */}
      <BulkEnrichmentBanner
        isBackfilling={isBackfilling}
        completed={backfillProgress.completed}
        failed={backfillProgress.failed}
        total={backfillProgress.total}
        title="Scanning Literary Geographies"
        description={
          isReadingMode
            ? 'Resolving coordinates for your tracked books...'
            : 'Resolving coordinates for your library books...'
        }
        colorTheme="teal"
        className="ml-1 mb-5"
        inFlightCount={inFlightCount}
      />

      {/* Map filters and control panel */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
        <div className="md:col-span-7 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant w-4.5 h-4.5 z-10 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search setting place, book title or writer name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-xl pl-11 pr-4 py-2.5 text-sm h-11 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            id="map-places-search"
          />
        </div>

        <div className="md:col-span-5 flex gap-2">
          <Select
            value={selectedGenre}
            onValueChange={val => setSelectedGenre(val)}
          >
            <SelectTrigger
              id="map-genre-filter"
              className="w-full bg-surface-container border border-outline-variant rounded-xl px-3.5 py-2.5 text-sm h-11 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              {genresList.map(g => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Primary Interactive Map Area */}
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <WorldMapCanvas
          isBooksLoading={isBooksLoading}
          hasMapsApiKey={hasMapsApiKey}
          googleMapsKey={GOOGLE_MAPS_KEY}
          filteredPins={filteredPins}
          scaleClusters={scaleClusters}
          selectedSinglePin={selectedSinglePin}
          activeTab={activeTab}
          zoom={zoom}
          center={center}
          showApiSetupModal={showApiSetupModal}
          onSetShowApiSetupModal={setShowApiSetupModal}
          onZoomChanged={setZoom}
          onCenterChanged={setCenter}
          onClusterClick={handleClusterClick}
          onFallbackPinClick={handleFallbackPinClick}
          onMapClick={handleMapClick}
        />

        <WorldMapInspector
          selectedCluster={selectedCluster}
          selectedSinglePin={selectedSinglePin}
          nonEarthBooks={nonEarthBooks}
          isNonEarthExpanded={isNonEarthExpanded}
          onToggleNonEarthExpanded={() =>
            setIsNonEarthExpanded(!isNonEarthExpanded)
          }
          onClearSelection={() => setSelectedCluster(null)}
          onNavigateToBook={(bookId, bookLibId) => {
            const targetLibId = bookLibId || libraryId;
            if (targetLibId) {
              void navigate(`/library/${targetLibId}/book/${bookId}`);
            }
          }}
        />
      </div>
    </div>
  );
}
