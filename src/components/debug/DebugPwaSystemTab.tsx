import React, {useState, useEffect, useMemo} from 'react';
import {
  Wifi,
  WifiOff,
  HardDrive,
  Cpu,
  Layers,
  Database,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import {TelemetryMetrics, ActiveListenerInfo} from '../../lib/telemetry';
import {Button} from '@/components/ui/button';

interface DebugPwaSystemTabProps {
  metrics: TelemetryMetrics;
  isOnline: boolean;
  activeStates: Record<string, unknown>;
  activeListeners: ActiveListenerInfo[];
  debugData: unknown;
  debugTitle?: string;
}

interface NetworkConnectionInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DebugPwaSystemTab({
  metrics,
  isOnline,
  activeStates,
  activeListeners,
  debugData,
  debugTitle,
}: DebugPwaSystemTabProps) {
  const [swCount, setSwCount] = useState<number>(0);
  const [hasSwController, setHasSwController] = useState<boolean>(false);
  const [cacheKeys, setCacheKeys] = useState<string[]>([]);
  const [storageEstimate, setStorageEstimate] = useState<{
    usage: number;
    quota: number;
  } | null>(null);
  const [domNodes, setDomNodes] = useState<number>(0);
  const [expandedModules, setExpandedModules] = useState<
    Record<string, boolean>
  >({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const netConnection = useMemo((): NetworkConnectionInfo => {
    if (typeof navigator === 'undefined') {
      return {};
    }
    const conn = (
      navigator as unknown as {
        connection?: NetworkConnectionInfo;
      }
    ).connection;
    return conn || {};
  }, [isOnline]);

  const localStorageSummary = useMemo(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {keys: 0, bytes: 0};
    }
    try {
      const keys = Object.keys(localStorage);
      let bytes = 0;
      for (const k of keys) {
        const val = localStorage.getItem(k) || '';
        bytes += (k.length + val.length) * 2;
      }
      return {keys: keys.length, bytes};
    } catch {
      return {keys: 0, bytes: 0};
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setDomNodes(document.getElementsByTagName('*').length);
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      setHasSwController(Boolean(navigator.serviceWorker.controller));
      void navigator.serviceWorker
        .getRegistrations()
        .then(regs => setSwCount(regs.length))
        .catch(() => {});
    }

    if (typeof window !== 'undefined' && 'caches' in window) {
      void caches
        .keys()
        .then(keys => setCacheKeys(keys))
        .catch(() => {});
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      void navigator.storage
        .estimate()
        .then(est => {
          setStorageEstimate({
            usage: est.usage || 0,
            quota: est.quota || 0,
          });
        })
        .catch(() => {});
    }
  }, [isOnline]);

  const handleHardReset = () => {
    const resetFn =
      typeof window !== 'undefined'
        ? (window as unknown as {__bookishHardResetAndReload?: () => void})
            .__bookishHardResetAndReload
        : undefined;
    if (typeof resetFn === 'function') {
      resetFn();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const copyJson = (key: string, data: unknown) => {
    try {
      void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const moduleNames = Object.keys(activeStates);

  return (
    <div className="flex flex-col h-full space-y-3 font-mono text-xs overflow-y-auto pr-1 pb-3">
      {/* Top Row: PWA Connectivity, Service Worker, Storage, Runtime */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Connectivity & Network Link */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1.5">
              {isOnline ? (
                <Wifi size={12} className="text-emerald-400" />
              ) : (
                <WifiOff size={12} className="text-red-400" />
              )}
              PWA CONNECTIVITY
            </span>
            <span className="text-slate-500 normal-case">
              {netConnection.effectiveType
                ? netConnection.effectiveType.toUpperCase()
                : 'Browser'}
            </span>
          </div>
          <div
            className={`text-lg font-bold ${
              isOnline ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {isOnline ? 'ONLINE (CONNECTED)' : 'OFFLINE (LOCAL ARCHIVE)'}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>
              RTT:{' '}
              {netConnection.rtt !== undefined ? `${netConnection.rtt}ms` : '—'}
            </span>
            <span>
              Downlink:{' '}
              {netConnection.downlink !== undefined
                ? `${netConnection.downlink} Mbps`
                : '—'}
            </span>
          </div>
        </div>

        {/* Card 2: Service Worker & Cache Storage */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-cyan-400" />
              SERVICE WORKER
            </span>
            <span className="text-slate-500 normal-case">
              {swCount} reg / {cacheKeys.length} caches
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-cyan-300">
              {hasSwController ? 'CONTROLLED' : 'DIRECT NETWORK'}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={handleHardReset}
              className="h-6 px-2 text-[10px] bg-slate-800/80 hover:bg-red-950/60 text-slate-300 hover:text-red-300 border border-slate-700/60 rounded flex items-center gap-1"
              title="Purge Service Workers & Cache Storage and reload"
            >
              <RefreshCw size={10} />
              <span>Purge SW</span>
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>Offline reads: IndexedDB</span>
            <span className="text-emerald-400">Protected</span>
          </div>
        </div>

        {/* Card 3: Browser Storage Quotas */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1.5">
              <HardDrive size={12} className="text-purple-400" />
              STORAGE QUOTA
            </span>
            <span className="text-slate-500 normal-case">Origin</span>
          </div>
          <div className="text-base font-bold text-purple-300">
            {storageEstimate
              ? `${formatBytes(storageEstimate.usage)} used`
              : `${formatBytes(localStorageSummary.bytes)} local`}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>LocalStorage: {localStorageSummary.keys} keys</span>
            <span>
              IDB: {formatBytes(metrics.idbPersistedBytes)} (
              {metrics.idbPersistStatus})
            </span>
          </div>
        </div>

        {/* Card 4: DOM & Worker Runtime */}
        <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-lg flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase">
            <span className="flex items-center gap-1.5">
              <Monitor size={12} className="text-amber-400" />
              DOM &amp; WORKERS
            </span>
            <span className="text-slate-500 normal-case">
              {typeof window !== 'undefined'
                ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`
                : 'SSR'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-slate-200">
              {domNodes} DOM nodes
            </span>
            <span className="text-xs font-semibold text-teal-400">
              {metrics.activeWorkers} worker
              {metrics.activeWorkers !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/50 pt-1">
            <span>Active Streams: {activeListeners.length}</span>
            <span
              className={
                domNodes > 1800 ? 'text-amber-400' : 'text-emerald-400'
              }
            >
              {domNodes > 1800 ? 'Dense DOM' : 'Virtualized'}
            </span>
          </div>
        </div>
      </div>

      {/* Active Listeners / SSE Streams */}
      {activeListeners.length > 0 && (
        <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-lg space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
            <span className="text-slate-300 font-bold uppercase text-[11px] flex items-center gap-1.5">
              <Cpu size={12} className="text-cyan-400" />
              Active Live Streams &amp; Listeners ({activeListeners.length})
            </span>
          </div>
          <div className="divide-y divide-slate-800/40">
            {activeListeners.map(l => (
              <div
                key={l.id}
                className="py-1 flex items-center justify-between text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                  <span className="font-semibold text-cyan-300">{l.name}</span>
                  <span className="text-slate-500 truncate max-w-md">
                    {l.path}
                  </span>
                </div>
                <span className="text-slate-500">Started {l.startedAt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Split Inspector: Active Page / Hook State (useDebugInspect) + Current Route Entity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-[160px]">
        {/* Left: Registered Component State Channels */}
        <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-lg flex flex-col space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
            <span className="text-slate-300 font-bold uppercase text-[11px] flex items-center gap-1.5">
              <Layers size={12} className="text-cyan-400" />
              Inspected Hook / Module States ({moduleNames.length})
            </span>
            <span className="text-[10px] text-slate-500">
              useDebugInspect()
            </span>
          </div>

          {moduleNames.length === 0 ? (
            <div className="py-6 text-center text-slate-600 italic">
              No active component states registered on this route.
            </div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto max-h-56 pr-1">
              {moduleNames.map(name => {
                const isExpanded = Boolean(expandedModules[name]);
                const data = activeStates[name];
                return (
                  <div
                    key={name}
                    className="border border-slate-800/60 bg-slate-950/50 rounded overflow-hidden"
                  >
                    <div
                      onClick={() =>
                        setExpandedModules(prev => ({
                          ...prev,
                          [name]: !prev[name],
                        }))
                      }
                      className="p-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 select-none"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown size={13} className="text-cyan-400" />
                        ) : (
                          <ChevronRight size={13} className="text-slate-500" />
                        )}
                        <span className="font-bold text-cyan-300">{name}</span>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={e => {
                          e.stopPropagation();
                          copyJson(name, data);
                        }}
                        className="h-6 px-1.5 text-slate-400 hover:text-slate-200 rounded"
                      >
                        {copiedKey === name ? (
                          <Check size={11} className="text-emerald-400" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </Button>
                    </div>
                    {isExpanded && (
                      <pre className="p-2 border-t border-slate-800/50 bg-slate-950 text-[11px] text-slate-300 overflow-x-auto max-h-44">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Active Entity Context */}
        <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-lg flex flex-col space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-1.5">
            <span className="text-slate-300 font-bold uppercase text-[11px] flex items-center gap-1.5">
              <Database size={12} className="text-purple-400" />
              Active Entity Context ({debugTitle || 'View Entity'})
            </span>
            {Boolean(debugData) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => copyJson('__entity__', debugData)}
                className="h-6 px-2 text-[10px] text-slate-300 hover:bg-slate-800 rounded flex items-center gap-1"
              >
                {copiedKey === '__entity__' ? (
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
            )}
          </div>

          {!debugData ? (
            <div className="py-6 text-center text-slate-600 italic">
              No active entity focused on this view (open a book or library
              detail view to inspect).
            </div>
          ) : (
            <pre className="p-2 bg-slate-950 border border-slate-900 rounded text-[11px] text-slate-300 overflow-auto max-h-56 select-all">
              {JSON.stringify(debugData, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
