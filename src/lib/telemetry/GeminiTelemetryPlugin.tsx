import React, {useState, useMemo} from 'react';
import {
  Cpu,
  Sparkles,
  Zap,
  Clock,
  Hash,
  Activity,
  Layers,
  Search,
} from 'lucide-react';
import {TelemetryPlugin, TelemetryPluginContext} from '../telemetry';
import {Input} from '@/components/ui/input';

interface GeminiTelemetryPanelProps {
  ctx: TelemetryPluginContext;
}

const GeminiTelemetryPanel: React.FC<GeminiTelemetryPanelProps> = ({ctx}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const {metrics, logs} = ctx;

  const aiLogs = useMemo(() => {
    return logs.filter(
      log =>
        log.type === 'gen_ai' ||
        log.message.toLowerCase().includes('gemini') ||
        log.message.toLowerCase().includes('enrich'),
    );
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (!searchTerm.trim()) return aiLogs;
    const lower = searchTerm.toLowerCase();
    return aiLogs.filter(
      log =>
        log.message.toLowerCase().includes(lower) ||
        (log.payload &&
          JSON.stringify(log.payload).toLowerCase().includes(lower)),
    );
  }, [aiLogs, searchTerm]);

  const avgTokensPerQuery = useMemo(() => {
    if (metrics.totalGeminiQueries === 0) return 0;
    return Math.round(metrics.totalGeminiTokens / metrics.totalGeminiQueries);
  }, [metrics.totalGeminiQueries, metrics.totalGeminiTokens]);

  return (
    <div className="space-y-4 p-4 font-mono text-xs text-slate-300">
      {/* Header with Title and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-950/60 border border-purple-500/40 text-purple-400">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="font-bold text-slate-200 text-sm flex items-center gap-2">
              <span>Gemini AI Telemetry & Token Profiler</span>
              <span className="font-label-caps-xs text-label-caps-xs px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-300 border border-purple-500/30">
                gemini-2.5-flash
              </span>
            </div>
            <div className="font-body-xs text-body-xs text-slate-500">
              Real-time token consumption, LLM invocation latency, and inference
              logs
            </div>
          </div>
        </div>

        <div className="w-full sm:w-64">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <Input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Filter AI logs..."
              className="h-7 pl-7 font-body-xs text-body-xs bg-slate-900/60 border-slate-800 text-slate-200 placeholder:text-slate-600 focus-visible:ring-purple-500/40"
            />
          </div>
        </div>
      </div>

      {/* 4 Diagnostic Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Gauge 1: Total Queries */}
        <div className="border border-slate-800/80 bg-slate-900/40 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Zap size={12} className="text-purple-400" />
              TOTAL INVOCATIONS
            </span>
            <span className="text-slate-500 normal-case">Queries</span>
          </div>
          <div className="text-xl font-bold text-purple-300">
            {metrics.totalGeminiQueries}
          </div>
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5 flex justify-between">
            <span>Model tier: Flash</span>
            <span className="text-emerald-400">Low latency</span>
          </div>
        </div>

        {/* Gauge 2: Total Tokens */}
        <div className="border border-slate-800/80 bg-slate-900/40 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Hash size={12} className="text-cyan-400" />
              TOTAL TOKENS
            </span>
            <span className="text-slate-500 normal-case">Cumulative</span>
          </div>
          <div className="text-xl font-bold text-cyan-300">
            {metrics.totalGeminiTokens.toLocaleString()}
          </div>
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5 flex justify-between">
            <span>Target: Lean JSON</span>
            <span className="text-cyan-400">Strict Schema</span>
          </div>
        </div>

        {/* Gauge 3: Avg Tokens / Query */}
        <div className="border border-slate-800/80 bg-slate-900/40 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Activity size={12} className="text-amber-400" />
              AVG TOKENS / QUERY
            </span>
            <span className="text-slate-500 normal-case">Payload Density</span>
          </div>
          <div className="text-xl font-bold text-amber-300">
            {avgTokensPerQuery.toLocaleString()}
          </div>
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5 flex justify-between">
            <span>Enrichment Batching</span>
            <span className="text-slate-400">Structured outputs</span>
          </div>
        </div>

        {/* Gauge 4: API Latency & Health */}
        <div className="border border-slate-800/80 bg-slate-900/40 p-3 rounded-xl flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-slate-400 font-label-caps-sm text-label-caps-sm uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-emerald-400" />
              AVG API LATENCY
            </span>
            <span className="text-slate-500 normal-case">Round-trip</span>
          </div>
          <div className="text-xl font-bold text-emerald-400">
            {metrics.averageApiLatency} ms
          </div>
          <div className="font-body-xs text-body-xs text-slate-500 border-t border-slate-800/50 pt-1.5 flex justify-between">
            <span>Requests: {metrics.totalApiRequests}</span>
            <span className="text-emerald-400">Healthy</span>
          </div>
        </div>
      </div>

      {/* Model Specifications & Parameters */}
      <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5 font-body-xs text-body-xs">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Cpu size={13} className="text-purple-400" />
            Active Model Architectural Configuration
          </span>
          <span className="text-slate-500 font-label-caps-xs text-label-caps-xs">
            Server-Side Gemini SDK (@google/genai)
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-body-xs text-body-xs">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
            <div className="font-label-caps-xs text-label-caps-xs text-slate-500 uppercase tracking-wider">
              DEFAULT MODEL
            </div>
            <div className="font-semibold text-purple-300">
              gemini-2.5-flash
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
            <div className="font-label-caps-xs text-label-caps-xs text-slate-500 uppercase tracking-wider">
              TEMPERATURE
            </div>
            <div className="font-semibold text-slate-200">
              0.2 (Deterministic)
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
            <div className="font-label-caps-xs text-label-caps-xs text-slate-500 uppercase tracking-wider">
              RESPONSE MIME TYPE
            </div>
            <div className="font-semibold text-cyan-300">application/json</div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
            <div className="font-label-caps-xs text-label-caps-xs text-slate-500 uppercase tracking-wider">
              SAFETY GUARDS
            </div>
            <div className="font-semibold text-emerald-400">
              Active (BLOCK_MEDIUM_AND_ABOVE)
            </div>
          </div>
        </div>
      </div>

      {/* Recent AI Logs Stream */}
      <div className="border border-slate-800/80 bg-slate-900/30 p-3 rounded-xl space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5 font-body-xs text-body-xs">
            <Layers size={13} className="text-cyan-400" />
            AI Operation & Inference Stream ({filteredLogs.length})
          </span>
          <span className="font-label-caps-xs text-label-caps-xs text-slate-500">
            Live Telemetry Bus
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-6 text-center text-slate-500 italic font-body-xs text-body-xs">
            No Gemini AI operations recorded in this session yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50 max-h-56 overflow-y-auto space-y-1 pr-1">
            {filteredLogs.map(log => (
              <div
                key={log.id}
                className="py-1.5 flex flex-col gap-1 hover:bg-slate-800/30 px-2 rounded transition-colors font-body-xs text-body-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-label-caps-xs text-label-caps-xs px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 font-bold uppercase">
                      {log.type.toUpperCase()}
                    </span>
                    <span className="text-slate-200 font-medium">
                      {log.message}
                    </span>
                  </div>
                  <span className="font-mono font-label-caps-xs text-label-caps-xs text-slate-500">
                    {log.timestamp}
                  </span>
                </div>
                {Boolean(log.payload) && (
                  <pre className="font-mono font-body-xs text-body-xs text-slate-400 bg-slate-950/70 p-1.5 rounded overflow-x-auto max-h-24">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export class GeminiTelemetryPlugin implements TelemetryPlugin {
  public id = 'gemini';
  public name = 'Gemini AI';
  public order = 30;
  public icon = Cpu;

  public badge(ctx: TelemetryPluginContext): string | number | undefined {
    if (ctx.metrics.totalGeminiQueries > 0) {
      return ctx.metrics.totalGeminiQueries;
    }
    return undefined;
  }

  public renderTab(ctx: TelemetryPluginContext): React.ReactNode {
    return <GeminiTelemetryPanel ctx={ctx} />;
  }

  public getMetrics() {
    return {
      type: 'gemini_ai',
    };
  }
}
