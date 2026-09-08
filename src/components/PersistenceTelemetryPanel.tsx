import React from 'react';
import {
  Database,
  Layers,
  HardDrive,
  Clock,
  BookmarkCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  DebugTelemetryEngine,
  TelemetryMetrics,
  ActiveListenerInfo,
  TelemetryBaseline,
} from '../lib/telemetry';
import {Button} from '@/components/ui/button';

interface PersistenceTelemetryPanelProps {
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
  activeListeners: ActiveListenerInfo[];
  baseline: TelemetryBaseline | null;
}

export const PersistenceTelemetryPanel: React.FC<
  PersistenceTelemetryPanelProps
> = ({metrics, fetchCacheHitRatio, activeListeners, baseline}) => {
  const engine = DebugTelemetryEngine.getInstance();

  const handleCaptureBaseline = () => {
    engine.captureBaseline();
  };

  const handleClearBaseline = () => {
    engine.clearBaseline();
  };

  const handleResetMetrics = () => {
    engine.resetMetrics();
  };

  // Format bytes helper
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Helper for computing delta and percent change
  const computeDelta = (
    current: number,
    base: number,
    lowerIsBetter = true,
  ) => {
    const diff = current - base;
    if (base === 0) {
      return {
        diff,
        percent: current > 0 ? '+100%' : '0%',
        isImprovement: false,
      };
    }
    const pct = Math.round((diff / base) * 100);
    const sign = pct > 0 ? `+${pct}%` : `${pct}%`;
    const isImprovement = lowerIsBetter ? diff < 0 : diff > 0;
    return {diff, percent: sign, isImprovement};
  };

  const isAvgDocHeavy = metrics.averageBookDocumentBytes > 2048;

  return (
    <div className="flex flex-col h-full space-y-4 font-mono text-[11px] overflow-y-auto pr-1 pb-4">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-slate-900/60 p-2.5 border border-slate-800/60 rounded-lg flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database size={15} className="text-cyan-400" />
          <span className="text-[11px] font-bold text-slate-200">
            PHASE 0: DATA &amp; PERSISTENCE PROFILER
          </span>
        </div>
        <div className="flex items-center gap-2">
          {baseline ? (
            <div className="flex items-center gap-1.5 text-[10px] bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
              <BookmarkCheck size={11} />
              <span>Baseline: {baseline.timestamp}</span>
            </div>
          ) : (
            <span className="text-[10px] text-slate-500">
              No baseline snapshot set
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCaptureBaseline}
            className="h-7 px-2.5 text-[10px] font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all flex items-center gap-1"
            title="Snapshots current metrics as baseline for comparison"
          >
            <BookmarkCheck size={11} />
            <span>Capture Baseline</span>
          </Button>
          {baseline && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearBaseline}
              className="h-7 px-2 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              title="Clear baseline snapshot"
            >
              Clear
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleResetMetrics}
            className="h-7 px-2 text-[10px] text-slate-400 hover:text-red-400 hover:bg-red-500/10"
            title="Reset live metrics to zero"
          >
            <RefreshCw size={11} />
          </Button>
        </div>
      </div>

      {/* 4 Core Telemetry Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Gauge 1: Cumulative Payload Transferred */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[10px]">
            <span className="flex items-center gap-1">
              <HardDrive size={12} className="text-cyan-400" />
              NET TRANSFERRED
            </span>
            <span className="text-slate-500">Cumulative</span>
          </div>
          <div className="text-xl font-bold text-cyan-300">
            {formatBytes(metrics.totalBytesTransferred)}
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>
              Last query: {formatBytes(metrics.lastQueryPayloadBytes)}
            </span>
            <span
              className={
                metrics.totalBytesTransferred > 2 * 1024 * 1024
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }
            >
              {metrics.totalBytesTransferred > 2 * 1024 * 1024
                ? 'High'
                : 'Normal'}
            </span>
          </div>
        </div>

        {/* Gauge 2: Average Book Doc Size */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[10px]">
            <span className="flex items-center gap-1">
              <Database size={12} className="text-purple-400" />
              AVG BOOK DOC SIZE
            </span>
            <span className="text-slate-500">Target &lt; 2 KB</span>
          </div>
          <div className="flex items-center justify-between">
            <span
              className={`text-xl font-bold ${
                isAvgDocHeavy ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {formatBytes(metrics.averageBookDocumentBytes)}
            </span>
            {isAvgDocHeavy ? (
              <span className="inline-flex items-center gap-1 text-[9px] bg-amber-950/60 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">
                <AlertTriangle size={10} />
                Heavy Payload
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                <CheckCircle2 size={10} />
                Optimized
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 border-t border-slate-800/50 pt-1.5">
            {isAvgDocHeavy
              ? 'Embedding/synopsis leak in collection'
              : 'Lean document size verified'}
          </div>
        </div>

        {/* Gauge 3: Active Firestore Listeners */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[10px]">
            <span className="flex items-center gap-1">
              <Layers size={12} className="text-amber-400" />
              ACTIVE LISTENERS
            </span>
            <span className="text-slate-500">Real-time</span>
          </div>
          <div className="flex items-center justify-between">
            <span
              className={`text-xl font-bold ${
                metrics.activeFirestoreListeners > 2
                  ? 'text-amber-400'
                  : 'text-cyan-300'
              }`}
            >
              {metrics.activeFirestoreListeners}
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded ${
                metrics.activeFirestoreListeners > 2
                  ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {metrics.activeFirestoreListeners > 2
                ? 'Multiple (Proliferation)'
                : 'Consolidated'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 border-t border-slate-800/50 pt-1.5">
            {activeListeners.length} registered onSnapshot channel
            {activeListeners.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Gauge 4: Cache Hit Ratio & Parse Latency */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[10px]">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-emerald-400" />
              CACHE &amp; PARSE
            </span>
            <span className="text-slate-500">{fetchCacheHitRatio}% Hit</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-emerald-400">
              {fetchCacheHitRatio}%
            </span>
            <span className="text-[10px] text-slate-400">
              {metrics.firestoreCacheHits} / {metrics.totalFirestoreReads} hits
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>Parse latency</span>
            <span className="text-slate-300 font-bold">
              {metrics.snapshotParseDurationMs}ms
            </span>
          </div>
        </div>
      </div>

      {/* Delta Comparison Section (when Baseline exists) */}
      {baseline && (
        <div className="border border-cyan-900/50 bg-cyan-950/10 p-3 rounded-xl flex flex-col space-y-2.5">
          <div className="flex items-center justify-between border-b border-cyan-900/40 pb-1.5">
            <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-[10px] uppercase tracking-wider">
              <BookmarkCheck size={12} />
              <span>Before &amp; After Snapshot Profiler</span>
            </div>
            <span className="text-[10px] text-slate-400">
              Baseline captured at {baseline.timestamp}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-500 text-[10px]">
                  <th className="py-1 px-2">Metric</th>
                  <th className="py-1 px-2">Baseline</th>
                  <th className="py-1 px-2">Current Live</th>
                  <th className="py-1 px-2">Delta Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {/* Row 1: Transferred Bytes */}
                {(() => {
                  const {percent, isImprovement} = computeDelta(
                    metrics.totalBytesTransferred,
                    baseline.metrics.totalBytesTransferred,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Transferred Payload
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {formatBytes(baseline.metrics.totalBytesTransferred)}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {formatBytes(metrics.totalBytesTransferred)}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isImprovement
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {isImprovement ? (
                            <TrendingDown size={11} />
                          ) : (
                            <TrendingUp size={11} />
                          )}
                          {percent}
                        </span>
                      </td>
                    </tr>
                  );
                })()}

                {/* Row 2: Average Book Document Bytes */}
                {(() => {
                  const {percent, isImprovement} = computeDelta(
                    metrics.averageBookDocumentBytes,
                    baseline.metrics.averageBookDocumentBytes,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Avg Book Document Size
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {formatBytes(baseline.metrics.averageBookDocumentBytes)}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {formatBytes(metrics.averageBookDocumentBytes)}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isImprovement
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {isImprovement ? (
                            <TrendingDown size={11} />
                          ) : (
                            <TrendingUp size={11} />
                          )}
                          {percent}
                        </span>
                      </td>
                    </tr>
                  );
                })()}

                {/* Row 3: Active Firestore Listeners */}
                {(() => {
                  const {percent, isImprovement} = computeDelta(
                    metrics.activeFirestoreListeners,
                    baseline.metrics.activeFirestoreListeners,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Active Listeners
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {baseline.metrics.activeFirestoreListeners}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {metrics.activeFirestoreListeners}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isImprovement
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {isImprovement ? (
                            <TrendingDown size={11} />
                          ) : (
                            <TrendingUp size={11} />
                          )}
                          {percent}
                        </span>
                      </td>
                    </tr>
                  );
                })()}

                {/* Row 4: Total Firestore Reads */}
                {(() => {
                  const {diff} = computeDelta(
                    metrics.totalFirestoreReads,
                    baseline.metrics.totalFirestoreReads,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Total Firestore Reads
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {baseline.metrics.totalFirestoreReads}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {metrics.totalFirestoreReads}
                      </td>
                      <td className="py-1.5 px-2 text-slate-300 text-[10px]">
                        +{diff} reads since baseline
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Listeners Live Registry */}
      <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
          <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
            <Layers size={12} className="text-amber-400" />
            <span>Active Firestore Listeners Registry</span>
          </div>
          <span className="text-[10px] text-slate-500 font-normal">
            {activeListeners.length} active channel
            {activeListeners.length !== 1 ? 's' : ''}
          </span>
        </div>

        {activeListeners.length === 0 ? (
          <div className="py-4 text-center text-slate-600 italic">
            No active Firestore listeners currently open.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40 max-h-[140px] overflow-y-auto">
            {activeListeners.map(l => (
              <div
                key={l.id}
                className="py-1.5 flex items-center justify-between text-[10px] hover:bg-slate-900/40 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-semibold text-cyan-300">{l.name}</span>
                  <span className="text-slate-500 truncate max-w-[260px] sm:max-w-md">
                    {l.path}
                  </span>
                </div>
                <span className="text-slate-500 font-mono text-[9px]">
                  Started {l.startedAt}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
