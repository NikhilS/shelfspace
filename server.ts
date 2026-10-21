import express from 'express';
import compression from 'compression';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import fs from 'fs';

// Clean up non-absolute __dirname that tsx leaks into global scope in Node 22+,
// which crashes createRequire in ESM packages like vite-plugin-pwa
if (
  typeof (globalThis as Record<string, unknown>).__dirname === 'string' &&
  !path.isAbsolute((globalThis as Record<string, unknown>).__dirname as string)
) {
  delete (globalThis as Record<string, unknown>).__dirname;
}

import * as trpcExpress from '@trpc/server/adapters/express';
import {appRouter} from './src/server/trpc/routers/_app';
import {createContext} from './src/server/trpc/trpc';
import {getAdminApp, firebaseConfig} from './src/server/services/firebaseAdmin';
import {TokenVerifier, AllowlistService} from './src/server/auth';
import {LibraryService} from './src/server/services/library';
import {enrichmentJobCoordinator} from './src/server/services/enrichmentJobCoordinator';
import {
  createRateLimiter,
  redactUrlForLog,
  sanitizeLogField,
  securityHeadersMiddleware,
  SseConcurrencyTracker,
} from './src/server/middleware/securityGateway';
import {safeIdSchema} from './src/schemas/common';

// Initialize Firebase Admin
try {
  getAdminApp();
  console.log(
    `[server] Firebase Admin initialized (project=${firebaseConfig?.projectId || 'default'}, db=${firebaseConfig?.firestoreDatabaseId || '(default)'})`,
  );
} catch (err) {
  console.error(
    '[server] Failed to initialize Firebase Admin in server.ts:',
    err,
  );
}

const SELF_DESTROYING_SW = `
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      try {
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of clients) {
          if ('navigate' in client) {
            await client.navigate(client.url);
          }
        }
      } catch (e) {}
    })(),
  );
});
`.trim();

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  console.log(
    `[server] Booting book(ish) server (mode=${isProd ? 'production' : 'development'}, node=${process.version}, pid=${process.pid})`,
  );

  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);

  // Unauthenticated health check endpoints MUST be defined before any auth middleware
  app.get(['/api/health', '/health'], (_req, res) => {
    res.status(200).json({status: 'ok'});
  });

  // Always serve self-unregistering Service Worker on SW endpoints so any browser
  // with a stale precache SW automatically purges caches and reloads fresh HTML
  app.get(
    ['/sw.js', '/dev-sw.js', '/registerSW.js', '/workbox-*.js'],
    (req, res) => {
      console.log(
        `[server] Serving self-destroying Service Worker cleanup script for ${req.originalUrl}`,
      );
      res
        .status(200)
        .set({
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control':
            'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        })
        .send(SELF_DESTROYING_SW);
    },
  );

  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/api/enrichment/stream')) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
  // Scoped 15MB parser for base64 image upload / vision endpoints, 2MB default for all other routes
  const imageUploadJsonParser = express.json({limit: '15mb'});
  const defaultJsonParser = express.json({limit: '2mb'});
  app.use((req, res, next) => {
    if (
      req.path.includes('extractBooksFromImage') ||
      req.path.includes('uploadImage')
    ) {
      imageUploadJsonParser(req, res, next);
      return;
    }
    defaultJsonParser(req, res, next);
  });
  app.use(express.urlencoded({limit: '2mb', extended: true}));

  // Structured HTTP request & timing logger with query token redaction
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const rawUrl = req.originalUrl || req.url;
      const safeUrl = redactUrlForLog(rawUrl);
      const status = res.statusCode;
      const isApiOrTrpc =
        rawUrl.startsWith('/trpc') || rawUrl.startsWith('/api/');
      const isDocNavigation =
        req.method === 'GET' &&
        !rawUrl.startsWith('/src/') &&
        !rawUrl.startsWith('/node_modules/') &&
        !rawUrl.startsWith('/@') &&
        !path.extname(req.path);

      if (status >= 400) {
        console.warn(
          `[HTTP ${status}] ${req.method} ${safeUrl} (${durationMs}ms)`,
        );
      } else if (isApiOrTrpc || isDocNavigation) {
        console.log(
          `[HTTP ${status}] ${req.method} ${safeUrl} (${durationMs}ms)`,
        );
      }
    });
    next();
  });

  const clientLogRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    keyPrefix: 'client-log',
  });
  const trpcRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 300,
    keyPrefix: 'trpc',
  });
  const sseRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: 'sse',
  });
  const sseConcurrencyTracker = new SseConcurrencyTracker(5);

  // Client-side error & diagnostic log relay endpoint with rate limiting and log sanitization
  app.post('/api/client-log', clientLogRateLimiter, (req, res) => {
    const {
      level = 'error',
      message,
      stack,
      url,
      userAgent,
      meta,
    } = (req.body as {
      level?: string;
      message?: string;
      stack?: string;
      url?: string;
      userAgent?: string;
      meta?: unknown;
    }) || {};
    const combined = `${message || ''} ${stack || ''}`.toLowerCase();
    if (
      combined.includes('websocket closed without opened') ||
      combined.includes('failed to connect to websocket')
    ) {
      res.status(200).json({received: true, ignored: true});
      return;
    }
    const cleanLevel = sanitizeLogField(level, 16).toUpperCase() || 'ERROR';
    const cleanMessage =
      sanitizeLogField(message, 1000) || 'Unknown client log';
    const cleanUrl = sanitizeLogField(url, 500) || 'n/a';
    const cleanUa = sanitizeLogField(userAgent, 120) || 'n/a';
    const prefix = `[CLIENT_${cleanLevel}]`;

    console.error(
      `${prefix} ${cleanMessage} | url=${cleanUrl} | ua=${cleanUa}`,
    );
    if (stack) {
      console.error(`${prefix} stack: ${sanitizeLogField(stack, 4000)}`);
    }
    if (meta) {
      console.error(`${prefix} meta: ${sanitizeLogField(meta, 500)}`);
    }
    res.status(200).json({received: true});
  });

  // Mount tRPC adapter with rate limiting and structured error logging
  app.use(
    '/trpc',
    trpcRateLimiter,
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({error, path: procPath, type, ctx}) {
        const userLabel =
          ctx?.user?.email || ctx?.user?.uid || 'unauthenticated';
        const singleLineMsg = (error.message || '').replace(/\s+/g, ' ').trim();
        console.error(
          `[tRPC Error] ${type} ${procPath || '<unknown>'} -> ${error.code} (user=${userLabel}): ${singleLineMsg}`,
        );
        if (error.code === 'INTERNAL_SERVER_ERROR' && error.stack) {
          console.error(error.stack);
        }
      },
    }),
  );

  // Server-Sent Events (SSE) live stream for background bulk enrichment jobs
  app.get('/api/enrichment/stream', sseRateLimiter, async (req, res) => {
    const rawLibraryId =
      typeof req.query.libraryId === 'string' ? req.query.libraryId.trim() : '';
    const queryToken =
      typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const headerToken = TokenVerifier.extractTokenFromHeader(
      req.headers.authorization,
    );
    const token = queryToken || headerToken || '';

    const parsedLibId = safeIdSchema.safeParse(rawLibraryId);
    if (!parsedLibId.success) {
      res.status(400).json({error: 'Missing or invalid libraryId parameter'});
      return;
    }
    const libraryId = parsedLibId.data;

    const user = await TokenVerifier.verify(token);
    if (!user) {
      res.status(401).json({error: 'Unauthorized'});
      return;
    }

    const perms = await AllowlistService.getPermissions(user.email);
    if (!perms.isAppAllowed) {
      res.status(403).json({error: 'Forbidden: User not on allowlist'});
      return;
    }

    try {
      await LibraryService.verifyLibraryAccess(
        user.uid,
        user.email,
        libraryId,
        'viewer',
      );
    } catch {
      res.status(403).json({error: 'Forbidden'});
      return;
    }

    const releaseSseSlot = sseConcurrencyTracker.tryAcquire(user.uid);
    if (!releaseSseSlot) {
      res.status(429).json({
        error: 'Too many concurrent enrichment stream connections',
      });
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const writeEvent = (eventType: string, payload: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    // Immediately emit current job snapshot if one exists
    const initialSnapshot = enrichmentJobCoordinator.getJobStatus(libraryId);
    if (initialSnapshot) {
      writeEvent('job:snapshot', initialSnapshot);
    }

    const unsubscribe = enrichmentJobCoordinator.subscribeToLibrary(
      libraryId,
      event => {
        writeEvent(event.type, event.payload);
      },
    );

    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      res.write(': heartbeat\n\n');
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      releaseSseSlot();
    });
  });

  // Dedicated API 404 handler
  app.use('/api/*', (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      error: `Not Found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Vite middleware for development (non-blocking startup so port 3000 binds immediately)
  if (!isProd) {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'custom',
      root: process.cwd(),
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    // If a browser with a stale cached index.html requests a missing JS bundle (e.g. /assets/index-OLDHASH.js),
    // never return a 404 or index.html (text/html) response (which triggers a strict MIME type error on <script type="module">).
    // Instead, return a valid application/javascript module that purges stale Service Workers and CacheStorage and reloads.
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl || req.url;
      const parsedPath = url.split('?')[0];
      const ext = path.extname(parsedPath);

      if (
        req.method === 'GET' &&
        (ext === '.js' || ext === '.mjs' || ext === '.ts' || ext === '.tsx') &&
        !parsedPath.startsWith('/api/') &&
        !parsedPath.startsWith('/trpc')
      ) {
        console.warn(
          `[server] Missing module script requested (${url}); serving cache-purge & reload recovery script`,
        );
        res
          .status(200)
          .set({
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          })
          .send(
            '(async function(){try{if("serviceWorker"in navigator){var r=await navigator.serviceWorker.getRegistrations();await Promise.all(r.map(function(x){return x.unregister()}))}if("caches"in window){var k=await caches.keys();await Promise.all(k.map(function(x){return caches.delete(x)}))}}catch(e){}if(!sessionStorage.getItem("__bookish_stale_asset_reload")){sessionStorage.setItem("__bookish_stale_asset_reload","1");window.location.reload()}})();',
          );
        return;
      }

      if (
        (req.method !== 'GET' && req.method !== 'HEAD') ||
        parsedPath.startsWith('/api/') ||
        parsedPath.startsWith('/trpc') ||
        parsedPath.startsWith('/@') ||
        parsedPath.startsWith('/node_modules/') ||
        (ext && ext !== '.html')
      ) {
        res.status(404).type('text/plain').send(`Not Found: ${parsedPath}`);
        return;
      }
      if (req.method === 'HEAD') {
        res
          .status(200)
          .set({
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          })
          .end();
        return;
      }
      try {
        const vite = await vitePromise;
        let template = fs.readFileSync(
          path.resolve(process.cwd(), 'index.html'),
          'utf-8',
        );
        template = await vite.transformIndexHtml(url, template);
        res
          .status(200)
          .set({
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          })
          .end(template);
      } catch (e) {
        const vite = await vitePromise.catch(() => null);
        vite?.ssrFixStacktrace(e as Error);
        console.error(`[server] Error transforming index.html for ${url}:`, e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, max-age=0',
            );
          }
        },
      }),
    );
    app.get('*', (req, res) => {
      const url = req.originalUrl || req.url;
      const parsedPath = url.split('?')[0];
      const ext = path.extname(parsedPath);
      if (
        (ext === '.js' || ext === '.mjs') &&
        !parsedPath.startsWith('/api/') &&
        !parsedPath.startsWith('/trpc')
      ) {
        console.warn(
          `[server] Missing production JS bundle requested (${url}); serving cache-purge & reload recovery script`,
        );
        res
          .status(200)
          .set({
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          })
          .send(
            '(async function(){try{if("serviceWorker"in navigator){var r=await navigator.serviceWorker.getRegistrations();await Promise.all(r.map(function(x){return x.unregister()}))}if("caches"in window){var k=await caches.keys();await Promise.all(k.map(function(x){return caches.delete(x)}))}}catch(e){}if(!sessionStorage.getItem("__bookish_stale_asset_reload")){sessionStorage.setItem("__bookish_stale_asset_reload","1");window.location.reload()}})();',
          );
        return;
      }
      if (
        parsedPath.startsWith('/api/') ||
        parsedPath.startsWith('/trpc') ||
        (ext && ext !== '.html')
      ) {
        res.status(404).type('text/plain').send(`Not Found: ${parsedPath}`);
        return;
      }
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, max-age=0',
      );
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const listenWithRetry = (retries = 20, delay = 500) => {
    const server = app
      .listen(PORT, '0.0.0.0', () => {
        console.log(`[server] Ready and listening on http://localhost:${PORT}`);
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && retries > 0) {
          console.warn(
            `[server] Port ${PORT} in use, retrying in ${delay}ms... (${retries} retries left)`,
          );
          setTimeout(() => {
            listenWithRetry(retries - 1, delay);
          }, delay);
        } else {
          console.error(`[server] Failed to bind to port ${PORT}:`, err);
        }
      });
    return server;
  };

  listenWithRetry();
}

startServer().catch(err => {
  console.error('[server] Fatal error starting server:', err);
  process.exit(1);
});
