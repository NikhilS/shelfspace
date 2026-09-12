import React, {useState, useEffect, useMemo} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Bug,
  ChevronDown,
  Terminal,
  Activity,
  Database,
  Cpu,
  Trash2,
  Download,
  Search,
  Wifi,
  WifiOff,
  Clock,
  X,
  Share2,
  HardDrive,
  Layers,
  Maximize2,
  ArrowUpRight,
} from 'lucide-react';
import {
  DebugTelemetryEngine,
  TelemetryLog,
  ActiveListenerInfo,
  TelemetryBaseline,
  TelemetryPlugin,
  TelemetryPluginContext,
} from '../lib/telemetry';
import {PersistenceTelemetryPlugin} from '../lib/telemetry/PersistenceTelemetryPlugin';
import {GeminiTelemetryPlugin} from '../lib/telemetry/GeminiTelemetryPlugin';
import {RenderPerformancePlugin} from '../lib/telemetry/RenderPerformancePlugin';
import {useDebug} from '../stores/debugStore';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {PersistenceTelemetryPanel} from './PersistenceTelemetryPanel';

type HeightPreset = 'compact' | 'medium' | 'tall';

const HEIGHT_CLASSES: Record<HeightPreset, string> = {
  compact: 'h-[35vh] min-h-[280px]',
  medium: 'h-[50vh] min-h-[380px]',
  tall: 'h-[82vh] min-h-[520px]',
};

export const DebugConsoleHUD: React.FC = () => {
  const {isDebugMode, debugData, debugTitle} = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);
  const [heightPreset, setHeightPreset] = useState<HeightPreset>('medium');
  const [activeTab, setActiveTab] = useState<string>('logs');

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
  const [plugins, setPlugins] = useState<TelemetryPlugin[]>([]);
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

    // Auto-register Phase 4 plugins if not yet registered
    if (engine.getPlugins().length === 0) {
      engine.registerPlugin(new PersistenceTelemetryPlugin());
      engine.registerPlugin(new GeminiTelemetryPlugin());
      engine.registerPlugin(new RenderPerformancePlugin());
    }

    // Sync initial logs & stats
    setLogs(engine.getLogs());
    setActiveStates(engine.getActiveStates());
    setMetrics(engine.getMetrics());
    setActiveListeners(engine.getActiveListeners());
    setBaseline(engine.getBaseline());
    setPlugins(engine.getPlugins());

    const unsubscribe = engine.subscribe(() => {
      setLogs(engine.getLogs());
      setActiveStates(engine.getActiveStates());
      setMetrics(engine.getMetrics());
      setActiveListeners(engine.getActiveListeners());
      setBaseline(engine.getBaseline());
      setPlugins(engine.getPlugins());
    });

    const handleConnectionChange = () => {
      setIsOnline(navigator.onLine);
    };

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);

    // Keyboard trigger bind: Ctrl + ~ (or Ctrl + `)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '`' || e.key === '~')) {
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

  // Compute live cached hits hit ratio
  const fetchCacheHitRatio = useMemo(() => {
    const total = metrics.totalFirestoreReads;
    if (total === 0) return 100; // Perfect base when no query is ran
    return Math.round((metrics.firestoreCacheHits / total) * 100);
  }, [metrics.totalFirestoreReads, metrics.firestoreCacheHits]);

  // Clean log level filters
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // General level classification check
      if (log.type === 'log' && !showLog) return false;
      if (log.type === 'info' && !showInfo) return false;
      if (log.type === 'warn' && !showWarn) return false;
      if (log.type === 'error' && !showError) return false;

      // Skip telemetry logs themselves
      if (log.message.includes('[TELEMETRY_INTERNAL]')) return false;

      // Text search matching check
      if (searchText.trim()) {
        const searchLower = searchText.toLowerCase();
        const msgMatch = log.message.toLowerCase().includes(searchLower);
        const typeMatch = log.type.toLowerCase().includes(searchLower);
        const payloadMatch = log.payload
          ? JSON.stringify(log.payload).toLowerCase().includes(searchLower)
          : false;

        return msgMatch || typeMatch || payloadMatch;
      }

      return true;
    });
  }, [logs, showLog, showInfo, showWarn, showError, searchText]);

  // DB and HTTP API specific elements
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

  // Trigger JSON file downloads
  const handleExportLogs = () => {
    try {
      const logDump = JSON.stringify(logs, null, 2);
      const blob = new Blob([logDump], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bibliophile_telemetry_dump_${Date.now()}.json`;
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

  const pluginContext = useMemo(
    (): TelemetryPluginContext => ({
      metrics,
      logs,
      activeStates,
      activeListeners,
      baseline,
      engine: DebugTelemetryEngine.getInstance(),
    }),
    [metrics, logs, activeStates, activeListeners, baseline],
  );

  const activePlugin = useMemo(
    () => plugins.find(p => p.id === activeTab),
    [plugins, activeTab],
  );

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
      {/* Floating Toggle Bezel Button */}
      <div className="absolute bottom-4 right-4 pointer-events-auto flex items-center gap-2">
        <AnimatePresence>
          {!isExpanded && (
            <motion.div
              initial={{opacity: 0, scale: 0.8, x: 20}}
              animate={{opacity: 1, scale: 1, x: 0}}
              exit={{opacity: 0, scale: 0.8, x: 20}}
              className="flex items-center gap-2 sm:gap-3 bg-slate-900/95 backdrop-blur-md border border-slate-700/50 p-2 sm:px-4 sm:py-2 rounded-full shadow-2xl"
            >
              <div className="flex items-center gap-1.5 font-label-caps-xs text-label-caps-xs text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isOnline ? 'bg-cyan-400' : 'bg-red-400'} opacity-75`}
                  ></span>
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${isOnline ? 'bg-cyan-500' : 'bg-red-500'}`}
                  ></span>
                </span>
                <span className="hidden sm:inline">
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(true)}
                className="h-7 px-2 sm:px-2.5 rounded-full text-xs font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all flex items-center gap-1.5"
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
            {/* HUD Status Header line */}
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
                    <strong
                      className={isOnline ? 'text-cyan-400' : 'text-red-400'}
                    >
                      {isOnline ? 'CONNECTED' : 'DISCONNECTED'}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={cycleHeight}
                  className="text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 px-2 py-0.5 rounded-md transition-colors font-label-caps-xs text-label-caps-xs flex items-center gap-1 border border-slate-800/80"
                  title="Toggle console height preset (compact 35vh / medium 50vh / tall 82vh)"
                >
                  <Maximize2 size={11} />
                  <span className="capitalize">{heightPreset}</span>
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 p-1 rounded-md transition-colors"
                  title="Minimize"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            {/* Main Tabs Navigation Bar with Mobile Pill Scrolling */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60 bg-[#0f121a]/80 gap-2 overflow-hidden">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 pr-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('logs')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'logs'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Logs"
                >
                  <Terminal size={12} className="opacity-75" />
                  <span>Logs</span>
                  {filteredLogs.length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-slate-900 px-1.5 py-0.2 rounded-full text-slate-400">
                      {filteredLogs.length}
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('network')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'network'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Network & DB Ops"
                >
                  <Activity size={12} className="opacity-75" />
                  <span>Network &amp; DB Ops</span>
                  {networkLogs.length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-slate-900 px-1.5 py-0.2 rounded-full text-slate-400">
                      {networkLogs.length}
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('state')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'state'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Active Page State"
                >
                  <Share2 size={12} className="opacity-75" />
                  <span>Active Page State</span>
                  {Object.keys(activeStates).length > 0 && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-cyan-900/40 border border-cyan-500/20 px-1.5 py-0.2 rounded-full text-cyan-400">
                      {Object.keys(activeStates).length}
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('entity')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'entity'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Entity Database"
                >
                  <Database size={12} className="opacity-75" />
                  <span>Entity</span>
                  {!!debugData && (
                    <span className="font-label-caps-xs text-label-caps-xs bg-purple-900/40 border border-purple-500/20 px-1.5 py-0.2 rounded-full text-purple-400">
                      1
                    </span>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab('diagnostics')}
                  className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                    activeTab === 'diagnostics'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                  }`}
                  title="Diagnostics"
                >
                  <Cpu size={12} className="opacity-75" />
                  <span>Diagnostics</span>
                </Button>

                {/* Dynamic Pluggable Telemetry Plugins Navigation Pills */}
                {plugins.map(plugin => {
                  const Icon = plugin.icon;
                  const isCurrent = activeTab === plugin.id;
                  const badge = plugin.badge?.(pluginContext);

                  return (
                    <Button
                      key={plugin.id}
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveTab(plugin.id)}
                      className={`h-7 px-2.5 sm:px-3 font-label-caps-sm text-label-caps-sm font-semibold tracking-wide rounded-full shrink-0 transition-all flex items-center gap-1.5 ${
                        isCurrent
                          ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                      }`}
                      title={plugin.name}
                    >
                      <Icon
                        size={12}
                        className={isCurrent ? 'text-cyan-400' : 'opacity-75'}
                      />
                      <span className="whitespace-nowrap">{plugin.name}</span>
                      {badge !== undefined && (
                        <span className="font-label-caps-xs text-label-caps-xs bg-cyan-900/50 border border-cyan-500/30 px-1.5 py-0.2 rounded-full text-cyan-300">
                          {badge}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              {/* Toolbar utility controls */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExportLogs}
                  title="Export Telemetry JSON"
                  className="h-8 px-2 sm:px-2.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-md gap-1 font-label-caps-sm text-label-caps-sm"
                >
                  <Download size={12} />
                  <span className="hidden sm:inline">Export</span>
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearLogs}
                  title="Clear Telemetry Console Logs"
                  className="h-8 px-2 sm:px-2.5 hover:bg-red-950 hover:text-red-300 text-slate-400 rounded-md gap-1 font-label-caps-sm text-label-caps-sm transition-all"
                >
                  <Trash2 size={12} />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              </div>
            </div>

            {/* Dynamic content rendering container */}
            <div className="flex-1 overflow-y-auto p-3 bg-slate-950/60 custom-scrollbar flex flex-col text-xs leading-relaxed select-text">
              {/* === TABS CONTENT 1: CONSOLE LOGS === */}
              {activeTab === 'logs' && (
                <div className="flex flex-col h-full space-y-4">
                  {/* Internal Search and Quick Filter Flags */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 p-2 border border-slate-800/50 rounded-lg">
                    <div className="flex items-center gap-3 font-label-caps-xs text-label-caps-xs text-slate-400">
                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
                        <Checkbox
                          checked={showLog}
                          onCheckedChange={checked => {
                            setShowLog(Boolean(checked));
                          }}
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 h-3.5 w-3.5"
                        />
                        <span>LOGS</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
                        <Checkbox
                          checked={showInfo}
                          onCheckedChange={checked => {
                            setShowInfo(Boolean(checked));
                          }}
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 h-3.5 w-3.5"
                        />
                        <span>INFOS</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-amber-400">
                        <Checkbox
                          checked={showWarn}
                          onCheckedChange={checked => {
                            setShowWarn(Boolean(checked));
                          }}
                          className="rounded border-slate-700 bg-slate-950 text-amber-500 h-3.5 w-3.5"
                        />
                        <span>WARNINGS</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-400">
                        <Checkbox
                          checked={showError}
                          onCheckedChange={checked => {
                            setShowError(Boolean(checked));
                          }}
                          className="rounded border-slate-700 bg-slate-950 text-red-500 h-3.5 w-3.5"
                        />
                        <span>ERRORS</span>
                      </label>
                    </div>

                    <div className="relative w-full sm:w-[260px] flex items-center">
                      <Search
                        size={12}
                        className="absolute left-2.5 text-slate-500 pointer-events-none z-10"
                      />
                      <Input
                        type="text"
                        placeholder="Search logs &amp; payloads..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 font-body-xs text-body-xs text-slate-300 pl-8 pr-7 py-1 h-7 rounded focus:outline-none focus:border-slate-600 font-mono"
                      />
                      {searchText && (
                        <button
                          onClick={() => setSearchText('')}
                          className="absolute right-2 text-slate-500 hover:text-slate-300"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Logs Stack View Area */}
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[140px]">
                    {filteredLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
                        <Terminal
                          size={24}
                          className="mb-2 opacity-30 text-slate-500"
                        />
                        <span>No logs found matching your filters</span>
                      </div>
                    ) : (
                      filteredLogs.map(log => {
                        let colorClass =
                          'text-slate-400 border-l border-slate-800 pl-2';
                        let prefix = '[LOG]';

                        if (log.type === 'warn') {
                          colorClass =
                            'text-amber-400/90 border-l border-amber-600/60 pl-2';
                          prefix = '[WARN]';
                        } else if (log.type === 'error') {
                          colorClass =
                            'text-red-400 border-l border-red-500 pl-2 bg-red-950/10';
                          prefix = '[ERR]';
                        } else if (log.type === 'info') {
                          colorClass =
                            'text-cyan-400/90 border-l border-cyan-800 pl-2';
                          prefix = '[INFO]';
                        } else if (log.type === 'db_read') {
                          colorClass =
                            'text-emerald-400/90 border-l border-emerald-600/50 pl-2';
                          prefix = '[FIRESTORE_READ]';
                        } else if (log.type === 'db_write') {
                          colorClass =
                            'text-emerald-300/90 border-l border-emerald-500/60 pl-2 bg-emerald-950/10';
                          prefix = '[FIRESTORE_WRITE]';
                        } else if (log.type === 'api_res') {
                          colorClass =
                            'text-indigo-400/95 border-l border-indigo-600/50 pl-2';
                          prefix = '[API]';
                        } else if (log.type === 'gen_ai') {
                          colorClass =
                            'text-purple-400 border-l border-purple-500 pl-2 bg-purple-950/10';
                          prefix = '[GEMINI_AI]';
                        } else if (log.type === 'worker') {
                          colorClass =
                            'text-teal-400 border-l border-teal-500 pl-2 bg-teal-950/10';
                          prefix = '[WORKER]';
                        }

                        return (
                          <div
                            key={log.id}
                            className={`flex flex-col border border-slate-900 px-2 py-1.5 rounded bg-slate-950/30 overflow-x-auto ${colorClass}`}
                          >
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className="font-body-xs text-body-xs text-slate-500 shrink-0 select-none">
                                {log.timestamp}
                              </span>
                              <span className="font-bold font-label-caps-xs text-label-caps-xs uppercase tracking-wide shrink-0">
                                {prefix}
                              </span>
                              <span className="flex-1 break-words font-mono min-w-0">
                                {log.message}
                              </span>
                            </div>

                            {!!log.payload && (
                              <pre className="mt-1 ml-12 p-1.5 bg-slate-950 border border-slate-900 rounded font-body-xs text-body-xs text-slate-400 max-h-[140px] overflow-auto whitespace-pre-wrap select-all">
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
              )}

              {/* === TABS CONTENT 2: NETWORK & DATABASE OPS === */}
              {activeTab === 'network' && (
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
                      <strong className="text-sm text-indigo-400">
                        {metrics.averageApiLatency}ms
                      </strong>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
                    {networkLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
                        <Activity
                          size={24}
                          className="mb-2 opacity-30 text-slate-500"
                        />
                        <span>
                          No database queries, Gemini runs, or API requests
                          intercepted yet
                        </span>
                      </div>
                    ) : (
                      networkLogs.map(log => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const logPayload = log.payload as any;
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
                                  <span className="text-indigo-400 font-semibold shrink-0">
                                    FETCH:
                                  </span>
                                  <span className="text-slate-300 break-all select-all flex-1">
                                    {log.message}
                                  </span>
                                  {logPayload?.durationMs && (
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
                                      {logPayload?.model || 'Gemini Flash'}:
                                    </span>
                                    {logPayload?.tokens && (
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
              )}

              {/* === TABS CONTENT 3: ACTIVE PAGE STATE === */}
              {activeTab === 'state' && (
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
                        <Share2
                          size={24}
                          className="mb-2 opacity-30 text-slate-500"
                        />
                        <span>
                          No component state registered using useDebugInspect()
                          hook
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
                              {JSON.stringify(
                                activeStates[moduleName],
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* === TABS CONTENT X: ENTITY DB === */}
              {activeTab === 'entity' && (
                <div className="flex flex-col h-full space-y-4">
                  <div className="flex items-center justify-between bg-slate-900/60 p-2 border border-slate-800/40 rounded-lg">
                    <span className="font-label-caps-xs text-label-caps-xs text-slate-400">
                      CURRENT ENTITY CONTEXT
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 min-h-[140px]">
                    {!debugData ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
                        <Database
                          size={24}
                          className="mb-2 opacity-30 text-slate-500"
                        />
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
              )}

              {/* === TABS CONTENT 4: DIAGNOSTICS & SYSTEM === */}
              {activeTab === 'diagnostics' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  {/* System Counters Panel */}
                  <div className="border border-slate-800/80 bg-slate-900/20 p-3 rounded-xl flex flex-col font-mono font-body-xs text-body-xs space-y-2.5">
                    <h4 className="text-slate-400 font-bold uppercase font-label-caps-xs text-label-caps-xs tracking-wider border-b border-slate-800/70 pb-1">
                      Session Stats &amp; Counters
                    </h4>

                    <div className="space-y-2">
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Firestore Read Queries
                        </span>
                        <span className="text-slate-200 font-bold">
                          {metrics.totalFirestoreReads} logs
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Firestore Cache Hits
                        </span>
                        <span className="text-emerald-400 font-bold">
                          {metrics.firestoreCacheHits} hits
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Calculated Cache Hit ratio
                        </span>
                        <span className="text-cyan-400 font-bold">
                          {fetchCacheHitRatio}% caching accuracy
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Total Transferred Payload
                        </span>
                        <span className="text-cyan-400 font-bold">
                          {(metrics.totalBytesTransferred / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Avg Book Document Size
                        </span>
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
                        <span className="text-slate-500">
                          Active Firestore Listeners
                        </span>
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
                        <span className="text-slate-500">
                          Average Outbound Latency
                        </span>
                        <span className="text-indigo-400 font-bold">
                          {metrics.averageApiLatency} ms
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Google Gemini Models runs
                        </span>
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
                        <span className="text-slate-500">
                          Background Worker Threads
                        </span>
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
                        <span className="text-slate-500">
                          Online State Status
                        </span>
                        <span
                          className={`font-bold ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {isOnline ? 'ONLINE' : 'DISCONNECTED / OFFLINE'}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1 flex-wrap gap-2">
                        <span className="text-slate-500">
                          Browser Environment Agent
                        </span>
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
                        <span className="text-slate-500">
                          Environment Node Context
                        </span>
                        <span className="text-slate-300">
                          development v1.0.0
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1">
                        <span className="text-slate-500">
                          Available Storage Quotas
                        </span>
                        <span className="text-slate-300">
                          {typeof window !== 'undefined' && window.localStorage
                            ? `${Object.keys(localStorage).length} keys cached`
                            : 'none'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          Document URL Origin
                        </span>
                        <span
                          className="text-slate-400 select-all truncate max-w-[220px]"
                          title={
                            typeof window !== 'undefined'
                              ? window.location.href
                              : ''
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
              )}

              {/* === DYNAMIC PLUGGABLE TELEMETRY PLUGIN VIEW === */}
              {activePlugin ? (
                activePlugin.renderTab(pluginContext)
              ) : activeTab === 'persistence' ? (
                <PersistenceTelemetryPanel
                  initialContext={pluginContext}
                  metrics={metrics}
                  fetchCacheHitRatio={fetchCacheHitRatio}
                  activeListeners={activeListeners}
                  baseline={baseline}
                />
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
