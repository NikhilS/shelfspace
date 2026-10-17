import React from 'react';
import {
  Bug,
  ChevronDown,
  Database,
  Wifi,
  WifiOff,
  Clock,
  HardDrive,
  Layers,
  Maximize2,
  ArrowUpRight,
} from 'lucide-react';
import type {
  TelemetryMetrics,
  TelemetryProfilingLevel,
} from '../../lib/telemetry';

export type HeightPreset = 'compact' | 'medium' | 'tall';

interface DebugMetricsOverviewProps {
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
  isOnline: boolean;
  profilingLevel: TelemetryProfilingLevel;
  setProfilingLevel: (level: TelemetryProfilingLevel) => void;
  heightPreset: HeightPreset;
  onCycleHeight: () => void;
  onMinimize: () => void;
}

export const DebugMetricsOverview: React.FC<DebugMetricsOverviewProps> = ({
  metrics,
  fetchCacheHitRatio,
  isOnline,
  profilingLevel,
  setProfilingLevel,
  heightPreset,
  onCycleHeight,
  onMinimize,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 font-label-caps-sm text-label-caps-sm text-slate-400 select-none bg-slate-950/40">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-cyan-400 font-bold uppercase tracking-wider font-label-caps-xs text-label-caps-xs">
          <Bug size={12} />
          <span>Telemetry HUD</span>
        </div>

        <div className="h-3 w-px bg-slate-800"></div>

        <div className="flex items-center gap-1.25">
          <HardDrive size={12} className="text-cyan-400" />
          <span>
            Transferred:{' '}
            <strong className="text-cyan-300">
              {(metrics.totalBytesTransferred / 1024).toFixed(1)} KB
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-1.25">
          <ArrowUpRight size={12} className="text-amber-400" />
          <span>
            Writes:{' '}
            <strong className="text-amber-300">
              {metrics.totalFirestoreWrites}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-1.25">
          <Layers
            size={12}
            className={
              metrics.activeFirestoreListeners > 2
                ? 'text-amber-400'
                : 'text-slate-500'
            }
          />
          <span>
            Listeners:{' '}
            <strong
              className={
                metrics.activeFirestoreListeners > 2
                  ? 'text-amber-300'
                  : 'text-slate-300'
              }
            >
              {metrics.activeFirestoreListeners}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-1.25">
          <Database size={12} className="text-slate-500" />
          <span>
            Cache:{' '}
            <strong className="text-emerald-300">
              {fetchCacheHitRatio}% Hit
            </strong>{' '}
            ({metrics.firestoreCacheHits}/{metrics.totalFirestoreReads})
          </span>
        </div>

        <div className="flex items-center gap-1.25">
          <Clock size={12} className="text-slate-500" />
          <span>
            Last API:{' '}
            <strong className="text-slate-300">
              {metrics.averageApiLatency}ms
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-1.25">
          {isOnline ? (
            <Wifi size={12} className="text-cyan-400" />
          ) : (
            <WifiOff size={12} className="text-red-400" />
          )}
          <span>
            Net:{' '}
            <strong className={isOnline ? 'text-cyan-400' : 'text-red-400'}>
              {isOnline ? 'CONNECTED' : 'DISCONNECTED'}
            </strong>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded-md p-0.5"
          title="Telemetry Profiling Level"
        >
          <button
            onClick={() => setProfilingLevel('off')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              profilingLevel === 'off'
                ? 'bg-slate-700 text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Off: Zero telemetry & byte counting overhead"
          >
            Off
          </button>
          <button
            onClick={() => setProfilingLevel('basic')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              profilingLevel === 'basic'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-xs'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Basic: Fast O(1) sampling (<0.05ms execution)"
          >
            Basic
          </button>
          <button
            onClick={() => setProfilingLevel('high_fidelity')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              profilingLevel === 'high_fidelity'
                ? 'bg-amber-950 text-amber-300 border border-amber-800/60 shadow-xs'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Deep: Exact JSON & byte calculation"
          >
            Deep
          </button>
        </div>

        <div className="h-3 w-px bg-slate-800"></div>

        <button
          onClick={onCycleHeight}
          className="text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 px-2 py-0.5 rounded-md transition-colors font-label-caps-xs text-label-caps-xs flex items-center gap-1 border border-slate-800/80"
          title="Toggle console height preset (compact 35vh / medium 50vh / tall 82vh)"
        >
          <Maximize2 size={11} />
          <span className="capitalize">{heightPreset}</span>
        </button>
        <button
          onClick={onMinimize}
          className="text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 p-1 rounded-md transition-colors"
          title="Minimize"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
  );
};
