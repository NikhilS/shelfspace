import React, {useState, useMemo} from 'react';
import {
  Terminal,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import {TelemetryLog} from '../../lib/telemetry';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';

interface DebugConsoleLogsTabProps {
  filteredLogs: TelemetryLog[];
  showLog: boolean;
  setShowLog: (v: boolean) => void;
  showInfo: boolean;
  setShowInfo: (v: boolean) => void;
  showWarn: boolean;
  setShowWarn: (v: boolean) => void;
  showError: boolean;
  setShowError: (v: boolean) => void;
  searchText: string;
  setSearchText: (v: string) => void;
}

const SCOPE_OPTIONS = [
  'All',
  'Error',
  'tRPC',
  'Cache',
  'Enrichment',
  'Auth',
  'Router',
  'Constellation',
  'PWA',
  'App',
] as const;

export const DebugConsoleLogsTab: React.FC<DebugConsoleLogsTabProps> = ({
  filteredLogs,
  showLog,
  setShowLog,
  showInfo,
  setShowInfo,
  showWarn,
  setShowWarn,
  showError,
  setShowError,
  searchText,
  setSearchText,
}) => {
  const [selectedScope, setSelectedScope] = useState<string>('All');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scopedLogs = useMemo(() => {
    if (selectedScope === 'All') return filteredLogs;
    if (selectedScope === 'Error') {
      return filteredLogs.filter(
        l => l.type === 'error' || l.scope === 'Error',
      );
    }
    return filteredLogs.filter(
      l => (l.scope || '').toLowerCase() === selectedScope.toLowerCase(),
    );
  }, [filteredLogs, selectedScope]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({...prev, [id]: !prev[id]}));
  };

  const handleCopyLog = (log: TelemetryLog) => {
    try {
      void navigator.clipboard.writeText(
        JSON.stringify(
          {
            timestamp: log.timestamp,
            type: log.type,
            scope: log.scope,
            message: log.message,
            durationMs: log.durationMs,
            status: log.status,
            payload: log.payload,
            stack: log.stack,
          },
          null,
          2,
        ),
      );
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="flex flex-col h-full space-y-2.5">
      {/* Filter Bar: Level Checkboxes + Subsystem Scopes + Search */}
      <div className="flex flex-col gap-2 bg-slate-900/50 p-2 border border-slate-800/50 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 font-label-caps-xs text-label-caps-xs text-slate-400">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <Checkbox
                checked={showLog}
                onCheckedChange={checked => setShowLog(Boolean(checked))}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 h-3.5 w-3.5"
              />
              <span>LOGS</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
              <Checkbox
                checked={showInfo}
                onCheckedChange={checked => setShowInfo(Boolean(checked))}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 h-3.5 w-3.5"
              />
              <span>INFOS</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-amber-400">
              <Checkbox
                checked={showWarn}
                onCheckedChange={checked => setShowWarn(Boolean(checked))}
                className="rounded border-slate-700 bg-slate-950 text-amber-500 h-3.5 w-3.5"
              />
              <span>WARNINGS</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-400">
              <Checkbox
                checked={showError}
                onCheckedChange={checked => setShowError(Boolean(checked))}
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
              placeholder="Search logs, scopes & payloads..."
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

        {/* Subsystem Scope Filter Strip */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1 border-t border-slate-800/50">
          <span className="text-[10px] text-slate-500 uppercase mr-1 shrink-0">
            Scope:
          </span>
          {SCOPE_OPTIONS.map(scope => {
            const isActive = selectedScope === scope;
            return (
              <button
                key={scope}
                type="button"
                onClick={() => setSelectedScope(scope)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors shrink-0 ${
                  isActive
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {scope}
              </button>
            );
          })}
        </div>
      </div>

      {/* Logs Stack View Area */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[140px]">
        {scopedLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-slate-600 italic">
            <Terminal size={24} className="mb-2 opacity-30 text-slate-500" />
            <span>No logs found matching your filters</span>
          </div>
        ) : (
          scopedLogs.map(log => {
            let colorClass = 'text-slate-300 border-l-2 border-slate-700 pl-2';
            let prefix = '[LOG]';

            if (log.type === 'warn') {
              colorClass =
                'text-amber-300 border-l-2 border-amber-500 pl-2 bg-amber-950/10';
              prefix = '[WARN]';
            } else if (log.type === 'error') {
              colorClass =
                'text-red-300 border-l-2 border-red-500 pl-2 bg-red-950/15';
              prefix = '[ERR]';
            } else if (log.type === 'info') {
              colorClass = 'text-cyan-300 border-l-2 border-cyan-600 pl-2';
              prefix = '[INFO]';
            } else if (log.type === 'db_read') {
              colorClass =
                'text-emerald-300 border-l-2 border-emerald-600 pl-2';
              prefix = '[CACHE_READ]';
            } else if (log.type === 'db_write') {
              colorClass =
                'text-emerald-200 border-l-2 border-emerald-500 pl-2 bg-emerald-950/10';
              prefix = '[MUTATION]';
            } else if (log.type === 'api_res') {
              colorClass = 'text-slate-200 border-l-2 border-cyan-500/60 pl-2';
              prefix = '[TRPC]';
            } else if (log.type === 'gen_ai') {
              colorClass =
                'text-purple-300 border-l-2 border-purple-500 pl-2 bg-purple-950/10';
              prefix = '[GEMINI]';
            } else if (log.type === 'worker') {
              colorClass =
                'text-teal-300 border-l-2 border-teal-500 pl-2 bg-teal-950/10';
              prefix = '[WORKER]';
            }

            const hasDetails = Boolean(log.payload) || Boolean(log.stack);
            const isExpanded =
              expandedIds[log.id] !== undefined
                ? expandedIds[log.id]
                : log.type === 'error';

            return (
              <div
                key={log.id}
                className={`flex flex-col border border-slate-900 px-2.5 py-1.5 rounded bg-slate-950/40 ${colorClass}`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-start gap-2 flex-wrap flex-1 min-w-0">
                    {hasDetails && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(log.id)}
                        className="mt-0.5 text-slate-500 hover:text-slate-200 shrink-0"
                        title="Toggle payload / stack trace"
                      >
                        {isExpanded ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                      </button>
                    )}
                    <span className="font-body-xs text-body-xs text-slate-500 shrink-0 select-none">
                      {log.timestamp}
                    </span>
                    <span className="font-bold font-label-caps-xs text-label-caps-xs uppercase tracking-wide shrink-0">
                      {prefix}
                    </span>
                    {log.scope && (
                      <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 font-semibold shrink-0">
                        {log.scope}
                      </span>
                    )}
                    <span className="flex-1 break-words font-mono min-w-0">
                      {log.message}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {typeof log.durationMs === 'number' && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-cyan-300">
                        {log.durationMs}ms
                      </span>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCopyLog(log)}
                      className="h-5 px-1.5 text-[10px] text-slate-500 hover:text-slate-200 rounded"
                      title="Copy log entry JSON"
                    >
                      {copiedId === log.id ? (
                        <Check size={10} className="text-emerald-400" />
                      ) : (
                        <Copy size={10} />
                      )}
                    </Button>
                  </div>
                </div>

                {hasDetails && isExpanded && (
                  <div className="mt-1.5 ml-5 space-y-1.5">
                    {Boolean(log.payload) && (
                      <pre className="p-1.5 bg-slate-950 border border-slate-900 rounded font-body-xs text-body-xs text-slate-400 max-h-[140px] overflow-auto whitespace-pre-wrap select-all">
                        {typeof log.payload === 'object'
                          ? JSON.stringify(log.payload, null, 2)
                          : String(log.payload)}
                      </pre>
                    )}
                    {Boolean(log.stack) && (
                      <pre className="p-1.5 bg-red-950/20 border border-red-900/40 rounded font-body-xs text-body-xs text-red-300/90 max-h-[140px] overflow-auto whitespace-pre-wrap select-all">
                        {log.stack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
