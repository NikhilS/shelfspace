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
import {ApiKeyService} from './src/services/server/apiKeyService';
import {LibraryService} from './src/services/server/libraryService';
import {EnrichmentService} from './src/services/server/enrichmentService';
import {enrichmentTriggerSchema} from './src/schemas/libraryApi';

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

export interface ApiAuthUser {
  uid: string;
  email: string;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
}

export interface AuthenticatedApiRequest extends express.Request {
  user: ApiAuthUser;
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

  // Dual-mode authentication middleware (API Key + Firebase ID Token) for /api/v1 endpoints
  const authenticateApiToken = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    if (req.path === '/health' || req.originalUrl.includes('/api/health')) {
      next();
      return;
    }

    const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
    const authHeader = req.headers.authorization;

    let rawApiKey: string | undefined = apiKeyHeader;
    if (!rawApiKey && authHeader?.startsWith('Bearer lib_live_')) {
      rawApiKey = authHeader.substring(7);
    }

    if (rawApiKey) {
      try {
        const validatedKey = await ApiKeyService.validateApiKey(rawApiKey);
        if (!validatedKey) {
          res
            .status(401)
            .json({error: 'Unauthorized: Invalid or revoked API key'});
          return;
        }

        (req as AuthenticatedApiRequest).user = {
          uid: validatedKey.uid,
          email: validatedKey.email,
          authType: 'api_key',
          apiKeyId: validatedKey.apiKeyId,
        };
        next();
        return;
      } catch (err) {
        console.error('[API Key Auth] Error validating key:', err);
        res
          .status(500)
          .json({error: 'Internal server error during authentication'});
        return;
      }
    }

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);

        const email = decodedToken.email?.toLowerCase();
        if (!email) {
          res.status(403).json({error: 'Forbidden: No email found in token'});
          return;
        }

        (req as AuthenticatedApiRequest).user = {
          uid: decodedToken.uid,
          email,
          authType: 'jwt',
        };
        next();
        return;
      } catch (error) {
        console.error(
          '[Auth Middleware] JWT token verification failed:',
          error,
        );
        res.status(401).json({error: 'Unauthorized: Invalid or expired token'});
        return;
      }
    }

    res
      .status(401)
      .json({error: 'Unauthorized: Missing API key or Authorization header'});
  };

  // Protect all REST Gateway endpoints
  app.use('/api/v1', authenticateApiToken);

  // --- REST Gateway Endpoints (/api/v1) ---

  // GET /api/v1/libraries
  app.get('/api/v1/libraries', async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const data = await LibraryService.getUserLibraries(user.uid, user.email);
      res.json(data);
    } catch (err: unknown) {
      const error = err as {status?: number; message?: string};
      console.error('Error listing libraries REST:', err);
      res
        .status(error?.status || 500)
        .json({error: error?.message || 'Failed to list libraries'});
    }
  });

  // GET /api/v1/libraries/:libraryId/books
  app.get('/api/v1/libraries/:libraryId/books', async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const {libraryId} = req.params;

      const missingKind = (req.query['filters[missingMetadata]'] ||
        req.query['filters.missingMetadata'] ||
        req.query.missingMetadata) as
        'geo' | 'temporal' | 'genre' | 'synopsis' | 'coverImage' | undefined;

      const limit = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : 50;
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

      const result = await LibraryService.getFilteredBooks(
        user.uid,
        user.email,
        {
          libraryId,
          filters: missingKind ? {missingMetadata: missingKind} : undefined,
          limit,
          cursor,
        },
      );

      res.json(result);
    } catch (err: unknown) {
      const error = err as {code?: string; message?: string};
      console.error('Error fetching books REST:', err);
      const code =
        error?.code === 'NOT_FOUND'
          ? 404
          : error?.code === 'FORBIDDEN'
            ? 403
            : 500;
      res.status(code).json({error: error?.message || 'Failed to fetch books'});
    }
  });

  // POST /api/v1/libraries/:libraryId/enrichment/trigger
  app.post(
    '/api/v1/libraries/:libraryId/enrichment/trigger',
    async (req, res) => {
      try {
        const user = (req as AuthenticatedApiRequest).user;
        const {libraryId} = req.params;

        const parseResult = enrichmentTriggerSchema.safeParse({
          ...req.body,
          libraryId,
        });

        if (!parseResult.success) {
          res.status(400).json({
            error: 'Validation failed',
            details: parseResult.error.flatten().fieldErrors,
          });
          return;
        }

        const result = await EnrichmentService.triggerBatchEnrichment(
          user.uid,
          user.email,
          parseResult.data,
        );

        res.json(result);
      } catch (err: unknown) {
        const error = err as {code?: string; message?: string};
        console.error('Error triggering enrichment REST:', err);
        const code =
          error?.code === 'NOT_FOUND'
            ? 404
            : error?.code === 'FORBIDDEN'
              ? 403
              : 500;
        res
          .status(code)
          .json({error: error?.message || 'Failed to trigger enrichment'});
      }
    },
  );

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
