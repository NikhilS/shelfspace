import express from 'express';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';
import admin from 'firebase-admin';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read firebase config
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf-8'),
);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const dbAdmin = admin.firestore();
if (firebaseConfig.firestoreDatabaseId) {
  // If we need a specific database ID
  // Note: Standard firebase-admin doesn't have a direct databaseId setter in initializeApp
  // but you can get it via settings if using newer SDK versions or just use the default.
  // Actually, for multiple databases you use:
  // const db = admin.firestore(databaseId); (not always supported in all versions)
  // Let's check the version in package.json. It was 12.11.0 for client, but admin is likely different.
}
const db = dbAdmin;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post('/api/libraries/:libraryId/resync', async (req, res) => {
    const {libraryId} = req.params;
    const {isForceResync} = req.body;

    if (!libraryId) {
      return res.status(400).json({error: 'Missing libraryId'});
    }

    try {
      const jobRef = db
        .collection('libraries')
        .doc(libraryId)
        .collection('jobs')
        .doc('resync');

      // Check if job is already running
      const jobSnap = await jobRef.get();
      if (jobSnap.exists && jobSnap.data()?.status === 'running') {
        return res.status(400).json({error: 'Resync already in progress'});
      }

      // Start the job in the background
      await jobRef.set({
        status: 'running',
        progress: 0,
        total: 0,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Lazy import to avoid server/client mismatch during initialization
      const {getTieredMetadata} = await import('./src/lib/metadataUtils');

      // Background process
      void (async () => {
        try {
          const booksSnap = await db
            .collection('libraries')
            .doc(libraryId)
            .collection('books')
            .get();
          const books = booksSnap.docs.map(d => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          }));
          const total = books.length;

          await jobRef.update({total});

          let processedCount = 0;
          let successCount = 0;

          // Process in chunks to avoid overwhelming APIs
          const concurrencyLimit = 5;
          for (let i = 0; i < total; i += concurrencyLimit) {
            const chunk = books.slice(i, i + concurrencyLimit);

            await Promise.all(
              chunk.map(async b => {
                try {
                  const bookArg = isForceResync
                    ? {
                        title: b.title as string,
                        author: b.author as string,
                        isbn: b.isbn as string,
                      }
                    : (b as unknown as Partial<{
                        isbn: string;
                        title: string;
                        author: string;
                        synopsis: string;
                      }>);

                  const enriched = await getTieredMetadata(bookArg);

                  if (enriched) {
                    const newData: Record<string, unknown> = {};
                    const heavyData: Record<string, unknown> = {};

                    if ((isForceResync || !b.coverUrl) && enriched.coverUrl)
                      newData.coverUrl = enriched.coverUrl;
                    if ((isForceResync || !b.synopsis) && enriched.synopsis)
                      heavyData.synopsis = enriched.synopsis;
                    if ((isForceResync || !b.authorBio) && enriched.authorBio)
                      heavyData.authorBio = enriched.authorBio;
                    if (
                      (isForceResync || !b.publishedDate) &&
                      enriched.publishedDate
                    )
                      newData.publishedDate = enriched.publishedDate;
                    if (
                      (isForceResync ||
                        !b.genres ||
                        (b.genres as string[])?.length === 0) &&
                      enriched.genres?.length
                    )
                      newData.genres = enriched.genres;

                    if (Object.keys(newData).length > 0 || isForceResync) {
                      const updateData = {...newData};
                      if (isForceResync) {
                        updateData.synopsis =
                          admin.firestore.FieldValue.delete();
                        updateData.authorBio =
                          admin.firestore.FieldValue.delete();
                        updateData.embedding =
                          admin.firestore.FieldValue.delete();
                        updateData.clusterCoordinates =
                          admin.firestore.FieldValue.delete();
                      }
                      await db
                        .collection('libraries')
                        .doc(libraryId)
                        .collection('books')
                        .doc(b.id as string)
                        .update(updateData);
                    }

                    if (Object.keys(heavyData).length > 0) {
                      await db
                        .collection('libraries')
                        .doc(libraryId)
                        .collection('bookDetails')
                        .doc(b.id as string)
                        .set(heavyData, {merge: true});
                    }
                    successCount++;
                  }
                } catch (e) {
                  console.error(`Error processing book ${b.id}:`, e);
                } finally {
                  processedCount++;
                  // Update progress periodically (every 5 books or at the end)
                  if (processedCount % 5 === 0 || processedCount === total) {
                    await jobRef.update({
                      progress: processedCount,
                      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                  }
                }
              }),
            );
          }

          await jobRef.update({
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            successCount,
          });
        } catch (error) {
          console.error('Background resync failed:', error);
          await jobRef.update({
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      })();

      res.json({message: 'Resync job started', jobId: 'resync'});
    } catch (error) {
      console.error('Failed to start resync job:', error);
      res.status(500).json({error: 'Failed to start resync'});
    }
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
      // Skip if it looks like a file request (has an extension) or is an internal Vite request
      if (
        url.includes('.') ||
        url.startsWith('/@') ||
        url.startsWith('/node_modules/')
      ) {
        return next();
      }
      try {
        let template = fs.readFileSync(
          path.resolve(__dirname, 'index.html'),
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

void startServer();
