import express from 'express';
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
import {apiV1Router} from './src/server/api/v1';
import type {AuthUser, AuthenticatedApiRequest} from './src/server/auth';
import {getAdminApp, firebaseConfig} from './src/server/services/firebaseAdmin';

export type ApiAuthUser = AuthUser;
export type {AuthenticatedApiRequest};

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

  app.use(express.json({limit: '50mb'}));
  app.use(express.urlencoded({limit: '50mb', extended: true}));

  // Structured HTTP request & timing logger for navigations, API calls, tRPC, and errors
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const url = req.originalUrl || req.url;
      const status = res.statusCode;
      const isApiOrTrpc = url.startsWith('/trpc') || url.startsWith('/api/');
      const isDocNavigation =
        req.method === 'GET' &&
        !url.startsWith('/src/') &&
        !url.startsWith('/node_modules/') &&
        !url.startsWith('/@') &&
        !path.extname(req.path);

      if (status >= 400) {
        console.warn(`[HTTP ${status}] ${req.method} ${url} (${durationMs}ms)`);
      } else if (isApiOrTrpc || isDocNavigation) {
        console.log(`[HTTP ${status}] ${req.method} ${url} (${durationMs}ms)`);
      }
    });
    next();
  });

  // Client-side error & diagnostic log relay endpoint so browser boot/runtime errors appear in server logs
  app.post('/api/client-log', (req, res) => {
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
    const prefix = `[CLIENT_${String(level).toUpperCase()}]`;
    console.error(
      `${prefix} ${message || 'Unknown client log'} | url=${url || 'n/a'} | ua=${userAgent ? userAgent.slice(0, 80) : 'n/a'}`,
    );
    if (stack) {
      console.error(`${prefix} stack:\n${stack}`);
    }
    if (meta) {
      console.error(`${prefix} meta:`, JSON.stringify(meta).slice(0, 500));
    }
    res.status(200).json({received: true});
  });

  // Mount tRPC adapter with structured error logging
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({error, path: procPath, type, ctx}) {
        const userLabel =
          ctx?.user?.email || ctx?.user?.uid || 'unauthenticated';
        console.error(
          `[tRPC Error] ${type} ${procPath || '<unknown>'} -> ${error.code} (user=${userLabel}): ${error.message}`,
        );
        if (error.code === 'INTERNAL_SERVER_ERROR' && error.stack) {
          console.error(error.stack);
        }
      },
    }),
  );

  // Mount Unified REST Gateway (/api/v1)
  app.use('/api/v1', apiV1Router);

  // Dedicated API 404 handler
  app.use('/api/*', (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      error: `Not Found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Vite middleware for development
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'custom',
      root: process.cwd(),
    });
    app.use(vite.middlewares);

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
        req.method !== 'GET' ||
        parsedPath.startsWith('/api/') ||
        parsedPath.startsWith('/trpc') ||
        parsedPath.startsWith('/@') ||
        parsedPath.startsWith('/node_modules/') ||
        (ext && ext !== '.html')
      ) {
        res.status(404).type('text/plain').send(`Not Found: ${parsedPath}`);
        return;
      }
      try {
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
        vite.ssrFixStacktrace(e as Error);
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

  const listenWithRetry = (retries = 5, delay = 500) => {
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
