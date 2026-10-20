import React from 'react';
import {TimelineCluster} from './TimelineControls';
import {computeRiverGeometry, TimelineEraMarker} from './TimelineEraMarker';

export interface TimelineRiverCanvasProps {
  clusters: TimelineCluster[];
  riverGeometry: ReturnType<typeof computeRiverGeometry>;
  selectedClusterKey: number | null;
  hoveredClusterKey: number | null;
  onSelectCluster: (key: number | null) => void;
  onHoverCluster: (key: number | null) => void;
  stageContainerRef: React.RefObject<HTMLDivElement | null>;
}

export const TimelineRiverCanvas: React.FC<TimelineRiverCanvasProps> = ({
  clusters,
  riverGeometry,
  selectedClusterKey,
  hoveredClusterKey,
  onSelectCluster,
  onHoverCluster,
  stageContainerRef,
}) => {
  return (
    <div
      ref={stageContainerRef}
      className="relative w-full"
      style={{height: `${riverGeometry.totalHeight}px`}}
    >
      <svg
        viewBox={`0 0 ${riverGeometry.W} ${riverGeometry.totalHeight}`}
        className="block absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="alluvialValleyGrad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#8ab0a6" stopOpacity="0.09" />
            <stop offset="50%" stopColor="#a8c3b8" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#7da39b" stopOpacity="0.11" />
          </linearGradient>

          <linearGradient
            id="shallowShoalGrad"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#7fb8c9" stopOpacity="0.28" />
            <stop offset="50%" stopColor="#64a6ba" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#5295ab" stopOpacity="0.38" />
          </linearGradient>

          <linearGradient id="midChannelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#488ea5" stopOpacity="0.32" />
            <stop offset="50%" stopColor="#367c94" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#296b82" stopOpacity="0.44" />
          </linearGradient>

          <linearGradient
            id="deepThalwegGrad"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#1f5d73" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#16495c" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        <path
          d={riverGeometry.alluvialValleyPath}
          fill="url(#alluvialValleyGrad)"
          stroke="#7aa198"
          strokeOpacity="0.22"
          strokeWidth="1"
        />

        <path
          d={riverGeometry.riparianMarshPath}
          fill="#9cc2b8"
          fillOpacity="0.11"
          stroke="#68968d"
          strokeOpacity="0.24"
          strokeWidth="0.9"
        />

        {riverGeometry.tributaries.map(creek => {
          const isHighlighted =
            selectedClusterKey === creek.clusterKey ||
            hoveredClusterKey === creek.clusterKey;
          return (
            <g key={creek.id}>
              <path
                d={creek.ribbonPath}
                fill="url(#shallowShoalGrad)"
                stroke="#3b7e94"
                strokeOpacity={isHighlighted ? '0.55' : '0.32'}
                strokeWidth="1"
              />
              <path
                d={creek.waterLinePath}
                fill="none"
                stroke="#296b82"
                strokeOpacity={isHighlighted ? '0.45' : '0.22'}
                strokeWidth="0.8"
              />
            </g>
          );
        })}

        <path
          d={riverGeometry.shallowShoalPath}
          fill="url(#shallowShoalGrad)"
          stroke="#387b91"
          strokeOpacity="0.52"
          strokeWidth="1.25"
        />

        <path
          d={riverGeometry.waterLinePortPath}
          fill="none"
          stroke="#2d6d82"
          strokeOpacity="0.24"
          strokeWidth="0.75"
        />
        <path
          d={riverGeometry.waterLineStarboardPath}
          fill="none"
          stroke="#2d6d82"
          strokeOpacity="0.24"
          strokeWidth="0.75"
        />

        <path d={riverGeometry.midChannelPath} fill="url(#midChannelGrad)" />

        <path d={riverGeometry.deepThalwegPath} fill="url(#deepThalwegGrad)" />

        {riverGeometry.islands.map(island => (
          <g key={island.id}>
            <path
              d={island.outerPath}
              fill="var(--color-surface-container-low)"
              fillOpacity="0.92"
              stroke="#387b91"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <path
              d={island.innerVegPath}
              fill="#8cb3a3"
              fillOpacity="0.35"
              stroke="#5c8a79"
              strokeOpacity="0.35"
              strokeWidth="0.75"
            />
          </g>
        ))}

        {riverGeometry.spanArcs.map(arc => {
          const parentCluster = clusters[arc.fromClusterIndex];
          const isHighlighted =
            parentCluster &&
            (selectedClusterKey === parentCluster.key ||
              hoveredClusterKey === parentCluster.key);

          return (
            <g key={arc.id}>
              <path
                d={arc.pathD}
                fill="none"
                stroke="#2d6d82"
                strokeOpacity={isHighlighted ? '0.75' : '0.32'}
                strokeWidth={isHighlighted ? '1.8' : '1.15'}
                strokeDasharray="3 4"
              />
              <circle
                cx={arc.midX}
                cy={arc.midY}
                r={isHighlighted ? 4 : 2.8}
                fill="#2d6d82"
                fillOpacity={isHighlighted ? '0.85' : '0.45'}
              />
            </g>
          );
        })}

        {riverGeometry.bendNodes.map(node => {
          const isSelected = selectedClusterKey === node.cluster.key;
          const isHovered = hoveredClusterKey === node.cluster.key;
          const active = isSelected || isHovered;
          const dockAnchorX = node.isRightApex
            ? riverGeometry.W * 0.56
            : riverGeometry.W * 0.44;

          return (
            <g key={`svg-bend-${node.cluster.key}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.width * 0.48}
                fill="none"
                stroke="#296b82"
                strokeOpacity={active ? '0.52' : '0.22'}
                strokeWidth={active ? '1.4' : '0.9'}
              />
              <line
                x1={node.x}
                y1={node.y}
                x2={dockAnchorX}
                y2={node.y}
                stroke="#2d6d82"
                strokeOpacity={active ? '0.55' : '0.25'}
                strokeWidth={active ? '1.5' : '1'}
              />
            </g>
          );
        })}
      </svg>

      {riverGeometry.bendNodes.map(node => (
        <TimelineEraMarker
          key={node.cluster.key}
          node={node}
          stageWidth={riverGeometry.W}
          selectedClusterKey={selectedClusterKey}
          hoveredClusterKey={hoveredClusterKey}
          onSelectCluster={onSelectCluster}
          onHoverCluster={onHoverCluster}
        />
      ))}
    </div>
  );
};
