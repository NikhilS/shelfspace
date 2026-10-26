import React from 'react';
import {Link} from 'react-router-dom';
import {
  Sparkles,
  Compass,
  ArrowUpRight,
  X,
  Layers,
  GitCompareArrows,
} from 'lucide-react';
import {ScatterPoint} from '../../hooks/useConstellationData';
import {CrossClusterBridge} from '../../lib/clustering';
import {Button} from '@/components/ui/button';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import {CLUSTER_COLORS, ClusterGeometry} from './types';

interface ConstellationInspectorProps {
  selectedStar: ScatterPoint | null;
  activeCluster: ClusterGeometry | null;
  clustersGeometry: ClusterGeometry[];
  crossClusterBridges?: CrossClusterBridge[];
  plotData: ScatterPoint[];
  clusterNames: Record<number, string>;
  starById: Map<string, {point: ScatterPoint; index: number}>;
  libraryId?: string;
  onClearStar: () => void;
  onResetView: () => void;
  onFocusCluster: (clusterId: number) => void;
  onFocusStar: (star: ScatterPoint) => void;
}

export function ConstellationInspector({
  selectedStar,
  activeCluster,
  clustersGeometry,
  crossClusterBridges = [],
  plotData,
  clusterNames,
  starById,
  libraryId,
  onClearStar,
  onResetView,
  onFocusCluster,
  onFocusStar,
}: ConstellationInspectorProps) {
  const activeClusterBridges = activeCluster
    ? crossClusterBridges.filter(
        b =>
          b.sourceClusterId === activeCluster.clusterId ||
          b.targetClusterId === activeCluster.clusterId,
      )
    : [];

  return (
    <aside className="lg:col-span-4 bg-surface border border-outline-variant/60 rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[420px] lg:h-[640px] overflow-y-auto custom-scrollbar">
      {selectedStar ? (
        /* ===============================================================
           STATE A: Selected Book Star & Semantic Nearest Neighbors
           =============================================================== */
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-outline-variant/50 pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant truncate">
                Locked Star Inspector
              </span>
            </div>
            <button
              type="button"
              onClick={onClearStar}
              className="text-xs text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>

          {/* Book Header & Artwork */}
          <div className="flex gap-3.5 items-start">
            {selectedStar.book.coverUrl ? (
              <img
                src={selectedStar.book.coverUrl}
                alt={selectedStar.book.title}
                className="w-20 h-28 object-cover rounded-md border border-outline-variant/40 shadow-xs shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <MonographCoverFallback
                title={selectedStar.book.title}
                author={selectedStar.book.author}
                publishedYear={selectedStar.book.publishedDate}
                variant="compact"
                className="w-20 h-28 rounded-md shrink-0"
              />
            )}

            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-base sm:text-lg font-bold text-on-surface leading-snug mb-1">
                {selectedStar.book.title}
              </h2>
              <p className="text-xs sm:text-sm text-on-surface-variant mb-2">
                {selectedStar.book.author || 'Unknown Author'}
              </p>

              {/* Unboxed Metadata Line (Zero-Pill Discipline) */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
                {selectedStar.book.primaryGenre && (
                  <span>{selectedStar.book.primaryGenre}</span>
                )}
                {selectedStar.book.publishedDate && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {selectedStar.book.publishedDate.slice(0, 4)}
                    </span>
                  </>
                )}
                {selectedStar.book.pageCount && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {selectedStar.book.pageCount} pp.
                    </span>
                  </>
                )}
              </div>

              {/* Parent & Transitional Secondary Constellation Selector Buttons */}
              {selectedStar.clusterId >= 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onFocusCluster(selectedStar.clusterId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/50 transition-colors"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{
                        backgroundColor:
                          CLUSTER_COLORS[
                            selectedStar.clusterId % CLUSTER_COLORS.length
                          ],
                      }}
                    />
                    <span className="truncate">
                      {clusterNames[selectedStar.clusterId] ||
                        `Constellation ${selectedStar.clusterId + 1}`}
                    </span>
                  </button>

                  {typeof selectedStar.secondaryClusterId === 'number' &&
                    selectedStar.secondaryClusterId >= 0 &&
                    (selectedStar.secondaryWeight ?? 0) >= 0.16 && (
                      <button
                        type="button"
                        onClick={() =>
                          onFocusCluster(selectedStar.secondaryClusterId!)
                        }
                        title="Transitional theme affinity"
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium bg-surface-container/60 hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline-variant/40 transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{
                            backgroundColor:
                              CLUSTER_COLORS[
                                selectedStar.secondaryClusterId %
                                  CLUSTER_COLORS.length
                              ],
                          }}
                        />
                        <span className="truncate">
                          ↔{' '}
                          {clusterNames[selectedStar.secondaryClusterId] ||
                            `Constellation ${selectedStar.secondaryClusterId + 1}`}
                        </span>
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>

          {selectedStar.book.synopsis && (
            <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-3 border-t border-outline-variant/40 pt-3">
              {selectedStar.book.synopsis}
            </p>
          )}

          {/* Semantic Nearest Neighbors List */}
          <div className="border-t border-outline-variant/50 pt-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Nearest Semantic Neighbors
              </span>
              <span className="text-[11px] font-mono tabular-nums text-on-surface-variant">
                Top {selectedStar.neighbors.length}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {selectedStar.neighbors.map(nb => {
                const nbStarEntry = starById.get(nb.bookId);
                const isCrossCluster = nb.clusterId !== selectedStar.clusterId;
                const nbColor =
                  nb.clusterId >= 0
                    ? CLUSTER_COLORS[nb.clusterId % CLUSTER_COLORS.length]
                    : '#78716C';

                return (
                  <button
                    key={nb.bookId}
                    type="button"
                    onClick={() => {
                      if (nbStarEntry) {
                        onFocusStar(nbStarEntry.point);
                      }
                    }}
                    className="w-full text-left p-2 rounded-lg bg-surface-container/60 hover:bg-surface-container border border-outline-variant/40 transition-colors flex items-center justify-between gap-2.5 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{backgroundColor: nbColor}}
                        />
                        <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                          {nb.title}
                        </p>
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate pl-3.5">
                        {nb.author}
                        {isCrossCluster &&
                          nb.clusterId >= 0 &&
                          ` · ${clusterNames[nb.clusterId] || `Cluster ${nb.clusterId + 1}`}`}
                      </p>
                    </div>

                    <span className="font-mono tabular-nums text-xs font-semibold text-primary shrink-0">
                      {Math.round(nb.similarity * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {(selectedStar.book.libraryId || libraryId) && (
            <div className="pt-2 border-t border-outline-variant/40">
              <Link
                to={`/library/${selectedStar.book.libraryId || libraryId}/book/${selectedStar.book.id}`}
                className="block w-full"
              >
                <Button className="w-full rounded-lg gap-2">
                  <span>Open Book Record</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : activeCluster ? (
        /* ===============================================================
           STATE B: Active Constellation Territory Roster
           =============================================================== */
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-outline-variant/50 pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-3 h-3 rounded-xs shrink-0"
                style={{backgroundColor: activeCluster.color}}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant truncate">
                Constellation Territory
              </span>
            </div>
            <button
              type="button"
              onClick={onResetView}
              className="text-xs text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>All</span>
            </button>
          </div>

          <div>
            <h2 className="font-serif text-lg font-bold text-on-surface mb-1">
              {activeCluster.name}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
              <span className="font-mono tabular-nums font-semibold text-on-surface">
                {activeCluster.pointIndices.length} books
              </span>
              {activeCluster.dominantGenres.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{activeCluster.dominantGenres.join(' / ')}</span>
                </>
              )}
            </div>
            {activeCluster.thesis && (
              <p className="mt-2.5 text-xs text-on-surface-variant leading-relaxed bg-surface-container/60 border border-outline-variant/40 rounded-lg p-2.5">
                {activeCluster.thesis}
              </p>
            )}
          </div>

          {activeClusterBridges.length > 0 && (
            <div className="border-t border-outline-variant/40 pt-3">
              <div className="flex items-center gap-1.5 mb-2">
                <GitCompareArrows className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Cross-Constellation Bridges
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {activeClusterBridges.slice(0, 4).map(bridge => {
                  const isSourceHere =
                    bridge.sourceClusterId === activeCluster.clusterId;
                  const ownPt =
                    plotData[
                      isSourceHere ? bridge.sourceIndex : bridge.targetIndex
                    ];
                  const otherPt =
                    plotData[
                      isSourceHere ? bridge.targetIndex : bridge.sourceIndex
                    ];
                  if (!ownPt || !otherPt) {
                    return null;
                  }
                  const otherClusterColor =
                    otherPt.clusterId >= 0
                      ? CLUSTER_COLORS[
                          otherPt.clusterId % CLUSTER_COLORS.length
                        ]
                      : '#78716C';
                  const otherClusterName =
                    clusterNames[otherPt.clusterId] ||
                    `Constellation ${otherPt.clusterId + 1}`;

                  return (
                    <button
                      key={`${bridge.sourceIndex}:${bridge.targetIndex}`}
                      type="button"
                      onClick={() => onFocusStar(otherPt)}
                      className="w-full text-left p-2 rounded-lg bg-surface-container/40 hover:bg-surface-container border border-outline-variant/40 transition-colors flex items-center justify-between gap-2 group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                          {ownPt.book.title} → {otherPt.book.title}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant truncate mt-0.5">
                          <span
                            className="w-2 h-2 rounded-xs shrink-0"
                            style={{backgroundColor: otherClusterColor}}
                          />
                          <span className="truncate">
                            Bridges to {otherClusterName}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-semibold text-primary shrink-0">
                        {Math.round(bridge.similarity * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5 border-t border-outline-variant/40 pt-3">
            {activeCluster.pointIndices.map(idx => {
              const pt = plotData[idx];
              return (
                <button
                  key={pt.id || pt.book.id}
                  type="button"
                  onClick={() => onFocusStar(pt)}
                  className="w-full text-left p-2.5 rounded-lg bg-surface-container/50 hover:bg-surface-container border border-outline-variant/40 transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-on-surface truncate">
                      {pt.book.title}
                    </p>
                    <p className="text-[11px] text-on-surface-variant truncate">
                      {pt.book.author}
                      {pt.book.primaryGenre && ` · ${pt.book.primaryGenre}`}
                    </p>
                  </div>
                  <Compass className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ===============================================================
           STATE C: Default Atlas Directory & Constellation Index
           =============================================================== */
        <div className="flex flex-col gap-4">
          <div className="border-b border-outline-variant/50 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Celestial Atlas Index
              </h2>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Click any point on the chart to lock onto a volume and trace its
              semantic kinship arcs, or select a constellation below to inspect
              its emergent theme.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {clustersGeometry.map(cluster => (
              <button
                key={cluster.clusterId}
                type="button"
                onClick={() => onFocusCluster(cluster.clusterId)}
                className="w-full text-left p-3 rounded-xl bg-surface-container/50 hover:bg-surface-container border border-outline-variant/50 transition-colors flex items-start justify-between gap-3 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{backgroundColor: cluster.color}}
                    />
                    <p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                      {cluster.name}
                    </p>
                  </div>
                  {cluster.thesis && (
                    <p className="text-xs text-on-surface-variant leading-snug line-clamp-2 pl-4.5 mt-0.5">
                      {cluster.thesis}
                    </p>
                  )}
                  {cluster.dominantGenres.length > 0 && (
                    <p className="text-[11px] text-on-surface-variant/80 truncate pl-4.5 mt-1">
                      {cluster.dominantGenres.join(' · ')}
                    </p>
                  )}
                </div>
                <span className="font-mono tabular-nums text-xs font-semibold text-on-surface-variant bg-surface px-2 py-1 rounded-md border border-outline-variant/40 shrink-0">
                  {cluster.pointIndices.length}
                </span>
              </button>
            ))}
          </div>

          {crossClusterBridges.length > 0 && (
            <div className="border-t border-outline-variant/50 pt-3">
              <div className="flex items-center gap-1.5 mb-2">
                <GitCompareArrows className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Unexpected Cross-Cluster Bridges
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {crossClusterBridges.slice(0, 4).map(bridge => {
                  const ptA = plotData[bridge.sourceIndex];
                  const ptB = plotData[bridge.targetIndex];
                  if (!ptA || !ptB) {
                    return null;
                  }
                  const cnameA =
                    clusterNames[ptA.clusterId] ||
                    `Constellation ${ptA.clusterId + 1}`;
                  const cnameB =
                    clusterNames[ptB.clusterId] ||
                    `Constellation ${ptB.clusterId + 1}`;

                  return (
                    <button
                      key={`${bridge.sourceIndex}:${bridge.targetIndex}`}
                      type="button"
                      onClick={() => onFocusStar(ptA)}
                      className="w-full text-left p-2 rounded-lg bg-surface-container/40 hover:bg-surface-container border border-outline-variant/40 transition-colors flex items-center justify-between gap-2 group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                          {ptA.book.title} ↔ {ptB.book.title}
                        </p>
                        <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                          {cnameA} · {cnameB}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-semibold text-primary shrink-0">
                        {Math.round(bridge.similarity * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
