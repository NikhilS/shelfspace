import React from 'react';
import {Terminal, Search, X} from 'lucide-react';
import {TelemetryLog} from '../../lib/telemetry';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';

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
  return (
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
            <Terminal size={24} className="mb-2 opacity-30 text-slate-500" />
            <span>No logs found matching your filters</span>
          </div>
        ) : (
          filteredLogs.map(log => {
            let colorClass = 'text-slate-400 border-l border-slate-800 pl-2';
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
              colorClass = 'text-cyan-400/90 border-l border-cyan-800 pl-2';
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
              colorClass = 'text-slate-300 border-l border-slate-600/50 pl-2';
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
  );
};
