import express from 'express';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';
import admin from 'firebase-admin';
import fs from 'fs';

import {getFirestore} from 'firebase-admin/firestore';
import {getTieredMetadata} from './src/lib/metadataUtils';
import {throttledMapWithRetry, mergeBookMetadata} from './src/lib/utils';
import * as geminiService from './src/services/gemini';

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

const db = getFirestore(
  admin.app(),
  firebaseConfig.firestoreDatabaseId || '(default)',
);
const dbAdmin = db;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.delete('/api/libraries/:libraryId', async (req, res) => {
    const {libraryId} = req.params;

    if (!libraryId) {
      return res.status(400).json({error: 'Missing libraryId'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      const libRef = dbAdmin.collection('libraries').doc(libraryId);
      const libSnap = await libRef.get();
      if (!libSnap.exists) {
        return res.status(404).json({error: 'Library not found'});
      }
      const libData = libSnap.data();
      if (libData?.ownerId !== decodedToken.uid) {
        return res
          .status(403)
          .json({error: 'Forbidden. Only the owner can delete.'});
      }

      // Use recursiveDelete to delete library and all subcollections efficiently
      await dbAdmin.recursiveDelete(libRef);

      return res.json({status: 'success'});
    } catch (error) {
      console.error('Failed to delete library:', error);
      return res.status(500).json({error: 'Internal server error'});
    }
  });

  app.post('/api/libraries/:libraryId/share', async (req, res) => {
    const {libraryId} = req.params;
    const {email} = req.body;

    if (!libraryId || !email) {
      return res.status(400).json({error: 'Missing libraryId or email'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      const libRef = dbAdmin.collection('libraries').doc(libraryId);
      const libSnap = await libRef.get();

      if (!libSnap.exists) {
        return res.status(404).json({error: 'Library not found'});
      }

      const libData = libSnap.data();
      if (libData?.ownerId !== decodedToken.uid) {
        return res.status(403).json({error: 'Forbidden'});
      }

      const sharedWith = libData.sharedWith || [];
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        return res.status(400).json({error: 'Invalid email'});
      }

      if (!sharedWith.includes(normalizedEmail)) {
        await libRef.update({
          sharedWith: admin.firestore.FieldValue.arrayUnion(normalizedEmail),
        });
      }

      return res.json({status: 'success'});
    } catch (error) {
      console.error('Failed to share library:', error);
      return res.status(500).json({error: 'Internal server error'});
    }
  });

  app.delete('/api/libraries/:libraryId/share/:email', async (req, res) => {
    const {libraryId, email} = req.params;

    if (!libraryId || !email) {
      return res.status(400).json({error: 'Missing libraryId or email'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      const libRef = dbAdmin.collection('libraries').doc(libraryId);
      const libSnap = await libRef.get();

      if (!libSnap.exists) {
        return res.status(404).json({error: 'Library not found'});
      }

      const libData = libSnap.data();
      if (libData?.ownerId !== decodedToken.uid) {
        return res.status(403).json({error: 'Forbidden'});
      }

      await libRef.update({
        sharedWith: admin.firestore.FieldValue.arrayRemove(
          email.toLowerCase().trim(),
        ),
      });

      return res.json({status: 'success'});
    } catch (error) {
      console.error('Failed to remove share:', error);
      return res.status(500).json({error: 'Internal server error'});
    }
  });

  app.post('/api/libraries', async (req, res) => {
    const {name} = req.body;

    if (!name) {
      return res.status(400).json({error: 'Missing library name'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      const docRef = await dbAdmin.collection('libraries').add({
        name: name.trim(),
        ownerId: decodedToken.uid,
        ownerName: decodedToken.name || decodedToken.email || 'Unknown',
        sharedWith: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        heroImageUrl: null,
        bookCount: 0,
      });

      return res.json({id: docRef.id});
    } catch (error) {
      console.error('Failed to create library:', error);
      return res.status(500).json({error: 'Internal server error'});
    }
  });

  // API Routes
  app.post('/api/libraries/:libraryId/resync', async (req, res) => {
    const {libraryId} = req.params;
    const {isForceResync} = req.body;

    if (!libraryId) {
      return res.status(400).json({error: 'Missing libraryId'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      const libSnap = await dbAdmin
        .collection('libraries')
        .doc(libraryId)
        .get();
      if (!libSnap.exists) {
        return res.status(404).json({error: 'Library not found'});
      }
      const libData = libSnap.data();
      if (
        libData?.ownerId !== decodedToken.uid &&
        !(libData?.sharedWith || []).includes(decodedToken.email || '')
      ) {
        return res.status(403).json({error: 'Forbidden'});
      }

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

      // Background process
      void (async () => {
        try {
          const booksSnap = await db
            .collection('libraries')
            .doc(libraryId)
            .collection('books')
            .get();
          const books = booksSnap.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              title: data.title as string,
              author: data.author as string,
              isbn: data.isbn as string,
              coverUrl: data.coverUrl as string,
              synopsis: data.synopsis as string,
              authorBio: data.authorBio as string,
              publishedDate: data.publishedDate as string,
              genres: data.genres as string[],
              ...data,
            };
          });
          const total = books.length;

          await jobRef.update({total});

          let processedCount = 0;
          let successCount = 0;

          // Initialize native Firestore Admin BulkWriter for ultra-fast, non-blocking throttled writes
          const writer = db.bulkWriter();

          // Process with safe concurrency & automatic retry with exponential backoff
          await throttledMapWithRetry(
            books,
            3, // Safe concurrency limit to avoid overwhelming APIs
            async b => {
              try {
                const bookArg = isForceResync
                  ? {
                      title: b.title,
                      author: b.author,
                      isbn: b.isbn,
                    }
                  : {
                      id: b.id,
                      title: b.title,
                      author: b.author,
                      isbn: b.isbn,
                      synopsis: b.synopsis,
                    };

                const enriched = await getTieredMetadata(
                  bookArg as {
                    title: string;
                    author: string;
                    isbn?: string;
                    synopsis?: string;
                  },
                );

                if (enriched) {
                  const {newData, heavyData} = mergeBookMetadata(
                    b,
                    enriched,
                    isForceResync,
                  );

                  if (Object.keys(newData).length > 0 || isForceResync) {
                    const updateData = {...newData};
                    if (isForceResync) {
                      updateData.synopsis = admin.firestore.FieldValue.delete();
                      updateData.authorBio =
                        admin.firestore.FieldValue.delete();
                      updateData.embedding =
                        admin.firestore.FieldValue.delete();
                      updateData.clusterCoordinates =
                        admin.firestore.FieldValue.delete();
                    }
                    const bookDocRef = db
                      .collection('libraries')
                      .doc(libraryId)
                      .collection('books')
                      .doc(b.id);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    void writer.update(bookDocRef, updateData as any);
                  }

                  if (Object.keys(heavyData).length > 0) {
                    const detailDocRef = db
                      .collection('libraries')
                      .doc(libraryId)
                      .collection('bookDetails')
                      .doc(b.id as string);
                    void writer.set(detailDocRef, heavyData, {merge: true});
                  }
                  successCount++;
                }
              } catch (e) {
                console.error(`Error processing book ${b.id}:`, e);
                throw e; // Propagate up so throttledMapWithRetry can handle retrying
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
            },
            {
              retries: 3,
              delay: 1000,
              backoffFactor: 2,
            },
          );

          // Complete and flush all buffered bulk writes before ending the job
          await writer.close();

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

      return res.json({message: 'Resync job started', jobId: 'resync'});
    } catch (error) {
      console.error('Failed to start resync job:', error);
      return res.status(500).json({error: 'Failed to start resync'});
    }
  });

  app.post('/api/gemini/action', async (req, res) => {
    const {action, payload} = req.body;

    if (!action) {
      return res.status(400).json({error: 'Missing action'});
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      await admin.auth().verifyIdToken(token);
    } catch {
      return res.status(401).json({error: 'Unauthorized: Invalid token'});
    }

    try {
      let result;

      switch (action) {
        case 'generateClusterNames':
          result = await geminiService.generateClusterNames(payload.clusters);
          break;
        case 'generateBookEmbeddings':
          result = await geminiService.generateBookEmbeddings(payload.texts);
          break;
        case 'extractBooksFromImage':
          result = await geminiService.extractBooksFromImage(
            payload.base64Image,
            payload.mimeType,
          );
          break;
        case 'extractBooksFromCsv':
          result = await geminiService.extractBooksFromCsv(payload.csvText);
          break;
        case 'enrichBooksMetadata':
          result = await geminiService.enrichBooksMetadata(payload.books);
          break;
        case 'generateLibraryRecommendations':
          result = await geminiService.generateLibraryRecommendations(
            payload.libraryBooks,
          );
          break;
        case 'generateBookInsights':
          result = await geminiService.generateBookInsights(
            payload.title,
            payload.author,
            payload.type,
          );
          break;
        case 'generateLibraryHeroImage':
          result = await geminiService.generateLibraryHeroImage(
            payload.libraryName,
          );
          break;
        case 'getPickOfTheDay':
          result = await geminiService.getPickOfTheDay(payload.books);
          break;
        case 'classifyBooks':
          result = await geminiService.classifyBooks(payload.batch);
          break;
        default:
          return res.status(400).json({error: `Unknown action: ${action}`});
      }

      return res.json({result});
    } catch (error) {
      if (
        geminiService &&
        typeof geminiService.isApiKeyError === 'function' &&
        geminiService.isApiKeyError(error)
      ) {
        console.info(
          `Gemini backend action ${action} is pending valid GEMINI_API_KEY configuration.`,
        );
      } else {
        console.error(`Gemini backend action ${action} failed:`, error);
      }
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
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
