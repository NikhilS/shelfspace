import React, {useState, useEffect, useMemo} from 'react';
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
  ArrowUpRight,
} from 'lucide-react';
import {
  DebugTelemetryEngine,
  TelemetryMetrics,
  ActiveListenerInfo,
  TelemetryBaseline,
  TelemetryPluginContext,
  TelemetryLog,
  MutationTelemetryPayload,
} from '../lib/telemetry';
import {Button} from '@/components/ui/button';

interface PersistenceTelemetryPanelProps {
  metrics?: TelemetryMetrics;
  fetchCacheHitRatio?: number;
  activeListeners?: ActiveListenerInfo[];
  baseline?: TelemetryBaseline | null;
  initialContext?: TelemetryPluginContext;
}

export const PersistenceTelemetryPanel: React.FC<
  PersistenceTelemetryPanelProps
> = ({
  metrics: propMetrics,
  fetchCacheHitRatio: propCacheHitRatio,
  activeListeners: propActiveListeners,
  baseline: propBaseline,
  initialContext,
}) => {
  const engine = DebugTelemetryEngine.getInstance();

  const [liveMetrics, setLiveMetrics] = useState<TelemetryMetrics>(
    initialContext?.metrics || propMetrics || engine.getMetrics(),
  );
  const [liveListeners, setLiveListeners] = useState<ActiveListenerInfo[]>(
    initialContext?.activeListeners ||
      propActiveListeners ||
      engine.getActiveListeners(),
  );
  const [liveBaseline, setLiveBaseline] = useState<TelemetryBaseline | null>(
    initialContext?.baseline !== undefined
      ? initialContext.baseline
      : propBaseline !== undefined
        ? propBaseline
        : engine.getBaseline(),
  );
  const [logs, setLogs] = useState<TelemetryLog[]>(
    initialContext?.logs || engine.getLogs(),
  );

  useEffect(() => {
    const unsub = engine.subscribe(() => {
      setLiveMetrics(engine.getMetrics());
      setLiveListeners(engine.getActiveListeners());
      setLiveBaseline(engine.getBaseline());
      setLogs(engine.getLogs());
    });
    return unsub;
  }, [engine]);

  const metrics = propMetrics || liveMetrics;
  const activeListeners = propActiveListeners || liveListeners;
  const baseline = propBaseline !== undefined ? propBaseline : liveBaseline;

  const fetchCacheHitRatio = useMemo(() => {
    if (propCacheHitRatio !== undefined) return propCacheHitRatio;
    const total = metrics.totalFirestoreReads;
    if (total === 0) return 100;
    return Math.round((metrics.firestoreCacheHits / total) * 100);
  }, [
    propCacheHitRatio,
    metrics.totalFirestoreReads,
    metrics.firestoreCacheHits,
  ]);

  const recentWrites = useMemo(() => {
    return logs.filter(l => l.type === 'db_write').slice(0, 10);
  }, [logs]);

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
    <div className="flex flex-col h-full space-y-4 font-mono text-body-xs overflow-y-auto pr-1 pb-4">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-slate-900/60 p-2.5 border border-slate-800/60 rounded-lg flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database size={15} className="text-cyan-400" />
          <span className="font-label-caps-sm text-label-caps-sm font-bold text-slate-200 uppercase tracking-wider">
            PHASE 0: DATA &amp; PERSISTENCE PROFILER
          </span>
        </div>
        <div className="flex items-center gap-2">
          {baseline ? (
            <div className="flex items-center gap-1.5 font-label-caps-xs text-label-caps-xs bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
              <BookmarkCheck size={11} />
              <span>Baseline: {baseline.timestamp}</span>
            </div>
          ) : (
            <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
              No baseline snapshot set
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={handleCaptureBaseline}
            className="font-label-caps-sm text-label-caps-sm font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all flex items-center gap-1"
            title="Snapshots current metrics as baseline for comparison"
          >
            <BookmarkCheck size={11} />
            <span>Capture Baseline</span>
          </Button>
          {baseline && (
            <Button
              size="xs"
              variant="ghost"
              onClick={handleClearBaseline}
              className="font-label-caps-sm text-label-caps-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              title="Clear baseline snapshot"
            >
              Clear
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={handleResetMetrics}
            className="font-label-caps-sm text-label-caps-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10"
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
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <HardDrive size={12} className="text-cyan-400" />
              NET TRANSFERRED
            </span>
            <span className="text-slate-500 normal-case">Cumulative</span>
          </div>
          <div className="text-xl font-bold text-cyan-300">
            {formatBytes(metrics.totalBytesTransferred)}
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
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
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Database size={12} className="text-purple-400" />
              AVG BOOK DOC SIZE
            </span>
            <span className="text-slate-500 normal-case">Target &lt; 2 KB</span>
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
              <span className="inline-flex items-center gap-1 font-label-caps-xs text-label-caps-xs bg-amber-950/60 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">
                <AlertTriangle size={10} />
                Heavy Payload
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-label-caps-xs text-label-caps-xs bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                <CheckCircle2 size={10} />
                Optimized
              </span>
            )}
          </div>
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            {isAvgDocHeavy
              ? 'Embedding/synopsis leak in collection'
              : 'Lean document size verified'}
          </div>
        </div>

        {/* Gauge 3: Active Firestore Listeners */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Layers size={12} className="text-amber-400" />
              ACTIVE LISTENERS
            </span>
            <span className="text-slate-500 normal-case">Real-time</span>
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
              className={`font-label-caps-xs text-label-caps-xs px-1.5 py-0.5 rounded ${
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
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            {activeListeners.length} registered onSnapshot channel
            {activeListeners.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Gauge 4: Cache Hit Ratio & Parse Latency */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-emerald-400" />
              CACHE &amp; PARSE
            </span>
            <span className="text-slate-500 normal-case">
              {fetchCacheHitRatio}% Hit
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-emerald-400">
              {fetchCacheHitRatio}%
            </span>
            <span className="font-body-xs text-body-xs text-slate-400">
              {metrics.firestoreCacheHits} / {metrics.totalFirestoreReads} hits
            </span>
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>Parse latency</span>
            <span className="text-slate-300 font-bold">
              {metrics.snapshotParseDurationMs}ms
            </span>
          </div>
        </div>
      </div>

      {/* Row 2 Gauges: Firestore Write Profiler */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Write Gauge 1: Total Writes */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <ArrowUpRight size={12} className="text-amber-400" />
              FIRESTORE WRITES
            </span>
            <span className="text-slate-500 normal-case">Mutations</span>
          </div>
          <div className="text-xl font-bold text-amber-300">
            {metrics.totalFirestoreWrites}
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>Payload: {formatBytes(metrics.totalBytesWritten)}</span>
            <span className="text-amber-400">Tracked</span>
          </div>
        </div>

        {/* Write Gauge 2: Average Write Latency */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-cyan-400" />
              AVG WRITE LATENCY
            </span>
            <span className="text-slate-500 normal-case">Commit</span>
          </div>
          <div className="text-xl font-bold text-cyan-300">
            {metrics.averageWriteLatency} ms
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>Sliding Window (50)</span>
            <span
              className={
                metrics.averageWriteLatency > 500
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }
            >
              {metrics.averageWriteLatency > 500 ? 'Slow' : 'Fast'}
            </span>
          </div>
        </div>

        {/* Write Gauge 3: Payload Written */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <HardDrive size={12} className="text-emerald-400" />
              PAYLOAD WRITTEN
            </span>
            <span className="text-slate-500 normal-case">Cumulative</span>
          </div>
          <div className="text-xl font-bold text-emerald-300">
            {formatBytes(metrics.totalBytesWritten)}
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>
              Last write: {formatBytes(metrics.lastWritePayloadBytes)}
            </span>
            <span className="text-slate-400">UTF-8</span>
          </div>
        </div>

        {/* Write Gauge 4: Write / Read Ratio */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Layers size={12} className="text-purple-400" />
              WRITE / READ RATIO
            </span>
            <span className="text-slate-500 normal-case">Traffic Mix</span>
          </div>
          <div className="text-xl font-bold text-purple-300">
            {metrics.totalFirestoreReads > 0
              ? (
                  metrics.totalFirestoreWrites / metrics.totalFirestoreReads
                ).toFixed(2)
              : '0.00'}
          </div>
          <div className="flex items-center justify-between font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5">
            <span>
              {metrics.totalFirestoreWrites}W / {metrics.totalFirestoreReads}R
            </span>
            <span className="text-purple-400">Balanced</span>
          </div>
        </div>
      </div>

      {/* Delta Comparison Section (when Baseline exists) */}
      {baseline && (
        <div className="border border-cyan-900/50 bg-cyan-950/10 p-3 rounded-xl flex flex-col space-y-2.5">
          <div className="flex items-center justify-between border-b border-cyan-900/40 pb-1.5">
            <div className="flex items-center gap-1.5 text-cyan-400 font-bold font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
              <BookmarkCheck size={12} />
              <span>Before &amp; After Snapshot Profiler</span>
            </div>
            <span className="font-body-xs text-body-xs text-slate-400">
              Baseline captured at {baseline.timestamp}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-body-xs text-body-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-500 font-label-caps-sm text-label-caps-sm uppercase">
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
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-label-caps-xs text-label-caps-xs font-bold ${
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
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-label-caps-xs text-label-caps-xs font-bold ${
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
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-label-caps-xs text-label-caps-xs font-bold ${
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
                      <td className="py-1.5 px-2 text-slate-300 font-body-xs text-body-xs">
                        +{diff} reads since baseline
                      </td>
                    </tr>
                  );
                })()}

                {/* Row 5: Total Firestore Writes */}
                {(() => {
                  const baseWrites = baseline.metrics.totalFirestoreWrites ?? 0;
                  const {diff} = computeDelta(
                    metrics.totalFirestoreWrites,
                    baseWrites,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Total Firestore Writes
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {baseWrites}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-amber-300">
                        {metrics.totalFirestoreWrites}
                      </td>
                      <td className="py-1.5 px-2 text-slate-300 font-body-xs text-body-xs">
                        +{diff} mutations since baseline
                      </td>
                    </tr>
                  );
                })()}

                {/* Row 6: Total Bytes Written */}
                {(() => {
                  const baseBytes = baseline.metrics.totalBytesWritten ?? 0;
                  const {percent, isImprovement} = computeDelta(
                    metrics.totalBytesWritten,
                    baseBytes,
                    true,
                  );
                  return (
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400 font-medium">
                        Payload Bytes Written
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {formatBytes(baseBytes)}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-emerald-300">
                        {formatBytes(metrics.totalBytesWritten)}
                      </td>
                      <td
                        className={`py-1.5 px-2 font-bold font-body-xs text-body-xs ${
                          isImprovement ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {percent}
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Write Mutations Registry */}
      <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
          <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase font-label-caps-sm text-label-caps-sm tracking-wider">
            <ArrowUpRight size={12} className="text-amber-400" />
            <span>Recent Firestore Mutations Stream</span>
          </div>
          <span className="font-body-xs text-body-xs text-slate-500 font-normal">
            {recentWrites.length} recorded mutation
            {recentWrites.length !== 1 ? 's' : ''}
          </span>
        </div>

        {recentWrites.length === 0 ? (
          <div className="py-4 text-center text-slate-600 italic font-body-xs text-body-xs">
            No Firestore write operations recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40 max-h-[160px] overflow-y-auto">
            {recentWrites.map(w => {
              const payload = w.payload as MutationTelemetryPayload | undefined;
              return (
                <div
                  key={w.id}
                  className="py-1.5 flex items-center justify-between font-body-xs text-body-xs hover:bg-slate-900/40 px-1 rounded transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-label-caps-xs text-label-caps-xs px-1.5 py-0.5 rounded font-bold uppercase ${
                        payload?.mutationType === 'deleteDoc'
                          ? 'bg-red-950/70 text-red-400 border border-red-500/30'
                          : payload?.mutationType === 'writeBatch'
                            ? 'bg-purple-950/70 text-purple-400 border border-purple-500/30'
                            : 'bg-amber-950/70 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {payload?.mutationType ?? 'WRITE'}
                    </span>
                    <span className="text-slate-300 truncate max-w-[200px] sm:max-w-xs font-mono">
                      {payload?.path ?? w.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 font-mono font-label-caps-xs text-label-caps-xs">
                    {payload?.commitDurationMs !== undefined && (
                      <span className="text-cyan-400 font-bold">
                        {payload.commitDurationMs}ms
                      </span>
                    )}
                    {payload?.bytes !== undefined && (
                      <span className="text-slate-400">
                        {formatBytes(payload.bytes)}
                      </span>
                    )}
                    <span className="text-slate-500">{w.timestamp}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Listeners Live Registry */}
      <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
          <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase font-label-caps-sm text-label-caps-sm tracking-wider">
            <Layers size={12} className="text-amber-400" />
            <span>Active Firestore Listeners Registry</span>
          </div>
          <span className="font-body-xs text-body-xs text-slate-500 font-normal">
            {activeListeners.length} active channel
            {activeListeners.length !== 1 ? 's' : ''}
          </span>
        </div>

        {activeListeners.length === 0 ? (
          <div className="py-4 text-center text-slate-600 italic font-body-xs text-body-xs">
            No active Firestore listeners currently open.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40 max-h-[140px] overflow-y-auto">
            {activeListeners.map(l => (
              <div
                key={l.id}
                className="py-1.5 flex items-center justify-between font-body-xs text-body-xs hover:bg-slate-900/40 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-semibold text-cyan-300">{l.name}</span>
                  <span className="text-slate-500 truncate max-w-[260px] sm:max-w-md">
                    {l.path}
                  </span>
                </div>
                <span className="text-slate-500 font-mono font-label-caps-xs text-label-caps-xs">
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
