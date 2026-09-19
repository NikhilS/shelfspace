import express from 'express';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';
import admin from 'firebase-admin';
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

export type ApiAuthUser = AuthUser;
export type {AuthenticatedApiRequest};

const appDirname =
  typeof import.meta !== 'undefined' && import.meta.url
    ? path.dirname(fileURLToPath(import.meta.url))
    : process.cwd();

// Read firebase config
let configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(appDirname, 'firebase-applet-config.json');
}
if (!fs.existsSync(configPath)) {
  configPath = path.join(appDirname, '..', 'firebase-applet-config.json');
}

let firebaseConfig: Record<string, unknown> | null = null;
try {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
  // ok
}

// Initialize Firebase Admin
if (firebaseConfig && !admin.apps.length) {
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  } catch (err) {
    console.error('Failed to initialize Firebase Admin in server.ts:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Unauthenticated health check endpoints MUST be defined before any auth middleware
  app.get(['/api/health', '/health'], (_req, res) => {
    res.status(200).json({status: 'ok'});
  });

  app.use(express.json({limit: '50mb'}));
  app.use(express.urlencoded({limit: '50mb', extended: true}));

  // Mount tRPC adapter
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // Mount Unified REST Gateway (/api/v1)
  app.use('/api/v1', apiV1Router);

  // Dedicated API 404 handler
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: `Not Found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
      root: process.cwd(),
    });
    app.use(vite.middlewares);

    // Fallback to index.html for SPA routing
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (
        req.method !== 'GET' ||
        url.startsWith('/api/') ||
        url.startsWith('/trpc') ||
        url.includes('.') ||
        url.startsWith('/@') ||
        url.startsWith('/node_modules/')
      ) {
        return next();
      }
      try {
        let template = fs.readFileSync(
          path.resolve(process.cwd(), 'index.html'),
          'utf-8',
        );
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({'Content-Type': 'text/html'}).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (
        req.originalUrl.startsWith('/api/') ||
        req.originalUrl.startsWith('/trpc')
      ) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const listenWithRetry = (retries = 5, delay = 500) => {
    const server = app
      .listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
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
