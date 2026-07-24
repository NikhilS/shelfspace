import express from 'express';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';
import admin from 'firebase-admin';
import fs from 'fs';

import * as trpcExpress from '@trpc/server/adapters/express';
import {appRouter} from './src/server/trpc/routers/_app';
import {createContext} from './src/server/trpc/trpc';
import {ApiKeyService} from './src/services/server/apiKeyService';
import {LibraryService} from './src/services/server/libraryService';
import {EnrichmentService} from './src/services/server/enrichmentService';

let appFilename = '';
let appDirname = '';

try {
  if (typeof __filename !== 'undefined') {
    appFilename = __filename;
  } else if (typeof import.meta !== 'undefined' && import.meta.url) {
    appFilename = fileURLToPath(import.meta.url);
  }
} catch {
  // Safe fallback
}

try {
  if (typeof __dirname !== 'undefined') {
    appDirname = __dirname;
  } else if (appFilename) {
    appDirname = path.dirname(appFilename);
  } else {
    appDirname = process.cwd();
  }
} catch {
  appDirname = process.cwd();
}

// Read firebase config
let configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(appDirname, 'firebase-applet-config.json');
}
if (!fs.existsSync(configPath)) {
  configPath = path.join(appDirname, '..', 'firebase-applet-config.json');
}

let firebaseConfig: any = null;
try {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  // ok
}

// Initialize Firebase Admin
if (firebaseConfig && !admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
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

  // Dual-mode authentication middleware (API Key + Firebase ID Token) for /api endpoints
  const authenticateApiToken = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
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
          res.status(401).json({error: 'Unauthorized: Invalid or revoked API key'});
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
        res.status(500).json({error: 'Internal server error during authentication'});
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
        console.error('[Auth Middleware] JWT token verification failed:', error);
        res.status(401).json({error: 'Unauthorized: Invalid or expired token'});
        return;
      }
    }

    res.status(401).json({error: 'Unauthorized: Missing API key or Authorization header'});
  };

  app.use('/api', authenticateApiToken);

  // --- REST Gateway Endpoints (/api/v1) ---

  // GET /api/v1/libraries
  app.get('/api/v1/libraries', async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const data = await LibraryService.getUserLibraries(user.uid, user.email);
      res.json(data);
    } catch (err: any) {
      console.error('Error listing libraries REST:', err);
      res.status(err?.status || 500).json({error: err?.message || 'Failed to list libraries'});
    }
  });

  // GET /api/v1/libraries/:libraryId/books
  app.get('/api/v1/libraries/:libraryId/books', async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const {libraryId} = req.params;

      const missingKind = (req.query['filters[missingMetadata]'] ||
        req.query['filters.missingMetadata'] ||
        req.query.missingMetadata) as any;

      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

      const result = await LibraryService.getFilteredBooks(user.uid, user.email, {
        libraryId,
        filters: missingKind ? {missingMetadata: missingKind} : undefined,
        limit,
        cursor,
      });

      res.json(result);
    } catch (err: any) {
      console.error('Error fetching books REST:', err);
      const code = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'FORBIDDEN' ? 403 : 500;
      res.status(code).json({error: err?.message || 'Failed to fetch books'});
    }
  });

  // POST /api/v1/libraries/:libraryId/enrichment/trigger
  app.post('/api/v1/libraries/:libraryId/enrichment/trigger', async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const {libraryId} = req.params;
      const {bookIds, enrichmentType} = req.body;

      if (!Array.isArray(bookIds) || bookIds.length === 0) {
        res.status(400).json({error: "Field 'bookIds' must be a non-empty array"});
        return;
      }

      if (!enrichmentType || typeof enrichmentType !== 'string') {
        res.status(400).json({error: "Field 'enrichmentType' is required"});
        return;
      }

      const result = await EnrichmentService.triggerBatchEnrichment(
        user.uid,
        user.email,
        {
          libraryId,
          bookIds,
          enrichmentType: enrichmentType as any,
        },
      );

      res.json(result);
    } catch (err: any) {
      console.error('Error triggering enrichment REST:', err);
      const code = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'FORBIDDEN' ? 403 : 500;
      res.status(code).json({error: err?.message || 'Failed to trigger enrichment'});
    }
  });

  // Dedicated API 404 handler
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: `Not Found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

void startServer();
