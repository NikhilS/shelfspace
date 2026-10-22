import React from 'react';
import {Share2, Database} from 'lucide-react';
import {TelemetryMetrics} from '../../lib/telemetry';

interface DebugStateInspectorTabProps {
  activeTab: string;
  activeStates: Record<string, unknown>;
  debugData: unknown;
  debugTitle?: string;
  metrics: TelemetryMetrics;
  fetchCacheHitRatio: number;
  isOnline: boolean;
}

export function DebugStateInspectorTab({
  activeTab,
  activeStates,
  debugData,
  debugTitle,
  metrics,
  fetchCacheHitRatio,
  isOnline,
}: DebugStateInspectorTabProps) {
  if (activeTab === 'state') {
    return (
      <div className="flex flex-col h-full space-y-4">
        <div className="flex items-center justify-between bg-slate-900/60 p-2 border border-slate-800/40 rounded-lg">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-400">
            REGISTERED COMPONENT CHANNELS
          </span>
          <span className="font-label-caps-xs text-label-caps-xs bg-cyan-950 text-cyan-400 border border-cyan-500/25 px-2 py-0.5 rounded-full font-bold">
            {Object.keys(activeStates).length} Active
          </span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 min-h-[140px]">
          {Object.keys(activeStates).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
              <Share2 size={24} className="mb-2 opacity-30 text-slate-500" />
              <span>
                No component state registered using useDebugInspect() hook
              </span>
            </div>
          ) : (
            Object.keys(activeStates).map(moduleName => (
              <div
                key={moduleName}
                className="border border-slate-800 bg-[#0d1016]/80 rounded p-3 font-mono"
              >
                <div className="font-label-caps-sm text-label-caps-sm font-bold text-cyan-400 uppercase tracking-widest border-b border-slate-800/60 pb-1 flex justify-between items-center">
                  <span>Module: {moduleName}</span>
                  <span className="font-label-caps-xs text-label-caps-xs text-slate-500 font-normal normal-case">
                    实时监控 / LIVE STATE
                  </span>
                </div>
                <div className="mt-2 text-slate-300 overflow-x-auto font-body-xs text-body-xs relative select-all scrollbar-thin">
                  <pre className="bg-black/50 p-2 border border-slate-900 rounded overflow-auto max-h-[220px]">
                    {JSON.stringify(activeStates[moduleName], null, 2)}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'entity') {
    return (
      <div className="flex flex-col h-full space-y-4">
        <div className="flex items-center justify-between bg-slate-900/60 p-2 border border-slate-800/40 rounded-lg">
          <span className="font-label-caps-xs text-label-caps-xs text-slate-400">
            CURRENT ENTITY CONTEXT
          </span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 min-h-[140px]">
          {!debugData ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
              <Database size={24} className="mb-2 opacity-30 text-slate-500" />
              <span>No active entity for this view.</span>
            </div>
          ) : (
            <div className="border border-slate-800 bg-[#0d1016]/80 rounded p-3 font-mono">
              <div className="font-label-caps-sm text-label-caps-sm font-bold text-purple-400 uppercase tracking-widest border-b border-slate-800/60 pb-1 flex justify-between items-center">
                <span>Document: {debugTitle || 'Entity Data'}</span>
                <span className="font-label-caps-xs text-label-caps-xs text-slate-500 font-normal normal-case">
                  DATABASE SYNC
                </span>
              </div>
              <div className="mt-2 text-slate-300 overflow-x-auto font-body-xs text-body-xs relative select-all scrollbar-thin">
                <pre className="bg-black/50 p-2 border border-slate-900 rounded overflow-auto max-h-[350px]">
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'diagnostics') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
        {/* System Counters Panel */}
        <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col font-mono font-body-xs text-body-xs space-y-2.5">
          <h4 className="text-slate-400 font-bold uppercase font-label-caps-xs text-label-caps-xs tracking-wider border-b border-slate-800/70 pb-1">
            Session Stats &amp; Counters
          </h4>

          <div className="space-y-2">
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Firestore Read Queries</span>
              <span className="text-slate-200 font-bold">
                {metrics.totalFirestoreReads} logs
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Firestore Cache Hits</span>
              <span className="text-emerald-400 font-bold">
                {metrics.firestoreCacheHits} hits
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Calculated Cache Hit ratio</span>
              <span className="text-cyan-400 font-bold">
                {fetchCacheHitRatio}% caching accuracy
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Total Transferred Payload</span>
              <span className="text-cyan-400 font-bold">
                {(metrics.totalBytesTransferred / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Avg Book Document Size</span>
              <span
                className={`font-bold ${
                  metrics.averageBookDocumentBytes > 2048
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {metrics.averageBookDocumentBytes > 1024
                  ? `${(metrics.averageBookDocumentBytes / 1024).toFixed(1)} KB`
                  : `${metrics.averageBookDocumentBytes} B`}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Active Firestore Listeners</span>
              <span
                className={`font-bold ${
                  metrics.activeFirestoreListeners > 2
                    ? 'text-amber-400'
                    : 'text-slate-200'
                }`}
              >
                {metrics.activeFirestoreListeners} active
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Average Outbound Latency</span>
              <span className="text-slate-200 font-bold">
                {metrics.averageApiLatency} ms
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Google Gemini Models runs</span>
              <span className="text-purple-400 font-bold">
                {metrics.totalGeminiQueries} invocations
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">
                AI Prompt Tokens Transferred
              </span>
              <span className="text-slate-300 font-bold">
                {metrics.totalGeminiTokens} tokens
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Background Worker Threads</span>
              <span className="text-teal-400 font-bold">
                {metrics.activeWorkers} active
              </span>
            </div>
          </div>
        </div>

        {/* Device Telemetry Info Panel */}
        <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col font-mono font-body-xs text-body-xs space-y-2.5">
          <h4 className="text-slate-400 font-bold uppercase font-label-caps-xs text-label-caps-xs tracking-wider border-b border-slate-800/70 pb-1">
            Dev Workspace Environment
          </h4>

          <div className="space-y-2">
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Online State Status</span>
              <span
                className={`font-bold ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {isOnline ? 'ONLINE' : 'DISCONNECTED / OFFLINE'}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1 flex-wrap gap-2">
              <span className="text-slate-500">Browser Environment Agent</span>
              <span
                className="text-slate-400 font-body-xs text-body-xs text-right truncate max-w-[200px]"
                title={
                  typeof navigator !== 'undefined'
                    ? navigator.userAgent
                    : 'NodeJS'
                }
              >
                {typeof navigator !== 'undefined'
                  ? navigator.userAgent
                  : 'Dynamic Server NodeJS'}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Environment Node Context</span>
              <span className="text-slate-300">development v1.0.0</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-500">Available Storage Quotas</span>
              <span className="text-slate-300">
                {typeof window !== 'undefined' && window.localStorage
                  ? `${Object.keys(localStorage).length} keys cached`
                  : 'none'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Document URL Origin</span>
              <span
                className="text-slate-400 select-all truncate max-w-[220px]"
                title={
                  typeof window !== 'undefined' ? window.location.href : ''
                }
              >
                {typeof window !== 'undefined'
                  ? window.location.hostname
                  : 'localhost'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
