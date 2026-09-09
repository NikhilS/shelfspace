import React, {useMemo, useState, useRef} from 'react';
import {ScatterPoint} from '../hooks/useConstellationData';
import {Canvas, useFrame} from '@react-three/fiber';
import {
  OrbitControls,
  Stars,
  Html,
  Instances,
  Instance,
  Bounds,
} from '@react-three/drei';
import * as THREE from 'three';
import {Move, Hand} from 'lucide-react';

const CLUSTER_COLORS = [
  '#FF5A5F', // Nebula Rose / Deep Pink-Red
  '#00E5FF', // Electric Cyan / Luminous Turquoise
  '#FFC107', // Solar Gold / Radiant Yellow
  '#A855F7', // Deep Violet / Stellar Amethyst
  '#00E676', // Emerald Aurora / Glowing Green
  '#FF4081', // Celestial Magenta / Hot Pink
  '#38BDF8', // Hypergiant Blue / Neon Sky
  '#FF7043', // Solar Flare / Vibrant Orange-Red
  '#1DE9B6', // Aquamarine / Neon Mint
  '#9C27B0', // Cosmic Purple / Lilac-Magenta
];

function InteractiveStar({
  data,
  color,
  pos,
  onHover,
}: {
  data: ScatterPoint;
  color: string;
  pos: [number, number, number];
  onHover: (
    data: ScatterPoint | null,
    position: [number, number, number] | null,
  ) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHover] = useState(false);

  useFrame(() => {
    if (ref.current) {
      const scale = hovered ? 1.8 : 1.0;
      ref.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.15);
    }
  });

  return (
    <Instance
      ref={ref}
      position={pos}
      color={hovered ? '#ffffff' : color}
      onPointerOver={e => {
        e.stopPropagation();
        setHover(true);
        // Inform parent of current position (DOM mapping happens there)
        onHover(data, pos);
      }}
      onPointerOut={() => {
        setHover(false);
        onHover(null, null);
      }}
    />
  );
}

function StarField({
  plotData,
  setHoveredNode,
}: {
  plotData: ScatterPoint[];
  setHoveredNode: (
    info: {data: ScatterPoint; pos: [number, number, number]} | null,
  ) => void;
}) {
  const bounds = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    plotData.forEach(d => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.y > maxY) maxY = d.y;
    });
    return {minX, maxX, minY, maxY};
  }, [plotData]);

  const normalize = (
    val: number,
    min: number,
    max: number,
    rangeMin: number,
    rangeMax: number,
  ) => {
    if (max === min) return (rangeMax + rangeMin) / 2;
    return rangeMin + ((val - min) * (rangeMax - rangeMin)) / (max - min);
  };

  const RANGE = 20;

  // Flat Z for a perfect 2D constellation map
  const processedData = useMemo(() => {
    return plotData.map(d => ({
      data: d,
      pos: [
        normalize(d.x, bounds.minX, bounds.maxX, -RANGE, RANGE),
        normalize(d.y, bounds.minY, bounds.maxY, -RANGE, RANGE),
        0,
      ] as [number, number, number],
      color:
        d.clusterId === -1
          ? 'var(--color-surface-tint-value)' // subdued noise color matching Oxford Blue
          : CLUSTER_COLORS[d.clusterId % CLUSTER_COLORS.length],
    }));
  }, [plotData, bounds]);

  return (
    <Instances limit={2000} range={processedData.length}>
      <circleGeometry args={[0.3, 32]} />
      <meshBasicMaterial toneMapped={false} />
      {processedData.map((item, i) => (
        <InteractiveStar
          key={i}
          data={item.data}
          pos={item.pos}
          color={item.color}
          onHover={(data, pos) => {
            if (data && pos) {
              setHoveredNode({data, pos});
            } else {
              setHoveredNode(null);
            }
          }}
        />
      ))}
    </Instances>
  );
}

interface ConstellationChartProps {
  plotData: ScatterPoint[];
  clusterNames: Record<number, string>;
}

export default function ConstellationChart({
  plotData,
  clusterNames,
}: ConstellationChartProps) {
  const [hoveredNode, setHoveredNode] = useState<{
    data: ScatterPoint;
    pos: [number, number, number];
  } | null>(null);
  const [gesturesActive, setGesturesActive] = useState(true);

  return (
    <div className="relative w-full h-[480px] sm:h-[560px] md:h-[650px] bg-primary rounded-2xl border border-outline-variant shadow-sm overflow-hidden touch-pan-y">
      {/* Mobile Gesture Helper & Safety Toggle */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface/90 backdrop-blur-md border border-outline-variant/30 font-body-xs text-body-xs font-sans font-medium text-on-surface-variant shadow-xs">
          2 fingers to pan & zoom • 1 finger scrolls
        </span>
        <button
          type="button"
          onClick={() => setGesturesActive(!gesturesActive)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md border transition-all shadow-xs ${
            gesturesActive
              ? 'bg-surface/95 text-primary border-outline-variant/40 hover:bg-surface'
              : 'bg-primary-container text-on-primary-container border-primary/30'
          }`}
          title={
            gesturesActive
              ? 'Tap to lock 3D navigation and freely scroll page'
              : 'Tap to enable 3D navigation'
          }
        >
          {gesturesActive ? (
            <>
              <Move className="w-3.5 h-3.5 text-secondary" />
              <span className="hidden xs:inline">3D Pan Active</span>
              <span className="xs:hidden">Pan On</span>
            </>
          ) : (
            <>
              <Hand className="w-3.5 h-3.5 text-secondary" />
              <span className="hidden xs:inline">Page Scroll Mode</span>
              <span className="xs:hidden">Scroll Mode</span>
            </>
          )}
        </button>
      </div>

      <Canvas camera={{position: [0, 0, 35], fov: 60}}>
        <color attach="background" args={['var(--color-primary-base)']} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />

        <Stars
          radius={50}
          depth={50}
          count={2000}
          factor={3}
          saturation={0}
          fade
          speed={0.5}
        />

        <OrbitControls
          makeDefault
          enabled={gesturesActive}
          enablePan={true}
          enableZoom={true}
          enableRotate={false}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
          touches={{
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />

        <Bounds fit clip observe margin={1.2}>
          <StarField plotData={plotData} setHoveredNode={setHoveredNode} />
        </Bounds>

        {hoveredNode && (
          <Html
            position={hoveredNode.pos}
            center
            zIndexRange={[100, 0]}
            pointerEvents="none"
          >
            <div className="bg-surface/95 backdrop-blur-md border border-outline-variant/40 p-4 shadow-xl rounded-lg w-48 sm:w-56 pointer-events-none transform transition-opacity duration-200">
              {hoveredNode.data.book.coverUrl && (
                <img
                  src={hoveredNode.data.book.coverUrl}
                  alt={hoveredNode.data.book.title}
                  className="w-full h-32 object-cover rounded-sm mb-2.5 border border-outline-variant/20 shadow-inner"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              )}
              <p className="font-serif text-on-surface text-sm font-semibold tracking-tight leading-tight mb-1">
                {hoveredNode.data.book.title}
              </p>
              <p className="text-on-surface-variant text-xs mb-2">
                {hoveredNode.data.book.author}
              </p>
              <div className="flex flex-wrap gap-1 items-center mt-1">
                {hoveredNode.data.book.primaryGenre && (
                  <span className="inline-block px-1.5 py-0.5 rounded-md font-label-caps-xs text-label-caps-xs font-sans font-medium bg-secondary/10 text-secondary">
                    {hoveredNode.data.book.primaryGenre}
                  </span>
                )}
                {hoveredNode.data.clusterId >= 0 ? (
                  <span className="inline-block px-1.5 py-0.5 rounded-md font-label-caps-xs text-label-caps-xs font-sans font-medium bg-tertiary-container/10 text-on-tertiary-container border border-on-tertiary-container/10">
                    {clusterNames[hoveredNode.data.clusterId] ||
                      `Constellation ${hoveredNode.data.clusterId + 1}`}
                  </span>
                ) : (
                  <span className="inline-block px-1.5 py-0.5 rounded-md font-label-caps-xs text-label-caps-xs font-sans font-medium bg-surface-variant text-on-surface-variant">
                    Uncategorized
                  </span>
                )}
              </div>
            </div>
          </Html>
        )}
      </Canvas>

      {/* Map Legend */}
      <div className="absolute bottom-4 left-4 bg-surface-container/95 backdrop-blur border border-outline-variant/30 p-3.5 sm:p-4 rounded-2xl shadow-lg pointer-events-auto max-w-[220px] sm:max-w-[240px]">
        <h4 className="text-xs font-sans font-semibold tracking-wider uppercase text-primary mb-2">
          Constellations
        </h4>
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
          {Array.from(new Set(plotData.map(d => d.clusterId)))
            .sort((a, b) => a - b)
            .map(cid => {
              if (cid === -1)
                return (
                  <div
                    key="noise"
                    className="flex items-center gap-2 text-xs text-on-surface"
                  >
                    <div className="w-2.5 h-2.5 rounded bg-slate-400 opacity-40"></div>
                    <span>Uncategorized</span>
                  </div>
                );
              return (
                <div
                  key={cid}
                  className="flex items-center gap-2 text-xs text-on-surface"
                >
                  <div
                    className="w-2.5 h-2.5 rounded shadow-sm"
                    style={{
                      backgroundColor:
                        CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
                    }}
                  ></div>
                  <span className="font-medium">
                    {clusterNames[cid] || `Cluster ${cid + 1}`}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
