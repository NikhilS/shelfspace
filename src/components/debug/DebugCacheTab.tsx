import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {
  Database,
  HardDrive,
  RefreshCw,
  Trash2,
  BookmarkCheck,
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Layers,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {queryClient, QUERY_CACHE_BUSTER} from '../../lib/queryClient';
import {
  DebugTelemetryEngine,
  TelemetryMetrics,
  TelemetryBaseline,
  ActiveListenerInfo,
  calculatePayloadBytes,
} from '../../lib/telemetry';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

interface DebugCacheTabProps {
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
  baseline: TelemetryBaseline | null;
  activeListeners: ActiveListenerInfo[];
}

interface InspectedQueryEntry {
  queryHash: string;
  keyLabel: string;
  rawKey: readonly unknown[];
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isStale: boolean;
  observersCount: number;
  dataUpdatedAt: number;
  itemCount: number | null;
  estimatedBytes: number;
  data: unknown;
  error: unknown;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatQueryKey(queryKey: readonly unknown[]): string {
  try {
    if (Array.isArray(queryKey) && Array.isArray(queryKey[0])) {
      const path = (queryKey[0] as string[]).join('.');
      const input = queryKey[1];
      if (input && typeof input === 'object' && 'input' in input) {
        return `${path}(${JSON.stringify((input as {input: unknown}).input)})`;
      }
      return path;
    }
    return JSON.stringify(queryKey);
  } catch {
    return String(queryKey);
  }
}

function extractItemCount(data: unknown): number | null {
  if (!data) return null;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.books)) return obj.books.length;
    if (Array.isArray(obj.libraries)) return obj.libraries.length;
    if (obj.details && typeof obj.details === 'object') {
      return Object.keys(obj.details).length;
    }
  }
  return null;
}

export const DebugCacheTab: React.FC<DebugCacheTabProps> = ({
  metrics,
  fetchCacheHitRatio,
  baseline,
  activeListeners,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe(() => {
      setRefreshTick(t => t + 1);
    });
    return unsub;
  }, []);

  const queryEntries = useMemo((): InspectedQueryEntry[] => {
    void refreshTick;
    const all = queryClient.getQueryCache().getAll();
    return all
      .map(q => {
        const keyLabel = formatQueryKey(q.queryKey);
        const data = q.state.data;
        const estimatedBytes =
          data !== undefined
            ? calculatePayloadBytes(data, {level: 'basic'})
            : 0;
        return {
          queryHash: q.queryHash,
          keyLabel,
          rawKey: q.queryKey,
          status: q.state.status,
          fetchStatus: q.state.fetchStatus,
          isStale: q.isStale(),
          observersCount: q.getObserversCount(),
          dataUpdatedAt: q.state.dataUpdatedAt,
          itemCount: extractItemCount(data),
          estimatedBytes,
          data,
          error: q.state.error,
        };
      })
      .filter(entry => !entry.keyLabel.includes('debugTelemetry'))
      .sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt);
  }, [refreshTick]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return queryEntries;
    const q = searchQuery.toLowerCase();
    return queryEntries.filter(e => e.keyLabel.toLowerCase().includes(q));
  }, [queryEntries, searchQuery]);

  const cacheSummary = useMemo(() => {
    let totalMemoryBytes = 0;
    let freshCount = 0;
    let staleCount = 0;
    let fetchingCount = 0;

    for (const entry of queryEntries) {
      totalMemoryBytes += entry.estimatedBytes;
      if (entry.fetchStatus === 'fetching') {
        fetchingCount++;
      }
      if (entry.status === 'success') {
        if (entry.isStale) {
          staleCount++;
        } else {
          freshCount++;
        }
      }
    }

    return {
      totalQueries: queryEntries.length,
      totalMemoryBytes,
      freshCount,
      staleCount,
      fetchingCount,
    };
  }, [queryEntries]);

  const handleInvalidateQuery = useCallback(
    async (rawKey: readonly unknown[]) => {
      await queryClient.invalidateQueries({queryKey: rawKey});
      setRefreshTick(t => t + 1);
    },
    [],
  );

  const handleRemoveQuery = useCallback((rawKey: readonly unknown[]) => {
    queryClient.removeQueries({queryKey: rawKey});
    setRefreshTick(t => t + 1);
  }, []);

  const handleInvalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries();
    setRefreshTick(t => t + 1);
  }, []);

  const handleCopyPayload = (hash: string, data: unknown) => {
    try {
      void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const engine = DebugTelemetryEngine.getInstance();

  return (
    <div className="flex flex-col h-full space-y-3 font-mono text-xs overflow-y-auto pr-1 pb-3">
      {/* Header & Baseline Actions */}
      <div className="flex items-center justify-between bg-slate-900/60 p-2.5 border border-slate-800/60 rounded-lg flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-cyan-400" />
          <span className="font-label-caps-sm text-label-caps-sm font-bold text-slate-200 uppercase tracking-wider">
            TANSTACK QUERY &amp; INDEXEDDB CACHE INSPECTOR
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {baseline && (
            <span className="font-label-caps-xs text-label-caps-xs bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded">
              Baseline: {baseline.timestamp}
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => engine.captureBaseline()}
            className="font-label-caps-sm text-label-caps-sm font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 rounded flex items-center gap-1"
          >
            <BookmarkCheck size={11} />
            <span>Capture Baseline</span>
          </Button>
          {baseline && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => engine.clearBaseline()}
              className="font-label-caps-sm text-label-caps-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded"
            >
              Clear Baseline
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void handleInvalidateAll()}
            className="font-label-caps-sm text-label-caps-sm text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 rounded flex items-center gap-1"
            title="Invalidate and refetch active queries"
          >
            <RefreshCw size={11} />
            <span>Invalidate All</span>
          </Button>
        </div>
      </div>

      {/* 4 Core Cache & Persistence Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span>CACHE HIT RATIO</span>
            <span className="text-slate-500 normal-case">Session</span>
          </div>
          <div className="text-xl font-bold text-emerald-400">
            {fetchCacheHitRatio}%
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>
              {metrics.firestoreCacheHits} hits / {metrics.totalFirestoreReads}{' '}
              reads
            </span>
            <span className="text-emerald-400">offlineFirst</span>
          </div>
        </div>

        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span>IN-MEMORY QUERIES</span>
            <span className="text-slate-500 normal-case">QueryCache</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-cyan-300">
              {cacheSummary.totalQueries}
            </span>
            <span className="text-[11px] text-slate-400">
              ~{formatBytes(cacheSummary.totalMemoryBytes)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span className="text-emerald-400">
              {cacheSummary.freshCount} fresh
            </span>
            <span className="text-amber-400">
              {cacheSummary.staleCount} stale
            </span>
            <span className="text-cyan-400">
              {cacheSummary.fetchingCount} fetching
            </span>
          </div>
        </div>

        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1">
              <HardDrive size={12} className="text-purple-400" />
              INDEXEDDB PERSISTER
            </span>
            <span className="text-slate-500 normal-case">
              {QUERY_CACHE_BUSTER}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-purple-300 uppercase">
              {metrics.idbPersistStatus}
            </span>
            <span className="text-xs text-slate-300 font-semibold">
              {formatBytes(metrics.idbPersistedBytes)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>
              {metrics.idbHydratedAt
                ? `Synced at ${metrics.idbHydratedAt}`
                : 'idb-keyval storage'}
            </span>
            <span className="text-slate-400">TTL: 7d</span>
          </div>
        </div>

        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1">
              <Layers size={12} className="text-amber-400" />
              NET TRANSFERRED
            </span>
            <span className="text-slate-500 normal-case">Cumulative</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-amber-300">
              {formatBytes(metrics.totalBytesTransferred)}
            </span>
            <span className="text-[11px] text-slate-400">
              {activeListeners.length} active stream
              {activeListeners.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>
              Avg Book Doc: {formatBytes(metrics.averageBookDocumentBytes)}
            </span>
            <span>Last: {formatBytes(metrics.lastQueryPayloadBytes)}</span>
          </div>
        </div>
      </div>

      {/* Before & After Snapshot Profiler when Baseline is captured */}
      {baseline && (
        <div className="border border-cyan-900/50 bg-cyan-950/10 p-3 rounded-lg space-y-2">
          <div className="flex items-center justify-between border-b border-cyan-900/40 pb-1.5">
            <span className="text-cyan-400 font-bold uppercase text-[11px]">
              Before &amp; After Snapshot Profiler (Baseline:{' '}
              {baseline.timestamp})
            </span>
            <span className="text-[11px] text-slate-400">
              Delta since snapshot
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
              <div className="text-slate-500">Transferred Bytes</div>
              <div className="font-bold text-slate-200 flex items-center gap-1 mt-0.5">
                {formatBytes(baseline.metrics.totalBytesTransferred)} &rarr;{' '}
                {formatBytes(metrics.totalBytesTransferred)}
                {metrics.totalBytesTransferred <=
                baseline.metrics.totalBytesTransferred ? (
                  <TrendingDown size={11} className="text-emerald-400" />
                ) : (
                  <TrendingUp size={11} className="text-amber-400" />
                )}
              </div>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
              <div className="text-slate-500">Cache Reads / Hits</div>
              <div className="font-bold text-slate-200 mt-0.5">
                +
                {metrics.totalFirestoreReads -
                  baseline.metrics.totalFirestoreReads}{' '}
                reads (+
                {metrics.firestoreCacheHits -
                  baseline.metrics.firestoreCacheHits}{' '}
                hits)
              </div>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
              <div className="text-slate-500">Avg Book Doc Size</div>
              <div className="font-bold text-slate-200 mt-0.5">
                {formatBytes(baseline.metrics.averageBookDocumentBytes)} &rarr;{' '}
                {formatBytes(metrics.averageBookDocumentBytes)}
              </div>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
              <div className="text-slate-500">Mutations Recorded</div>
              <div className="font-bold text-amber-300 mt-0.5">
                +
                {metrics.totalFirestoreWrites -
                  (baseline.metrics.totalFirestoreWrites ?? 0)}{' '}
                writes
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Query Key Inventory Table */}
      <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-lg flex flex-col space-y-2.5 flex-1 min-h-[180px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-2">
          <span className="text-slate-300 font-bold uppercase text-[11px] tracking-wider">
            Query Cache Entries ({filteredEntries.length})
          </span>
          <div className="relative w-full sm:w-64">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter query keys..."
              className="h-7 pl-7 text-xs bg-slate-950 border-slate-800 text-slate-200 rounded font-mono"
            />
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="py-6 text-center text-slate-500 italic">
            No cached queries match the current filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50 overflow-y-auto space-y-1">
            {filteredEntries.map(entry => {
              const isExpanded = expandedHash === entry.queryHash;
              const ageSec =
                entry.dataUpdatedAt > 0
                  ? Math.max(
                      0,
                      Math.round((Date.now() - entry.dataUpdatedAt) / 1000),
                    )
                  : null;

              return (
                <div
                  key={entry.queryHash}
                  className="py-1.5 px-2 rounded bg-slate-950/40 hover:bg-slate-900/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHash(isExpanded ? null : entry.queryHash)
                      }
                      className="flex items-center gap-2 text-left min-w-0 flex-1"
                    >
                      {isExpanded ? (
                        <ChevronDown
                          size={13}
                          className="text-cyan-400 shrink-0"
                        />
                      ) : (
                        <ChevronRight
                          size={13}
                          className="text-slate-500 shrink-0"
                        />
                      )}
                      <span className="font-semibold text-slate-200 truncate">
                        {entry.keyLabel}
                      </span>
                      {entry.itemCount !== null && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 text-[10px]">
                          {entry.itemCount} items
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-2 shrink-0 text-[11px]">
                      {entry.fetchStatus === 'fetching' ? (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-bold uppercase text-[10px]">
                          FETCHING
                        </span>
                      ) : entry.status === 'error' ? (
                        <span className="px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-500/30 font-bold uppercase text-[10px]">
                          ERROR
                        </span>
                      ) : entry.isStale ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-400 border border-amber-500/30 font-bold uppercase text-[10px]">
                          STALE
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-500/30 font-bold uppercase text-[10px]">
                          FRESH
                        </span>
                      )}

                      <span className="text-slate-400 w-16 text-right">
                        {formatBytes(entry.estimatedBytes)}
                      </span>

                      <span className="text-slate-500 w-14 text-right">
                        {ageSec !== null ? `${ageSec}s ago` : '—'}
                      </span>

                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleInvalidateQuery(entry.rawKey)}
                        className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded"
                        title="Invalidate & Refetch"
                      >
                        <RefreshCw size={11} />
                      </Button>

                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleRemoveQuery(entry.rawKey)}
                        className="h-6 px-1.5 text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded"
                        title="Evict from QueryCache"
                      >
                        <Trash2 size={11} />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          Observers: {entry.observersCount} | QueryHash:{' '}
                          {entry.queryHash}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            handleCopyPayload(entry.queryHash, entry.data)
                          }
                          className="h-6 px-2 text-[10px] text-slate-300 hover:bg-slate-800 rounded flex items-center gap-1"
                        >
                          {copiedHash === entry.queryHash ? (
                            <>
                              <Check size={11} className="text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>Copy JSON</span>
                            </>
                          )}
                        </Button>
                      </div>
                      <pre className="p-2 bg-slate-950 border border-slate-900 rounded text-[11px] text-slate-300 max-h-48 overflow-auto select-all">
                        {JSON.stringify(entry.data ?? entry.error, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
