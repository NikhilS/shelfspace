import React, {useState, useEffect, useMemo} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Terminal,
  Activity,
  Database,
  Cpu,
  Trash2,
  Download,
  AlertTriangle,
} from 'lucide-react';
import {
  DebugTelemetryEngine,
  TelemetryLog,
  ActiveListenerInfo,
  TelemetryBaseline,
} from '../../lib/telemetry';
import {useDebug} from '../../stores/debugStore';
import {Button} from '@/components/ui/button';
import {DebugConsoleLogsTab} from './DebugConsoleLogsTab';
import {DebugNetworkTab} from './DebugNetworkTab';
import {DebugCacheTab} from './DebugCacheTab';
import {DebugPwaSystemTab} from './DebugPwaSystemTab';
import {DebugMetricsOverview, HeightPreset} from './DebugMetricsOverview';

const HEIGHT_CLASSES: Record<HeightPreset, string> = {
  compact: 'h-[35vh] min-h-[280px]',
  medium: 'h-[50vh] min-h-[380px]',
  tall: 'h-[82vh] min-h-[520px]',
};

export type DebugHudTab = 'logs' | 'network' | 'cache' | 'pwa_system';

export const DebugConsoleHUD: React.FC = () => {
  const {
    isDebugMode,
    debugData,
    debugTitle,
    profilingLevel,
    setProfilingLevel,
  } = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);
  const [heightPreset, setHeightPreset] = useState<HeightPreset>('medium');
  const [activeTab, setActiveTab] = useState<DebugHudTab>('logs');

  // Realtime Telemetry State
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [activeStates, setActiveStates] = useState<Record<string, unknown>>({});
  const [metrics, setMetrics] = useState(
    DebugTelemetryEngine.getInstance().getMetrics(),
  );
  const [activeListeners, setActiveListeners] = useState<ActiveListenerInfo[]>(
    DebugTelemetryEngine.getInstance().getActiveListeners(),
  );
  const [baseline, setBaseline] = useState<TelemetryBaseline | null>(
    DebugTelemetryEngine.getInstance().getBaseline(),
  );
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // Filters state
  const [showLog, setShowLog] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const [showWarn, setShowWarn] = useState(true);
  const [showError, setShowError] = useState(true);
  const [searchText, setSearchText] = useState('');

  // Subscribe to telemetry singleton modifications
  useEffect(() => {
    const engine = DebugTelemetryEngine.getInstance();

    setLogs(engine.getLogs());
    setActiveStates(engine.getActiveStates());
    setMetrics(engine.getMetrics());
    setActiveListeners(engine.getActiveListeners());
    setBaseline(engine.getBaseline());

    const unsubscribe = engine.subscribe(() => {
      setLogs(engine.getLogs());
      setActiveStates(engine.getActiveStates());
      setMetrics(engine.getMetrics());
      setActiveListeners(engine.getActiveListeners());
      setBaseline(engine.getBaseline());
    });

    const handleConnectionChange = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      engine.addLog(
        online ? 'info' : 'warn',
        `[PWA] Network connectivity changed: ${
          online ? 'ONLINE' : 'OFFLINE (serving from IndexedDB cache)'
        }`,
        {isOnline: online},
        {scope: 'PWA'},
      );
    };

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key === '~')) {
        e.preventDefault();
        setIsExpanded(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const fetchCacheHitRatio = useMemo(() => {
    const total = metrics.totalFirestoreReads;
    if (total === 0) return 100;
    return Math.round((metrics.firestoreCacheHits / total) * 100);
  }, [metrics.totalFirestoreReads, metrics.firestoreCacheHits]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (log.type === 'log' && !showLog) return false;
      if (log.type === 'info' && !showInfo) return false;
      if (log.type === 'warn' && !showWarn) return false;
      if (log.type === 'error' && !showError) return false;

      if (log.message.includes('[TELEMETRY_INTERNAL]')) return false;

      if (searchText.trim()) {
        const searchLower = searchText.toLowerCase();
        const msgMatch = log.message.toLowerCase().includes(searchLower);
        const typeMatch = log.type.toLowerCase().includes(searchLower);
        const scopeMatch = (log.scope || '')
          .toLowerCase()
          .includes(searchLower);
        const payloadMatch = log.payload
          ? JSON.stringify(log.payload).toLowerCase().includes(searchLower)
          : false;

        return msgMatch || typeMatch || scopeMatch || payloadMatch;
      }

      return true;
    });
  }, [logs, showLog, showInfo, showWarn, showError, searchText]);

  const networkLogs = useMemo(() => {
    return logs.filter(log => {
      const isNetOp =
        log.type === 'db_read' ||
        log.type === 'db_write' ||
        log.type === 'api_res' ||
        log.type === 'gen_ai';
      if (!isNetOp) return false;

      if (searchText.trim()) {
        const queryLower = searchText.toLowerCase();
        return (
          log.message.toLowerCase().includes(queryLower) ||
          (log.payload &&
            JSON.stringify(log.payload).toLowerCase().includes(queryLower))
        );
      }
      return true;
    });
  }, [logs, searchText]);

  const handleExportLogs = () => {
    try {
      const logDump = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          isOnline,
          metrics,
          activeListeners,
          activeStates,
          logs,
        },
        null,
        2,
      );
      const blob = new Blob([logDump], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bookish_telemetry_dump_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export system telemetry logs', err);
    }
  };

  const handleClearLogs = () => {
    DebugTelemetryEngine.getInstance().clearLogs();
  };

  const cycleHeight = () => {
    setHeightPreset(prev => {
      if (prev === 'compact') return 'medium';
      if (prev === 'medium') return 'tall';
      return 'compact';
    });
  };

  if (!isDebugMode) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none font-mono">
      {/* Floating Toggle Bezel Button (Rectilinear Modern Archivist Design) */}
      <div className="absolute bottom-4 right-4 pointer-events-auto flex items-center gap-2">
        <AnimatePresence>
          {!isExpanded && (
            <motion.div
              initial={{opacity: 0, scale: 0.9, x: 16}}
              animate={{opacity: 1, scale: 1, x: 0}}
              exit={{opacity: 0, scale: 0.9, x: 16}}
              className="flex items-center gap-2.5 bg-slate-900/95 backdrop-blur-md border border-slate-700/60 p-1.5 sm:px-3 sm:py-1.5 rounded-lg shadow-2xl"
            >
              <div className="flex items-center gap-1.5 font-label-caps-xs text-label-caps-xs text-slate-300">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full ${
                      isOnline ? 'bg-emerald-400' : 'bg-red-400'
                    } opacity-75`}
                  ></span>
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isOnline ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  ></span>
                </span>
                <span className="hidden sm:inline">
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>

              {metrics.totalErrors > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-500/40 text-[10px] font-bold">
                  <AlertTriangle size={10} />
                  {metrics.totalErrors}
                </span>
              )}

              <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(true)}
                className="h-7 px-2.5 rounded text-xs font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all flex items-center gap-1.5"
                title="Console [Ctrl+~]"
              >
                <Terminal size={12} />
                <span className="hidden sm:inline">Console [Ctrl+~]</span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main Collapsible Console Overlay Drawer */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{y: '100%'}}
            animate={{y: 0}}
            exit={{y: '100%'}}
            transition={{type: 'spring', damping: 24, stiffness: 180}}
            className={`w-full bg-[#0d0f14]/98 md:bg-[#0c0e12]/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl pointer-events-auto ${HEIGHT_CLASSES[heightPreset]} flex flex-col focus:outline-none transition-[height] duration-200`}
            id="debug-hud-panel"
          >
            <DebugMetricsOverview
              metrics={metrics}
              fetchCacheHitRatio={fetchCacheHitRatio}
              isOnline={isOnline}
              profilingLevel={profilingLevel}
              setProfilingLevel={setProfilingLevel}
              heightPreset={heightPreset}
              onCycleHeight={cycleHeight}
              onMinimize={() => setIsExpanded(false)}
            />

            {/* Streamlined 4-Tab Navigation Bar */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60 bg-[#0f121a]/80 gap-2 overflow-hidden">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 pr-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('logs')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'logs'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Logs & Errors"
                >
                  <Terminal size={12} className="opacity-75" />
                  <span>Logs</span>
                  {filteredLogs.length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-slate-900 px-1.5 py-0.2 rounded text-slate-400">
                      {filteredLogs.length}
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('network')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'network'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Network & Services"
                >
                  <Activity size={12} className="opacity-75" />
                  <span>Network &amp; Services</span>
                  {networkLogs.length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-slate-900 px-1.5 py-0.2 rounded text-slate-400">
                      {networkLogs.length}
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('cache')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'cache'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Cache & Persistence"
                >
                  <Database size={12} className="opacity-75" />
                  <span>Cache</span>
                  <span className="font-label-caps-xs text-label-caps-xs bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.2 rounded text-emerald-300">
                    {fetchCacheHitRatio}%
                  </span>
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('pwa_system')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'pwa_system'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="PWA & System"
                >
                  <Cpu size={12} className="opacity-75" />
                  <span>PWA &amp; System</span>
                  {Object.keys(activeStates).length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-cyan-900/40 border border-cyan-500/20 px-1.5 py-0.2 rounded text-cyan-400">
                      {Object.keys(activeStates).length}
                    </span>
                  )}
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExportLogs}
                  title="Export Telemetry JSON"
                  className="h-7 px-2 sm:px-2.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded gap-1 font-label-caps-sm text-label-caps-sm"
                >
                  <Download size={12} />
                  <span className="hidden sm:inline">Export</span>
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearLogs}
                  title="Clear Telemetry Console Logs"
                  className="h-7 px-2 sm:px-2.5 hover:bg-red-950 hover:text-red-300 text-slate-400 rounded gap-1 font-label-caps-sm text-label-caps-sm transition-all"
                >
                  <Trash2 size={12} />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              </div>
            </div>

            {/* Dynamic Tab Content Container */}
            <div className="flex-1 overflow-y-auto p-3 bg-slate-950/60 custom-scrollbar flex flex-col text-xs leading-relaxed select-text">
              {activeTab === 'logs' && (
                <DebugConsoleLogsTab
                  filteredLogs={filteredLogs}
                  showLog={showLog}
                  setShowLog={setShowLog}
                  showInfo={showInfo}
                  setShowInfo={setShowInfo}
                  showWarn={showWarn}
                  setShowWarn={setShowWarn}
                  showError={showError}
                  setShowError={setShowError}
                  searchText={searchText}
                  setSearchText={setSearchText}
                />
              )}

              {activeTab === 'network' && (
                <DebugNetworkTab
                  networkLogs={networkLogs}
                  metrics={metrics}
                  fetchCacheHitRatio={fetchCacheHitRatio}
                />
              )}

              {activeTab === 'cache' && (
                <DebugCacheTab
                  metrics={metrics}
                  fetchCacheHitRatio={fetchCacheHitRatio}
                  baseline={baseline}
                  activeListeners={activeListeners}
                />
              )}

              {activeTab === 'pwa_system' && (
                <DebugPwaSystemTab
                  metrics={metrics}
                  isOnline={isOnline}
                  activeStates={activeStates}
                  activeListeners={activeListeners}
                  debugData={debugData}
                  debugTitle={debugTitle}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
