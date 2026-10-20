import {createTRPCReact} from '@trpc/react-query';
import {createTRPCClient, httpBatchLink, httpLink} from '@trpc/client';
import type {AppRouter} from '../server/trpc/routers/_app';
import {auth} from '../firebase';
import {useAuthStore} from '../stores/authStore';
import {DebugTelemetryEngine, estimateStringBytes} from './telemetry';

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    if (auth?.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        return {Authorization: `Bearer ${token}`};
      }
    }
    const storeUser = useAuthStore?.getState?.()?.user;
    if (storeUser && typeof storeUser.getIdToken === 'function') {
      const token = await storeUser.getIdToken();
      if (token) {
        return {Authorization: `Bearer ${token}`};
      }
    }
    return {};
  } catch (err) {
    console.warn('[tRPC] Failed to retrieve Firebase ID token:', err);
    return {};
  }
};

function isHtmlOrGatewayFallback(response: Response): boolean {
  const contentType = (
    response.headers?.get?.('content-type') || ''
  ).toLowerCase();
  if (contentType.includes('text/html')) {
    return true;
  }
  return (
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504
  );
}

function buildSynthesizedJsonErrorResponse(urlStr: string): Response {
  const payload = {
    error: {
      message:
        'Server is temporarily warming up or busy. Please try again in a moment.',
      code: -32603,
      data: {
        code: 'SERVICE_UNAVAILABLE',
        httpStatus: 503,
        path: urlStr,
      },
    },
  };
  return new Response(JSON.stringify(payload), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function parseTrpcProcedureInfo(urlStr: string): {
  procedures: string;
  isBatched: boolean;
  isInternalDebugPoll: boolean;
} {
  try {
    const trpcIdx = urlStr.indexOf('/trpc/');
    const pathPart =
      trpcIdx !== -1
        ? urlStr.slice(trpcIdx + 6).split('?')[0]
        : urlStr.split('?')[0];
    const decoded = decodeURIComponent(pathPart || 'unknown');
    const list = decoded.split(',').filter(Boolean);
    return {
      procedures: list.join(', ') || decoded,
      isBatched: list.length > 1,
      isInternalDebugPoll:
        list.length === 1 && list[0] === 'metadata.debugTelemetry',
    };
  } catch {
    return {
      procedures: urlStr,
      isBatched: false,
      isInternalDebugPoll: urlStr.includes('metadata.debugTelemetry'),
    };
  }
}

const RETRY_DELAYS_MS = [500, 1100, 2000];

const customFetch = async (
  url: URL | RequestInfo,
  options?: RequestInit,
): Promise<Response> => {
  const nativeFn =
    typeof window !== 'undefined'
      ? (window as unknown as {__nativeFetch?: typeof fetch}).__nativeFetch
      : undefined;
  const fetchFn = nativeFn || fetch;
  const start = Date.now();
  const urlStr =
    typeof url === 'string'
      ? url
      : url instanceof URL
        ? url.toString()
        : url.url;

  const method = (options?.method || 'GET').toUpperCase();
  const {procedures, isBatched, isInternalDebugPoll} =
    parseTrpcProcedureInfo(urlStr);

  const reqOptions: RequestInit = {
    ...options,
    credentials: options?.credentials ?? 'include',
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      if (reqOptions.signal?.aborted) {
        break;
      }
      await new Promise(resolve =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]),
      );
    }

    try {
      const response = await fetchFn(url, reqOptions);
      const durationMs = Date.now() - start;

      // In AI Studio preview containers, nginx intercepts 502/503/504 with = /warmup.html
      // (returning HTTP 200 text/html starting with "<!doctype html>").
      // Never pass raw HTML to @trpc/client JSON parser; retry until server responds with JSON.
      if (isHtmlOrGatewayFallback(response)) {
        console.warn(
          `[tRPC HTML/Gateway Fallback] ${procedures} returned status=${response.status} content-type=${response.headers?.get?.('content-type')} (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}, ${durationMs}ms)`,
        );
        if (attempt < RETRY_DELAYS_MS.length && !reqOptions.signal?.aborted) {
          continue;
        }
        return buildSynthesizedJsonErrorResponse(urlStr);
      }

      if (!response.ok) {
        console.warn(
          `[tRPC HTTP ${response.status}] ${method} ${procedures} (${durationMs}ms)`,
        );
        if (!isInternalDebugPoll) {
          DebugTelemetryEngine.getInstance().addLog(
            'error',
            `[tRPC] ${method} ${procedures} failed with HTTP ${response.status} (${durationMs}ms)`,
            {
              procedure: procedures,
              method,
              status: response.status,
              durationMs,
              batched: isBatched,
              attempt: attempt + 1,
            },
            {
              scope: 'tRPC',
              durationMs,
              status: response.status,
            },
          );
        }
      } else if (!isInternalDebugPoll && DebugTelemetryEngine.isHudActive()) {
        const contentLenHeader = response.headers?.get?.('content-length');
        const responseBytes = contentLenHeader
          ? parseInt(contentLenHeader, 10) || 0
          : 0;
        const reqBytes =
          typeof reqOptions.body === 'string'
            ? estimateStringBytes(reqOptions.body)
            : 0;
        const totalBytes = responseBytes + reqBytes;

        DebugTelemetryEngine.getInstance().addLog(
          'api_res',
          `[tRPC] ${method} ${procedures} (${durationMs}ms)`,
          {
            procedure: procedures,
            method,
            status: response.status,
            durationMs,
            bytes: totalBytes > 0 ? totalBytes : undefined,
            batched: isBatched,
            attempt: attempt + 1,
          },
          {
            scope: 'tRPC',
            durationMs,
            status: response.status,
          },
        );
      }
      return response;
    } catch (err) {
      lastError = err;
      if (reqOptions.signal?.aborted) {
        const durationMs = Date.now() - start;
        console.warn(
          `[tRPC Network Aborted] ${procedures} aborted after ${durationMs}ms`,
        );
        throw err;
      }
      if (attempt === RETRY_DELAYS_MS.length) {
        const durationMs = Date.now() - start;
        console.warn(
          `[tRPC Network Retry Failed] ${procedures} failed after ${durationMs}ms:`,
          err,
        );
        if (!isInternalDebugPoll) {
          DebugTelemetryEngine.getInstance().addLog(
            'error',
            `[tRPC] ${method} ${procedures} network failure after ${durationMs}ms`,
            {
              procedure: procedures,
              method,
              durationMs,
              error: err instanceof Error ? err.message : String(err),
            },
            {
              scope: 'tRPC',
              durationMs,
              status: 'error',
              stack: err instanceof Error ? err.stack : undefined,
            },
          );
        }
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request to ${urlStr} failed`);
};

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      headers: getAuthHeaders,
      fetch: customFetch,
    }),
  ],
});

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: '/trpc',
      headers: getAuthHeaders,
      fetch: customFetch,
    }),
  ],
});
