import React from 'react';
import {Activity} from 'lucide-react';
import {TelemetryLog, TelemetryMetrics} from '../../lib/telemetry';
import type {TelemetryLogPayload} from '../../types';

interface DebugNetworkTabProps {
  networkLogs: TelemetryLog[];
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
}

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
  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            TOTAL SERVICE READS
          </span>
          <strong className="text-sm text-slate-200">
            {metrics.totalFirestoreReads}
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            CACHE HITS
          </span>
          <strong className="text-sm text-emerald-400">
            {metrics.firestoreCacheHits}
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            CACHE HIT RATIO
          </span>
          <strong className="text-sm text-cyan-400">
            {fetchCacheHitRatio}%
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            AVG REQUEST TIME
          </span>
          <strong className="text-sm text-slate-200">
            {metrics.averageApiLatency}ms
          </strong>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
        {networkLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
            <Activity size={24} className="mb-2 opacity-30 text-slate-500" />
            <span>
              No database queries, Gemini runs, or API requests intercepted yet
            </span>
          </div>
        ) : (
          networkLogs.map(log => {
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
                      ? 'Firestore READ'
                      : log.type === 'gen_ai'
                        ? 'Gemini AI Call'
                        : 'API Connection'}
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

                  {log.type === 'api_res' && (
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-slate-300 font-semibold shrink-0">
                        FETCH:
                      </span>
                      <span className="text-slate-300 break-all select-all flex-1">
                        {log.message}
                      </span>
                      {typeof logPayload?.durationMs === 'number' && (
                        <span className="font-body-xs text-body-xs text-slate-400 bg-slate-900 px-1.5 py-0.5 border border-slate-800/80 rounded shrink-0">
                          Latency: {logPayload.durationMs}ms
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

                {!!log.payload && (
                  <pre className="mt-1.5 p-1 px-2 bg-slate-950 font-body-xs text-body-xs text-slate-500 select-all border border-slate-900 rounded max-h-[80px] overflow-auto">
                    {typeof log.payload === 'object'
                      ? JSON.stringify(log.payload, null, 2)
                      : String(log.payload)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
