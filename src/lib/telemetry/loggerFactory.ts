import {calculatePayloadBytes} from './byteSizeEstimator';
import {DebugTelemetryEngine} from './ringBufferStore';
import type {
  MutationType,
  ScopedDebugLogger,
  TelemetryProfilingLevel,
} from './types';

export function createLogger(scope: string): ScopedDebugLogger {
  return {
    info(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'info',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    warn(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'warn',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    error(message, errorOrPayload, meta) {
      const stack =
        meta?.stack ||
        (errorOrPayload instanceof Error ? errorOrPayload.stack : undefined);
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        `[${scope}] ${message}`,
        errorOrPayload,
        {...meta, scope, stack, status: 'error'},
      );
    },
    trace(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'log',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    async span<Result>(
      operation: string,
      fn: () => Promise<Result>,
      payload?: unknown,
    ): Promise<Result> {
      if (!DebugTelemetryEngine.isHudActive()) {
        return fn();
      }
      const start = performance.now();
      try {
        const res = await fn();
        const durationMs = Math.max(1, Math.round(performance.now() - start));
        DebugTelemetryEngine.getInstance().addLog(
          'info',
          `[${scope}] ${operation} completed (${durationMs}ms)`,
          payload,
          {scope, durationMs, status: 'ok'},
        );
        return res;
      } catch (err) {
        const durationMs = Math.max(1, Math.round(performance.now() - start));
        DebugTelemetryEngine.getInstance().addLog(
          'error',
          `[${scope}] ${operation} failed (${durationMs}ms): ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
          {
            scope,
            durationMs,
            status: 'error',
            stack: err instanceof Error ? err.stack : undefined,
          },
        );
        throw err;
      }
    },
  };
}

export const debug = createLogger('App');

let isIntercepted = false;

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return '[Object]';
        }
      }
      return String(arg);
    })
    .join(' ');
}

export function interceptConsoleLogs(): void {
  if (isIntercepted) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }

  const originalLog = window.console.log;
  const originalWarn = window.console.warn;
  const originalError = window.console.error;
  const originalInfo = window.console.info;

  window.console.log = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.startsWith('[DEBUG]') && !msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'log',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalLog(...args);
  };

  window.console.warn = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'warn',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalWarn(...args);
  };

  window.console.error = function (...args: unknown[]) {
    const firstStr = typeof args[0] === 'string' ? args[0] : '';
    if (
      firstStr.includes('Disconnecting idle stream') ||
      firstStr.includes('Timed out waiting for new targets') ||
      firstStr.includes('GrpcConnection RPC')
    ) {
      return;
    }

    const msg = DebugTelemetryEngine.isHudActive()
      ? formatConsoleArgs(args)
      : args
          .map(a =>
            a instanceof Error
              ? `${a.name}: ${a.message}`
              : typeof a === 'string'
                ? a
                : '[Object]',
          )
          .join(' ');

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      const errObj = args.find(a => a instanceof Error);
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        msg,
        errObj || (args.length > 1 ? args[1] : undefined),
        {stack: errObj?.stack, status: 'error'},
      );
    }
    originalError(...args);
  };

  window.console.info = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'info',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalInfo(...args);
  };

  isIntercepted = true;
}

/**
 * Higher-order utility wrapping asynchronous write mutations
 * with commit timing, payload sizing, and telemetry tracking.
 */
export async function instrumentMutation<Result>(
  mutationType: MutationType,
  path: string,
  payload: unknown,
  mutationFn: () => Promise<Result>,
  options?: {
    operationCount?: number;
    optimisticLatencyMs?: number;
    level?: TelemetryProfilingLevel;
  },
): Promise<Result> {
  const start = performance.now();
  const bytes = calculatePayloadBytes(payload, {level: options?.level});
  try {
    const result = await mutationFn();
    const commitDurationMs = Math.max(1, Math.round(performance.now() - start));
    DebugTelemetryEngine.getInstance().recordMutation({
      mutationType,
      path,
      payload,
      bytes,
      commitDurationMs,
      optimisticLatencyMs: options?.optimisticLatencyMs,
      operationCount: options?.operationCount,
      status: 'success',
    });
    return result;
  } catch (err) {
    const commitDurationMs = Math.max(1, Math.round(performance.now() - start));
    DebugTelemetryEngine.getInstance().recordMutation({
      mutationType,
      path,
      payload,
      bytes,
      commitDurationMs,
      optimisticLatencyMs: options?.optimisticLatencyMs,
      operationCount: options?.operationCount,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
