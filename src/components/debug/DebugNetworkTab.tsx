import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {
  Activity,
  Server,
  RefreshCw,
  Sparkles,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {TelemetryLog, TelemetryMetrics} from '../../lib/telemetry';
import {trpcVanilla} from '../../lib/trpc';
import type {TelemetryLogPayload} from '../../types';
import type {ServerTelemetrySnapshot} from '../../server/services/telemetry/serverTelemetryBuffer';
import {Button} from '@/components/ui/button';

interface DebugNetworkTabProps {
  networkLogs: TelemetryLog[];
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
}

type NetworkSourceFilter = 'all' | 'client' | 'server' | 'errors';

function asTelemetryPayload(payload: unknown): TelemetryLogPayload | null {
  if (payload && typeof payload === 'object') {
    return payload as TelemetryLogPayload;
  }
  return null;
}

export const DebugNetworkTab: React.FC<DebugNetworkTabProps> = ({
  networkLogs,
  metrics,
  fetchCacheHitRatio,
}) => {
  const [serverSnapshot, setServerSnapshot] =
    useState<ServerTelemetrySnapshot | null>(null);
  const [isLoadingServer, setIsLoadingServer] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<NetworkSourceFilter>('all');

  const fetchServerTelemetry = useCallback(async () => {
    try {
      setIsLoadingServer(true);
      const client = trpcVanilla as unknown as {
        metadata?: {
          debugTelemetry?: {
            query: (input?: {
              sinceMs?: number;
            }) => Promise<ServerTelemetrySnapshot>;
          };
        };
      };
      if (client?.metadata?.debugTelemetry?.query) {
        const snap = await client.metadata.debugTelemetry.query();
        setServerSnapshot(snap);
      }
    } catch {
      // Ignore transient errors when offline or in unit tests
    } finally {
      setIsLoadingServer(false);
    }
  }, []);

  useEffect(() => {
    void fetchServerTelemetry();
    const timer = setInterval(() => {
      void fetchServerTelemetry();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchServerTelemetry]);

  const totalGeminiTokens =
    (serverSnapshot?.totals.totalGeminiTokens || 0) + metrics.totalGeminiTokens;
  const totalServerCalls = serverSnapshot?.totals.totalCalls || 0;
  const totalRateLimits = serverSnapshot?.totals.totalRateLimits || 0;

  const filteredClientLogs = useMemo(() => {
    if (sourceFilter === 'server') return [];
    if (sourceFilter === 'errors') {
      return networkLogs.filter(l => {
        const p = asTelemetryPayload(l.payload);
        return (
          l.type === 'error' ||
          l.status === 'error' ||
          (typeof l.status === 'number' && l.status >= 400) ||
          p?.status === 'error'
        );
      });
    }
    return networkLogs;
  }, [networkLogs, sourceFilter]);

  const filteredServerEntries = useMemo(() => {
    const entries = serverSnapshot?.entries || [];
    if (sourceFilter === 'client') return [];
    if (sourceFilter === 'errors') {
      return entries.filter(e => e.status !== 'ok');
    }
    return entries;
  }, [serverSnapshot, sourceFilter]);

  return (
    <div className="flex flex-col h-full space-y-3 font-mono text-xs overflow-y-auto pr-1 pb-3">
      {/* Top KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 bg-slate-900/60 p-3 rounded-lg border border-slate-800/50">
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            CLIENT TRPC CALLS
          </span>
          <strong className="text-sm text-slate-200">
            {metrics.totalApiRequests} req ({metrics.averageApiLatency}ms)
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            TOTAL SERVICE READS
          </span>
          <strong className="text-sm text-emerald-400">
            {metrics.totalFirestoreReads} ({fetchCacheHitRatio}% cache)
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            SERVER OUTBOUND CALLS
          </span>
          <strong className="text-sm text-cyan-400">
            {totalServerCalls} calls
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            GEMINI AI TOKENS
          </span>
          <strong className="text-sm text-purple-300">
            {totalGeminiTokens.toLocaleString()} tok
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            QUOTA / 429 COOLDOWNS
          </span>
          <strong
            className={`text-sm ${
              totalRateLimits > 0 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {totalRateLimits} rate-limits
          </strong>
        </div>
      </div>

      {/* Server Provider Quota & Concurrency Governor Strip */}
      {serverSnapshot && serverSnapshot.providers.length > 0 && (
        <div className="border border-slate-800/80 bg-slate-900/30 p-2.5 rounded-lg space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800/60 pb-1.5">
            <div className="flex items-center gap-2">
              <Server size={13} className="text-cyan-400" />
              <span className="font-bold text-slate-200 uppercase text-[11px] tracking-wider">
                Outbound Provider Quota Scheduler &amp; Governor
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 text-[10px]">
                Global Slots: {serverSnapshot.governor.activeTotal}/
                {serverSnapshot.governor.maxGlobalConcurrent} (Interactive:{' '}
                {serverSnapshot.governor.activeInteractive} | Batch:{' '}
                {serverSnapshot.governor.activeBatch})
              </span>
            </div>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void fetchServerTelemetry()}
              className="h-6 px-2 text-[10px] text-slate-300 hover:bg-slate-800 rounded flex items-center gap-1"
            >
              <RefreshCw
                size={10}
                className={isLoadingServer ? 'animate-spin' : ''}
              />
              <span>Refresh</span>
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {serverSnapshot.providers.map(p => {
              const isHealthy = p.status === 'READY';
              const isCooldown = p.status === 'COOLDOWN';
              return (
                <div
                  key={p.providerId}
                  className="p-2 rounded bg-slate-950/70 border border-slate-800/70 flex flex-col justify-between gap-1 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-slate-200 truncate">
                      {p.providerId}
                    </span>
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase ${
                        isHealthy
                          ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/30'
                          : isCooldown
                            ? 'bg-red-950/70 text-red-400 border border-red-500/30'
                            : 'bg-amber-950/70 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Active: {p.activeCount}</span>
                    <span>
                      Q: {p.interactiveQueueDepth}i / {p.batchQueueDepth}b
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Strip for Network Stream */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-slate-900/40 px-2.5 py-1.5 rounded border border-slate-800/50">
        <div className="flex items-center gap-1.5">
          {(
            [
              {id: 'all', label: 'All Traffic'},
              {
                id: 'client',
                label: `Client tRPC & DB (${networkLogs.length})`,
              },
              {
                id: 'server',
                label: `Server Providers (${serverSnapshot?.entries.length || 0})`,
              },
              {id: 'errors', label: 'Errors & 429s'},
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSourceFilter(tab.id)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                sourceFilter === tab.id
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Unified Network & Outbound Service Calls Stream */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
        {filteredServerEntries.length === 0 &&
        filteredClientLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
            <Activity size={24} className="mb-2 opacity-30 text-slate-500" />
            <span>
              No database queries, Gemini runs, or API requests intercepted yet
            </span>
          </div>
        ) : (
          <>
            {/* Server Outbound Provider Calls */}
            {filteredServerEntries.map(entry => {
              const isGemini = entry.providerId
                .toLowerCase()
                .includes('gemini');
              return (
                <div
                  key={entry.id}
                  className="border border-slate-800/80 bg-slate-950/50 p-2 rounded flex flex-col gap-1 text-[11px]"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{entry.timestamp}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isGemini
                            ? 'bg-purple-950/80 text-purple-300 border border-purple-500/30'
                            : 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/30'
                        }`}
                      >
                        {isGemini ? (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles size={10} />
                            {entry.providerId}
                          </span>
                        ) : (
                          `PROVIDER: ${entry.providerId}`
                        )}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400">
                        {entry.priority}
                      </span>
                      <span className="font-semibold text-slate-200">
                        {entry.operation}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {entry.tokens !== undefined && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 text-purple-300 text-[10px]">
                          {entry.tokens} tokens
                        </span>
                      )}
                      {entry.queueWaitMs > 5 && (
                        <span className="text-slate-500 text-[10px]">
                          Wait: {entry.queueWaitMs}ms
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300 text-[10px] flex items-center gap-1">
                        <Clock size={10} />
                        {entry.durationMs}ms
                      </span>
                      {entry.status === 'ok' ? (
                        <span className="text-emerald-400 flex items-center gap-0.5 text-[10px] font-bold">
                          <CheckCircle2 size={11} /> OK
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-0.5 text-[10px] font-bold uppercase">
                          <AlertTriangle size={11} /> {entry.status}
                        </span>
                      )}
                    </div>
                  </div>
                  {entry.error && (
                    <div className="text-red-300 bg-red-950/20 border border-red-900/40 px-2 py-1 rounded text-[11px]">
                      {entry.error}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Client tRPC & DB Operations */}
            {filteredClientLogs.map(log => {
              const logPayload = asTelemetryPayload(log.payload);
              const isCache = logPayload?.fromCache === true;

              return (
                <div
                  key={log.id}
                  className="border border-slate-800/80 bg-slate-950/40 p-2 rounded flex flex-col font-mono font-body-xs text-body-xs"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1 text-slate-500 border-b border-slate-900/40 pb-1">
                    <span className="font-body-xs text-body-xs">
                      {log.timestamp}
                    </span>
                    <span className="font-label-caps-xs text-label-caps-xs uppercase tracking-widest font-bold text-slate-400">
                      {log.type === 'db_read'
                        ? 'Cache / DB Read'
                        : log.type === 'db_write'
                          ? 'Mutation Write'
                          : log.type === 'gen_ai'
                            ? 'Gemini AI Call'
                            : 'tRPC / API Request'}
                    </span>
                  </div>

                  <div className="flex items-start gap-2">
                    {log.type === 'db_read' && (
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-emerald-400 font-semibold shrink-0">
                          GET:
                        </span>
                        <span className="text-slate-300 break-all select-all flex-1">
                          {log.message}
                        </span>
                        {isCache ? (
                          <span className="font-label-caps-xs text-label-caps-xs font-bold bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                            ✓ FROM LOCAL CACHE
                          </span>
                        ) : (
                          <span className="font-label-caps-xs text-label-caps-xs font-bold bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                            • SERVER READ
                          </span>
                        )}
                      </div>
                    )}

                    {(log.type === 'api_res' || log.type === 'db_write') && (
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-cyan-400 font-semibold shrink-0">
                          {log.type === 'db_write' ? 'WRITE:' : 'RPC:'}
                        </span>
                        <span className="text-slate-300 break-all select-all flex-1">
                          {log.message}
                        </span>
                        {typeof (log.durationMs ?? logPayload?.durationMs) ===
                          'number' && (
                          <span className="font-body-xs text-body-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 border border-slate-800/80 rounded shrink-0">
                            {log.durationMs ?? logPayload?.durationMs}ms
                          </span>
                        )}
                      </div>
                    )}

                    {log.type === 'gen_ai' && (
                      <div className="flex flex-col gap-1 w-full">
                        <div className="flex items-center justify-between">
                          <span className="text-purple-400 font-semibold">
                            {typeof logPayload?.model === 'string'
                              ? logPayload.model
                              : 'Gemini Flash'}
                            :
                          </span>
                          {typeof logPayload?.tokens === 'number' && (
                            <span className="font-label-caps-xs text-label-caps-xs text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                              Tokens: {logPayload.tokens}
                            </span>
                          )}
                        </div>
                        <span className="text-slate-300 italic">
                          {log.message}
                        </span>
                      </div>
                    )}
                  </div>

                  {Boolean(log.payload) && (
                    <pre className="mt-1.5 p-1 px-2 bg-slate-950 font-body-xs text-body-xs text-slate-500 select-all border border-slate-900 rounded max-h-[80px] overflow-auto">
                      {typeof log.payload === 'object'
                        ? JSON.stringify(log.payload, null, 2)
                        : String(log.payload)}
                    </pre>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
