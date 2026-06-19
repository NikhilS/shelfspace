import React, {useState, useMemo, useCallback, useEffect} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {useAuth} from '../stores/authStore';
import {useLibraryData} from '../hooks/useLibraryData';
import {useBulkEnrichment} from '../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../components/BulkEnrichmentBanner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {
  MapPin,
  Flame,
  Grid,
  Search,
  ChevronRight,
  Globe,
  BookOpen,
  X,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/BookLoader';
import {Book} from '../types';
import {APIProvider, Map, AdvancedMarker} from '@vis.gl/react-google-maps';

// Read API keys from the environment securely
const GOOGLE_MAPS_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  '';

interface FlatteredLocationPin {
  book: Book;
  name: string;
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;
  lat: number;
  lng: number;
}

interface MapCluster {
  id: string;
  center: {lat: number; lng: number};
  pins: FlatteredLocationPin[];
}

export default function WorldMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();
  const {user} = useAuth();

  // 1. Fetch library core data using existing hook
  const {books, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

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
    useState<FlatteredLocationPin | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'heat'>('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('all');

  // UI states for sidebar panel details and drawer
  const [isNonEarthExpanded, setIsNonEarthExpanded] = useState(false);
  const [showApiSetupModal, setShowApiSetupModal] = useState(false);

  // 2. Scan and check for books needing automated backfill enrichment via our unified hook
  const filterGeoPredicate = useCallback((b: Book) => !b.geoMetadata, []);

  const {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
  } = useBulkEnrichment({
    books,
    isBooksLoading,
    libraryId,
    providerKey: 'geoMetadata',
    metadataField: 'geoMetadata',
    batchSize: 10,
    concurrencyLimit: 5,
    filterPredicate: filterGeoPredicate,
    successToastMessage:
      'Successfully backfilled literary settings map references!',
    errorToastMessage:
      'Gaps were found in geocoding; some settings could not be loaded.',
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
  const flattenedPins = useMemo<FlatteredLocationPin[]>(() => {
    const list: FlatteredLocationPin[] = [];
    for (const b of books) {
      if (
        b.geoMetadata &&
        !b.geoMetadata.isNonEarth &&
        Array.isArray(b.geoMetadata.locations)
      ) {
        for (const loc of b.geoMetadata.locations) {
          if (
            loc.coordinates?.lat !== undefined &&
            loc.coordinates?.lng !== undefined
          ) {
            list.push({
              book: b,
              name: loc.name,
              adminLevel: loc.adminLevel,
              rationale: loc.rationale,
              lat: loc.coordinates.lat,
              lng: loc.coordinates.lng,
            });
          }
        }
      }
    }
    return list;
  }, [books]);

  // Handle Filtering (Search + Genre filter options)
  const filteredPins = useMemo(() => {
    return flattenedPins.filter(pin => {
      const matchesSearch =
        pin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pin.book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (pin.book.author || '')
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesGenre =
        selectedGenre === 'all' ||
        (pin.book.genres &&
          pin.book.genres.some(
            g => g.toLowerCase() === selectedGenre.toLowerCase(),
          ));

      return matchesSearch && matchesGenre;
    });
  }, [flattenedPins, searchQuery, selectedGenre]);

  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[WorldMap] Active filters changed: query="${searchQuery}", genre="${selectedGenre}"`,
      {searchQuery, selectedGenre, resultsCount: filteredPins.length},
    );
  }, [searchQuery, selectedGenre, filteredPins.length]);

  // Group filterable genres
  const genresList = useMemo(() => {
    const set = new Set<string>();
    for (const pin of flattenedPins) {
      if (Array.isArray(pin.book.genres)) {
        pin.book.genres.forEach(g => set.add(g));
      }
    }
    return Array.from(set).sort();
  }, [flattenedPins]);

  // Non-Earth reference archive compiled neatly
  const nonEarthBooks = useMemo(() => {
    return books.filter(b => b.geoMetadata?.isNonEarth);
  }, [books]);

  // 4. Custom deterministic Grid-Based map clustering function
  const scaleClusters = useMemo<MapCluster[]>(() => {
    // Zoom levels mapping distance threshold
    const threshold =
      zoom <= 2 ? 26 : zoom <= 4 ? 14 : zoom <= 6 ? 6 : zoom <= 8 ? 2 : 0.5;

    if (zoom >= 10) {
      return filteredPins.map((p, i) => ({
        id: `pin-${i}-${p.name}`,
        center: {lat: p.lat, lng: p.lng},
        pins: [p],
      }));
    }

    const clusters: MapCluster[] = [];

    for (const pin of filteredPins) {
      let added = false;
      for (const clust of clusters) {
        const dLat = Math.abs(clust.center.lat - pin.lat);
        const dLng = Math.abs(clust.center.lng - pin.lng);

        if (dLat < threshold && dLng < threshold) {
          clust.pins.push(pin);
          // Recalculate geometric center cleanly
          clust.center.lat =
            (clust.center.lat * (clust.pins.length - 1) + pin.lat) /
            clust.pins.length;
          clust.center.lng =
            (clust.center.lng * (clust.pins.length - 1) + pin.lng) /
            clust.pins.length;
          added = true;
          break;
        }
      }
      if (!added) {
        clusters.push({
          id: `cluster-${clusters.length}-${pin.name}`,
          center: {lat: pin.lat, lng: pin.lng},
          pins: [pin],
        });
      }
    }
    return clusters;
  }, [filteredPins, zoom]);

  const handleClusterClick = (cluster: MapCluster) => {
    setSelectedCluster(cluster);
    setSelectedSinglePin(null);

    if (cluster.pins.length === 1) {
      setSelectedSinglePin(cluster.pins[0]);
    }
  };

  const handleMapClick = () => {
    setSelectedCluster(null);
    setSelectedSinglePin(null);
  };

  const hasMapsApiKey = GOOGLE_MAPS_KEY && GOOGLE_MAPS_KEY !== 'YOUR_API_KEY';

  return (
    <>
      <div className="layout-page-content" id="world-map-layout">
        {/* Dynamic header information block */}
        <div className="layout-header border-none flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div>
            <h1 className="layout-header-title">Literary World Map</h1>
            <p className="layout-header-subtitle max-w-3xl">
              Visualize the settings, narrative regions, and historical
              backdrops discussed in your books. Grouped dynamically and colored
              based on real-time geographical coordinates.
            </p>
          </div>

          {/* Presentation and Map settings toggles */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-surface-variant p-1 rounded-full flex border border-outline-variant">
              <button
                onClick={() => setActiveTab('map')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                  activeTab === 'map'
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                id="toggle-cluster-view"
              >
                <Grid size={14} /> Label Cluster
              </button>
              <button
                onClick={() => setActiveTab('heat')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
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
          total={backfillProgress.total}
          title="Scanning Literary Geographies"
          description="Resolving coordinates for your library books..."
          colorTheme="teal"
          className="ml-1 mb-5"
          inFlightCount={inFlightCount}
        />

        {/* Map filters and control panel */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
          <div className="md:col-span-7 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant w-4.5 h-4.5" />
            <input
              type="text"
              placeholder="Search setting place, book title or writer name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-xl pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              id="map-places-search"
            />
          </div>

          <div className="md:col-span-5 flex gap-2">
            <select
              value={selectedGenre}
              onChange={e => setSelectedGenre(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              id="map-genre-filter"
            >
              <option value="all">All Genres</option>
              {genresList.map(g => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Primary Interactive Map Area */}
        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Main Map Box */}
          <div
            className="lg:col-span-8 bg-surface-variant/30 rounded-3xl overflow-hidden border border-outline-variant h-[calc(100vh-14rem)] min-h-[500px]"
            id="map-interaction-stage"
          >
            {isBooksLoading ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8">
                <BookLoader size="lg" className="mb-4" />
                <p className="text-on-surface-variant text-sm font-medium">
                  Assembling cartographic assets...
                </p>
              </div>
            ) : !hasMapsApiKey ? (
              /* Beautiful Interactive Fallback Map with plotted coordinates! */
              <div className="relative w-full h-full bg-surface p-6 flex flex-col justify-between overflow-hidden rounded-3xl border border-outline-variant select-none">
                {/* Vintage map grid background */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.12]">
                  {/* Grid lines */}
                  <div className="absolute inset-0 grid grid-cols-12 grid-rows-6">
                    {Array.from({length: 72}).map((_, i) => (
                      <div
                        key={i}
                        className="border-[0.5px] border-zinc-900/10"
                      />
                    ))}
                  </div>
                  {/* Equator & Meridians */}
                  <div className="absolute left-1/2 top-0 bottom-0 border-l border-zinc-950/30 border-dashed" />
                  <div className="absolute top-1/2 left-0 right-0 border-t border-zinc-950/30 border-dashed" />
                  <span className="absolute left-4 top-[51%] text-[8px] font-mono font-medium text-stone-600 uppercase tracking-widest">
                    Equator
                  </span>
                  <span className="absolute left-[51%] top-4 text-[8px] font-mono font-medium text-stone-600 uppercase tracking-widest leading-none rotate-90 origin-top-left">
                    Prime Meridian
                  </span>
                </div>

                {/* Abstract high-fidelity Continent shapes as minimalist pastel vectors */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.22] flex items-center justify-center">
                  <div className="relative w-full h-full max-w-[800px] max-h-[400px]">
                    {/* North America */}
                    <div className="absolute left-[12%] top-[15%] w-[20%] h-[35%] bg-stone-500/30 rounded-[40px_20px_80px_40px] rotate-[10deg] blur-sm" />
                    {/* South America */}
                    <div className="absolute left-[24%] top-[50%] w-[14%] h-[40%] bg-stone-500/30 rounded-[20px_40px_80px_30px] rotate-[-5deg] blur-sm" />
                    {/* Eurasia (Europe + Asia) */}
                    <div className="absolute left-[45%] top-[10%] w-[45%] h-[45%] bg-stone-500/30 rounded-[50px_90px_60px_40px] rotate-[-2deg] blur-sm" />
                    {/* Africa */}
                    <div className="absolute left-[46%] top-[45%] w-[16%] h-[38%] bg-stone-500/30 rounded-[30px_30px_90px_60px] blur-sm" />
                    {/* Australia */}
                    <div className="absolute left-[75%] top-[65%] w-[12%] h-[20%] bg-stone-500/30 rounded-[40px_30px_60px_40px] blur-sm" />
                    {/* Greenland */}
                    <div className="absolute left-[28%] top-[5%] w-[8%] h-[10%] bg-stone-500/30 rounded-[10px_45px_10px_20px] blur-sm" />
                  </div>
                </div>

                {/* Top-level Banner overlay informing user they are running in offline/fallback mode */}
                <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center bg-white/95 backdrop-blur-md border border-neutral-200/80 px-4 py-2.5 rounded-2xl shadow-elevation-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-semibold text-stone-700 font-sans">
                      Viewing interactive literary geography fallback map
                    </span>
                  </div>
                  <Button
                    onClick={() => setShowApiSetupModal(true)}
                    variant="outline"
                    type="button"
                    className="text-[10px] h-7 px-3 py-1 font-bold rounded-xl border-zinc-200 hover:bg-neutral-50 active:bg-neutral-100 uppercase tracking-widest text-zinc-800"
                  >
                    Set Google Maps Key
                  </Button>
                </div>

                {/* Render interactive coordinate plotted pins */}
                <div className="relative w-full h-full pt-16 pb-6 pr-6">
                  {filteredPins.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                      <Globe className="text-stone-400 w-10 h-10 mb-3 animate-pulse" />
                      <h4 className="text-sm font-bold text-stone-700">
                        No geographical settings found
                      </h4>
                      <p className="text-xs text-stone-500 max-w-sm mt-1">
                        We couldn't locate any plotted settings for this view.
                        Expand your libraries or sync geocoding data.
                      </p>
                    </div>
                  ) : (
                    filteredPins.map((pin, i) => {
                      // Project coordinates onto our custom div projection
                      // Longitude goes from -180 to 180.
                      const left = ((pin.lng + 180) / 360) * 100;
                      // Latitude goes from -90 to 90. Northern is top.
                      // Adjust slightly to look centered (using a bounding box of Lat: 72N to 55S)
                      const top = ((72 - pin.lat) / 128) * 100;

                      // Bound checks
                      const boundedLeft = Math.max(4, Math.min(left, 96));
                      const boundedTop = Math.max(22, Math.min(top, 92));

                      const isSelected =
                        selectedSinglePin?.name === pin.name &&
                        selectedSinglePin?.book.id === pin.book.id;

                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setSelectedSinglePin(pin);
                            setSelectedCluster({
                              id: `fallback-cluster-${i}`,
                              center: {lat: pin.lat, lng: pin.lng},
                              pins: [pin],
                            });
                          }}
                          className={`absolute group/pin -translate-x-1/2 -translate-y-1/2 p-2 transition-all duration-300 z-10 ${
                            isSelected ? 'scale-125 z-20' : 'hover:scale-115'
                          }`}
                          style={{
                            left: `${boundedLeft}%`,
                            top: `${boundedTop}%`,
                          }}
                        >
                          <div className="relative flex items-center justify-center">
                            {/* Pulse background */}
                            <div
                              className={`absolute w-8 h-8 rounded-full opacity-35 ${
                                isSelected
                                  ? 'bg-emerald-500 animate-ping'
                                  : 'bg-primary/25 group-hover/pin:bg-primary/45'
                              }`}
                            />
                            {/* Inner dot pin with custom style */}
                            <div
                              className={`w-3.5 h-3.5 rounded-full border-2 border-white shadow-md transition-all ${
                                isSelected
                                  ? 'bg-emerald-500 scale-110'
                                  : 'bg-primary group-hover/pin:bg-amber-500'
                              }`}
                            />

                            {/* Custom hovering overlay metadata indicator */}
                            <div className="pointer-events-none opacity-0 group-hover/pin:opacity-100 absolute bottom-6 bg-stone-900 text-white rounded-lg px-2.5 py-1.5 text-[10px] font-medium leading-none whitespace-nowrap shadow-xl z-30 transition border border-stone-800">
                              <span className="font-bold text-emerald-400">
                                {pin.name}
                              </span>
                              <span className="text-stone-300 block mt-0.5 max-w-[120px] truncate">
                                {pin.book.title}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Aesthetic footer map coordinate axes labels info */}
                <div className="absolute bottom-3 left-4 right-4 flex justify-between text-[9px] font-mono font-medium text-stone-500 select-none uppercase tracking-widest">
                  <span>Plotted Settings: {filteredPins.length}</span>
                  <span>Projection: Equirectangular 1.0</span>
                </div>

                {/* Beautiful dynamic instruction modal overlay */}
                {showApiSetupModal && (
                  <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white border border-stone-200 max-w-sm w-full rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                            <Globe size={16} />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-stone-900 leading-none">
                              Connect Google Maps API
                            </h3>
                            <p className="text-[10px] text-stone-500 mt-1">
                              Unlock live map zoom & coordinates
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setShowApiSetupModal(false);
                          }}
                          className="p-1 hover:bg-neutral-105 rounded-full transition"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="space-y-3.5 text-xs text-stone-600 leading-relaxed">
                        <p className="text-stone-600">
                          To switch this offline fallback map into a
                          production-ready global interactive canvas powered by
                          Google Maps:
                        </p>
                        <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-100 space-y-2 text-stone-600">
                          <p className="flex gap-1.5">
                            <span className="font-bold text-primary">1.</span>
                            Go to your workspace{' '}
                            <span className="font-bold">
                              Settings / Secrets
                            </span>{' '}
                            menu in Google AI Studio.
                          </p>
                          <p className="flex gap-1.5">
                            <span className="font-bold text-primary">2.</span>
                            Add a new variable named{' '}
                            <code className="font-mono bg-zinc-150 px-1 rounded font-bold">
                              VITE_GOOGLE_MAPS_API_KEY
                            </code>
                            .
                          </p>
                          <p className="flex gap-1.5">
                            <span className="font-bold text-primary">3.</span>
                            Paste your client-side valid Google Maps API Key in
                            the field.
                          </p>
                        </div>
                        <p className="text-[10px] text-stone-500 bg-amber-50/50 border border-amber-100 rounded-xl p-3">
                          ⚠️ Note: Server tasks require the{' '}
                          <span className="font-semibold text-stone-700">
                            Geocoding API
                          </span>{' '}
                          and client-side map calls require the{' '}
                          <span className="font-semibold text-stone-700">
                            Maps JavaScript API
                          </span>{' '}
                          to both be enabled inside your Google Cloud project
                          Console.
                        </p>
                      </div>

                      <div className="pt-1">
                        <Button
                          onClick={e => {
                            e.stopPropagation();
                            setShowApiSetupModal(false);
                          }}
                          type="button"
                          className="w-full text-xs font-semibold rounded-xl"
                        >
                          Continue Browsing Fallback Map
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Real Google Maps Frame */
              <APIProvider apiKey={GOOGLE_MAPS_KEY}>
                <Map
                  mapId="c4a6baaaf53963889edccd6b"
                  internalUsageAttributionIds={[
                    'gmp_mcp_codeassist_v1_aistudio',
                  ]}
                  zoom={zoom}
                  center={center}
                  onZoomChanged={ev => setZoom(ev.detail.zoom)}
                  onCenterChanged={ev => setCenter(ev.detail.center)}
                  onClick={handleMapClick}
                  style={{width: '100%', height: '100%'}}
                  disableDefaultUI={false}
                  zoomControl={true}
                  mapTypeControl={false}
                  scaleControl={true}
                  streetViewControl={false}
                  rotateControl={false}
                  fullscreenControl={true}
                >
                  {/* Render Clustered Pins or Heat Dots */}
                  {scaleClusters.map(cluster => {
                    const isHeatMode = activeTab === 'heat';
                    const uniqueBookCount = new Set(
                      cluster.pins.map(p => p.book.id),
                    ).size;

                    if (isHeatMode) {
                      // Setup logarithmic step categories for proportional circle sizes
                      let outerSize = 'w-12 h-12';
                      let middleSize = 'w-8 h-8';
                      let innerSize = 'w-4 h-4';

                      if (uniqueBookCount > 100) {
                        outerSize = 'w-44 h-44';
                        middleSize = 'w-28 h-28';
                        innerSize = 'w-10 h-10';
                      } else if (uniqueBookCount > 20) {
                        outerSize = 'w-32 h-32';
                        middleSize = 'w-20 h-20';
                        innerSize = 'w-8 h-8';
                      } else if (uniqueBookCount > 5) {
                        outerSize = 'w-24 h-24';
                        middleSize = 'w-16 h-16';
                        innerSize = 'w-6 h-6';
                      } else if (uniqueBookCount > 1) {
                        outerSize = 'w-16 h-16';
                        middleSize = 'w-10 h-10';
                        innerSize = 'w-5 h-5';
                      }

                      // Heat Map presentation rendering concentric custom glowing circles
                      return (
                        <AdvancedMarker
                          key={cluster.id}
                          position={cluster.center}
                          onClick={() => handleClusterClick(cluster)}
                        >
                          <div
                            className="relative flex items-center justify-center cursor-pointer group"
                            id={cluster.id}
                          >
                            <div
                              className={`absolute ${outerSize} bg-secondary-container/40 rounded-full group-hover:scale-125 transition-transform`}
                            />
                            <div
                              className={`absolute ${middleSize} bg-secondary-container/60 rounded-full transition-transform`}
                            />
                            <div
                              className={`${innerSize} bg-secondary-container rounded-full border-2 border-background shadow-md shadow-secondary-container/50`}
                            />
                          </div>
                        </AdvancedMarker>
                      );
                    } else {
                      // Label Cluster representation showing beautiful numeric book badges
                      return (
                        <AdvancedMarker
                          key={cluster.id}
                          position={cluster.center}
                          onClick={() => handleClusterClick(cluster)}
                        >
                          <div
                            className={`flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95 text-white shadow-xl ${
                              uniqueBookCount > 1
                                ? 'bg-zinc-900 border-2 border-emerald-500 rounded-full w-10 h-10 font-bold text-sm'
                                : 'bg-primary border border-white rounded-full w-8 h-8 text-xs font-semibold'
                            }`}
                            id={cluster.id}
                          >
                            {uniqueBookCount > 1 ? (
                              uniqueBookCount
                            ) : (
                              <MapPin size={14} className="text-white" />
                            )}
                          </div>
                        </AdvancedMarker>
                      );
                    }
                  })}
                </Map>
              </APIProvider>
            )}
          </div>

          {/* Details Drawer / Context Sidebar Panel */}
          <div className="lg:col-span-4 space-y-4">
            {/* Context/Selected Location info Panel */}
            <div
              className="bg-surface-container border border-outline-variant rounded-3xl p-5 shadow-sm min-h-[300px] flex flex-col justify-between"
              id="literary-context-panel"
            >
              {selectedCluster ? (
                <div className="space-y-4 flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                        <MapPin className="text-primary w-5 h-5 flex-shrink-0" />
                        {selectedSinglePin
                          ? selectedSinglePin.name
                          : 'Geographical Cluster'}
                      </h3>
                      <p className="text-xs text-on-surface-variant font-medium mt-1">
                        Contains{' '}
                        {new Set(selectedCluster.pins.map(p => p.book.id)).size}{' '}
                        unique book
                        {new Set(selectedCluster.pins.map(p => p.book.id))
                          .size !== 1
                          ? 's'
                          : ''}{' '}
                        ({selectedCluster.pins.length} distinct setting
                        reference{selectedCluster.pins.length !== 1 ? 's' : ''})
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedCluster(null);
                      }}
                      className="p-1 hover:bg-surface-variant/50 rounded-full transition"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* List of book settings within this cluster */}
                  <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
                    {selectedCluster.pins.map((pin, i) => (
                      <div
                        key={i}
                        className="bg-surface/50 border border-outline-variant/60 rounded-2xl p-3.5 space-y-3 hover:border-primary/50 transition cursor-pointer"
                        onClick={() =>
                          navigate(`/library/${libraryId}/book/${pin.book.id}`)
                        }
                      >
                        <div className="flex gap-3">
                          {pin.book.coverUrl ? (
                            <img
                              src={pin.book.coverUrl}
                              alt={pin.book.title}
                              className="w-12 h-16 object-cover rounded-lg shadow-sm bg-neutral-100 flex-shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-12 h-16 bg-neutral-100 text-neutral-400 rounded-lg flex items-center justify-center text-[10px] uppercase font-bold text-center border p-1 flex-shrink-0">
                              No Cover
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-on-surface leading-tight truncate">
                              {pin.book.title}
                            </h4>
                            <p className="text-xs text-on-surface-variant truncate mt-0.5">
                              by {pin.book.author || 'Unknown'}
                            </p>
                            <span className="inline-block mt-2 bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              {pin.adminLevel}
                            </span>
                          </div>
                        </div>
                        {pin.rationale && (
                          <div className="bg-neutral-50/70 border-l-2 border-stone-300 pl-2.5 py-1 text-xs text-stone-600 italic leading-relaxed">
                            "{pin.rationale}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="text-center py-12 px-4 my-auto space-y-3.5"
                  id="map-selection-placeholder"
                >
                  <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto">
                    <Globe size={24} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">
                      No Setting Selected
                    </h3>
                    <p className="text-xs text-on-surface-variant max-w-xs mx-auto leading-relaxed mt-1">
                      Choose any pin or custom cluster circle on the map to read
                      setting reviews, books, and narrative rationale settings.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Non-Earth Archive accordion block */}
            <div
              className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden shadow-sm"
              id="non-earth-archive"
            >
              <button
                onClick={() => setIsNonEarthExpanded(!isNonEarthExpanded)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-variant/20 transition"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="text-amber-600 w-5 h-5" />
                  <span className="text-sm font-bold text-on-surface">
                    Non-Earth Archive ({nonEarthBooks.length})
                  </span>
                </div>
                <ChevronRight
                  size={16}
                  className={`text-on-surface-variant transition-transform duration-300 ${isNonEarthExpanded ? 'rotate-90' : ''}`}
                />
              </button>

              {isNonEarthExpanded && (
                <div className="px-5 pb-5 border-t border-outline-variant bg-surface/30">
                  {nonEarthBooks.length === 0 ? (
                    <p className="text-xs text-on-surface-variant py-3 italic">
                      No matching non-earth books found.
                    </p>
                  ) : (
                    <div className="space-y-2 mt-3.5 max-h-[220px] overflow-y-auto pr-1">
                      {nonEarthBooks.map(b => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between text-xs py-2 px-3 bg-surface/50 border rounded-xl hover:border-primary/50 cursor-pointer transition"
                          onClick={() =>
                            navigate(`/library/${libraryId}/book/${b.id}`)
                          }
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-bold text-on-surface truncate leading-tight">
                              {b.title}
                            </p>
                            <p className="text-on-surface-variant truncate mt-0.5">
                              by {b.author || 'Unknown'}
                            </p>
                          </div>
                          <span className="bg-stone-100 text-stone-600 border border-stone-200 text-[9px] font-semibold tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap">
                            Fictional / Sci-Fi
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
