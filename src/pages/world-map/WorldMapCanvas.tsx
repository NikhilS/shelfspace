import React from 'react';
import {MapPin, Globe, X, Compass} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CartographyCompassIllustration} from '@/components/ui/empty-state-illustrations';
import {BookLoader} from '../../components/book/BookLoader';
import {APIProvider, Map, AdvancedMarker} from '@vis.gl/react-google-maps';
import {FlattenedLocationPin, MapCluster, WorldMapMode} from './types';
import {ArchivalWorldMapSvg} from './ArchivalWorldMapSvg';

interface WorldMapCanvasProps {
  isBooksLoading: boolean;
  hasMapsApiKey: boolean;
  googleMapsKey: string;
  filteredPins: FlattenedLocationPin[];
  scaleClusters: MapCluster[];
  selectedSinglePin: FlattenedLocationPin | null;
  activeTab: WorldMapMode;
  zoom: number;
  center: {lat: number; lng: number};
  showApiSetupModal: boolean;
  onSetShowApiSetupModal: (show: boolean) => void;
  onZoomChanged: (zoom: number) => void;
  onCenterChanged: (center: {lat: number; lng: number}) => void;
  onClusterClick: (cluster: MapCluster) => void;
  onFallbackPinClick: (pin: FlattenedLocationPin, index: number) => void;
  onMapClick: () => void;
}

export function WorldMapCanvas({
  isBooksLoading,
  hasMapsApiKey,
  googleMapsKey,
  filteredPins,
  scaleClusters,
  selectedSinglePin,
  activeTab,
  zoom,
  center,
  showApiSetupModal,
  onSetShowApiSetupModal,
  onZoomChanged,
  onCenterChanged,
  onClusterClick,
  onFallbackPinClick,
  onMapClick,
}: WorldMapCanvasProps) {
  return (
    <div
      className="lg:col-span-8 bento-card overflow-hidden h-[calc(100vh-14rem)] min-h-[520px] flex flex-col"
      id="map-interaction-stage"
    >
      {isBooksLoading ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-8">
          <BookLoader size="lg" className="mb-4" />
          <p className="text-on-surface-variant text-sm font-sans font-medium">
            Charting literary geographies...
          </p>
        </div>
      ) : !hasMapsApiKey ? (
        /* Interactive Archival Vector World Map with Plotted Coordinates */
        <div className="relative w-full h-full bg-surface flex flex-col justify-between overflow-hidden select-none">
          {/* Clean Archival Cartouche Header Bar */}
          <div className="z-20 flex flex-wrap justify-between items-center gap-2 bg-surface-container-low/90 border-b border-outline-variant/60 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Compass className="w-4 h-4 text-tertiary shrink-0" />
              <span className="text-xs font-sans font-medium text-on-surface truncate">
                Archival Vector Atlas
              </span>
              <span
                aria-hidden="true"
                className="text-outline-variant hidden sm:inline"
              >
                ·
              </span>
              <span className="text-xs font-sans text-on-surface-variant hidden sm:inline truncate">
                Select any plotted pin to inspect literary settings
              </span>
            </div>
            <Button
              onClick={() => onSetShowApiSetupModal(true)}
              variant="outline"
              size="sm"
              type="button"
              className="h-7 px-2.5 text-[11px] font-sans font-semibold rounded-md"
            >
              Connect Live Map
            </Button>
          </div>

          {/* Equirectangular Vector Projection Stage */}
          <div
            className="relative flex-1 w-full overflow-hidden bg-surface-container-lowest"
            onClick={onMapClick}
          >
            <ArchivalWorldMapSvg className="absolute inset-0 w-full h-full" />

            {filteredPins.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-surface/65 backdrop-blur-[1px]">
                <CartographyCompassIllustration className="mb-3" />
                <h4 className="font-serif text-lg font-semibold text-on-surface">
                  No Places Mapped Yet
                </h4>
                <p className="text-xs text-on-surface-variant max-w-sm mt-1 leading-relaxed font-sans">
                  Try clearing your filters, or add books with real-world
                  settings to see them pinned on the atlas.
                </p>
              </div>
            ) : (
              filteredPins.map((pin, i) => {
                const left = ((pin.lng + 180) / 360) * 100;
                const top = ((80 - pin.lat) / 140) * 100;

                const boundedLeft = Math.max(2.5, Math.min(left, 97.5));
                const boundedTop = Math.max(4, Math.min(top, 95));

                const isSelected =
                  selectedSinglePin?.name === pin.name &&
                  selectedSinglePin?.book.id === pin.book.id;

                const isHeatMode = activeTab === 'heat';

                return (
                  <button
                    key={`${pin.book.id}-${pin.name}-${i}`}
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onFallbackPinClick(pin, i);
                    }}
                    aria-label={`${pin.name} — ${pin.book.title}`}
                    className={`absolute group/pin -translate-x-1/2 -translate-y-1/2 p-2 transition-transform duration-200 cursor-pointer ${
                      isSelected ? 'scale-125 z-20' : 'hover:scale-115 z-10'
                    }`}
                    style={{
                      left: `${boundedLeft}%`,
                      top: `${boundedTop}%`,
                    }}
                  >
                    <div className="relative flex items-center justify-center">
                      {isHeatMode ? (
                        <>
                          <div className="absolute w-12 h-12 rounded-full bg-tertiary/16 dark:bg-tertiary/22 pointer-events-none" />
                          <div className="absolute w-7 h-7 rounded-full bg-tertiary/28 dark:bg-tertiary/34 pointer-events-none" />
                          <div
                            className={`w-3 h-3 rounded-full border border-surface shadow-xs transition-all ${
                              isSelected
                                ? 'bg-tertiary scale-115'
                                : 'bg-tertiary/90'
                            }`}
                          />
                        </>
                      ) : (
                        <>
                          <div
                            className={`absolute w-7 h-7 rounded-full transition-colors ${
                              isSelected
                                ? 'bg-tertiary/28 ring-1 ring-tertiary/50'
                                : 'bg-primary/15 group-hover/pin:bg-tertiary/22'
                            }`}
                          />
                          <div
                            className={`w-3 h-3 rounded-full border-[1.5px] border-surface shadow-sm transition-all ${
                              isSelected
                                ? 'bg-tertiary scale-115'
                                : 'bg-primary group-hover/pin:bg-tertiary'
                            }`}
                          />
                        </>
                      )}

                      <div className="pointer-events-none opacity-0 group-hover/pin:opacity-100 absolute bottom-6 bg-surface text-on-surface rounded-lg px-2.5 py-1.5 text-xs font-sans leading-snug whitespace-nowrap shadow-elevation-3 z-30 transition-opacity border border-outline-variant/80 text-left">
                        <span className="font-semibold text-tertiary block">
                          {pin.name}
                        </span>
                        <span className="font-serif text-on-surface-variant block mt-0.5 max-w-[160px] truncate">
                          {pin.book.title}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Cartographic Scale & Projection Footer */}
          <div className="z-20 px-4 py-2 border-t border-outline-variant/60 bg-surface-container-low/80 flex justify-between items-center font-mono tabular-nums text-[10px] text-on-surface-variant uppercase tracking-widest">
            <span>Plotted Settings: {filteredPins.length}</span>
            <span>Equirectangular · 80°N–60°S</span>
          </div>

          {showApiSetupModal && (
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
              onClick={() => onSetShowApiSetupModal(false)}
            >
              <div
                className="bg-surface border border-outline-variant max-w-sm w-full rounded-2xl p-5 shadow-elevation-3 space-y-4"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-tertiary/12 text-tertiary border border-tertiary/25 rounded-lg flex items-center justify-center shrink-0">
                      <Globe size={16} />
                    </div>
                    <div>
                      <h3 className="font-serif text-base font-semibold text-on-surface leading-tight">
                        Connect Live Street Atlas
                      </h3>
                      <p className="text-xs text-on-surface-variant mt-0.5 font-sans">
                        Enable interactive street-level zoom with Google Maps
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close setup dialog"
                    onClick={() => onSetShowApiSetupModal(false)}
                    className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed font-sans">
                  <p>
                    To upgrade the built-in archival vector atlas to live
                    street-level tiles powered by Google Maps:
                  </p>
                  <div className="bg-surface-container-low rounded-xl p-3.5 border border-outline-variant/60 space-y-2 text-on-surface">
                    <p className="flex gap-2">
                      <span className="font-mono font-bold text-tertiary">
                        1.
                      </span>
                      <span>
                        Open workspace <strong>Settings &rarr; Secrets</strong>{' '}
                        in AI Studio.
                      </span>
                    </p>
                    <p className="flex gap-2">
                      <span className="font-mono font-bold text-tertiary">
                        2.
                      </span>
                      <span>
                        Add{' '}
                        <code className="font-mono bg-surface-container px-1.5 py-0.5 rounded text-[11px] font-semibold">
                          VITE_GOOGLE_MAPS_API_KEY
                        </code>
                        .
                      </span>
                    </p>
                    <p className="flex gap-2">
                      <span className="font-mono font-bold text-tertiary">
                        3.
                      </span>
                      <span>
                        Enable both <strong>Maps JavaScript API</strong> and{' '}
                        <strong>Geocoding API</strong> in your Cloud project.
                      </span>
                    </p>
                  </div>
                </div>

                <div className="pt-1">
                  <Button
                    onClick={() => onSetShowApiSetupModal(false)}
                    type="button"
                    className="w-full text-xs font-sans font-semibold rounded-lg"
                  >
                    Continue with Archival Atlas
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Real Google Maps Frame */
        <APIProvider apiKey={googleMapsKey}>
          <Map
            mapId="c4a6baaaf53963889edccd6b"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            gestureHandling={'cooperative'}
            zoom={zoom}
            center={center}
            onZoomChanged={ev => onZoomChanged(ev.detail.zoom)}
            onCenterChanged={ev => onCenterChanged(ev.detail.center)}
            onClick={onMapClick}
            style={{width: '100%', height: '100%'}}
            disableDefaultUI={false}
            zoomControl={true}
            mapTypeControl={false}
            scaleControl={true}
            streetViewControl={false}
            rotateControl={false}
            fullscreenControl={true}
          >
            {scaleClusters.map(cluster => {
              const isHeatMode = activeTab === 'heat';
              const uniqueBookCount = new Set(cluster.pins.map(p => p.book.id))
                .size;

              if (isHeatMode) {
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

                return (
                  <AdvancedMarker
                    key={cluster.id}
                    position={cluster.center}
                    onClick={() => onClusterClick(cluster)}
                  >
                    <div
                      className="relative flex items-center justify-center cursor-pointer group"
                      id={cluster.id}
                    >
                      <div
                        className={`absolute ${outerSize} bg-tertiary/20 rounded-full group-hover:scale-125 transition-transform`}
                      />
                      <div
                        className={`absolute ${middleSize} bg-tertiary/38 rounded-full transition-transform`}
                      />
                      <div
                        className={`${innerSize} bg-tertiary rounded-full border-2 border-surface shadow-md`}
                      />
                    </div>
                  </AdvancedMarker>
                );
              } else {
                return (
                  <AdvancedMarker
                    key={cluster.id}
                    position={cluster.center}
                    onClick={() => onClusterClick(cluster)}
                  >
                    <div
                      className={`flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95 shadow-elevation-2 ${
                        uniqueBookCount > 1
                          ? 'bg-primary text-on-primary border-2 border-tertiary rounded-full w-10 h-10 font-mono tabular-nums font-bold text-xs'
                          : 'bg-tertiary text-white border-2 border-surface rounded-full w-8 h-8 text-xs font-semibold'
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
  );
}
