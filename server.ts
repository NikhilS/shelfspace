import express from 'express';
import {createServer as createViteServer} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';
import admin from 'firebase-admin';
import fs from 'fs';
import crypto from 'crypto';

import {getFirestore} from 'firebase-admin/firestore';
import {getTieredMetadata} from './src/lib/metadataUtils';
import {throttledMapWithRetry, mergeBookMetadata} from './src/lib/utils';
import * as geminiService from './src/services/gemini';

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

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

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

async function getCachedGeocode(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
  try {
    const normalized = name.toLowerCase().trim();
    const hash = crypto.createHash('sha256');
    hash.update(normalized);
    const cacheKey = hash.digest('hex');
    const docRef = dbAdmin.collection('geolocationCache').doc(cacheKey);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data && data.coordinates) {
        console.log(
          `[Geocoding Cache] Hit for "${name}" -> (${data.coordinates.lat}, ${data.coordinates.lng})`,
        );
        return data.coordinates as {lat: number; lng: number};
      }
    }
  } catch (error) {
    console.error('[Geocoding Cache] Read error:', error);
  }
  return undefined;
}

async function setCachedGeocode(
  name: string,
  coordinates: {lat: number; lng: number},
): Promise<void> {
  try {
    const normalized = name.toLowerCase().trim();
    const hash = crypto.createHash('sha256');
    hash.update(normalized);
    const cacheKey = hash.digest('hex');
    const docRef = dbAdmin.collection('geolocationCache').doc(cacheKey);
    await docRef.set({
      locationName: name,
      coordinates,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Geocoding Cache] Saved "${name}" to store.`);
  } catch (error) {
    console.error('[Geocoding Cache] Write error:', error);
  }
}

async function geocodeLocation(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
  // Try retrieving from Firestore cache first to avoid expensive Geocoding API billing
  const cached = await getCachedGeocode(name);
  if (cached) return cached;

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
    console.warn(
      `[Geocoding] Missing/placeholder API key, skipping real geocoding for: ${name}`,
    );
    return undefined;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(
        `[Geocoding] Failed to geocode ${name}: HTTP ${response.status}`,
      );
      return undefined;
    }
    const data = (await response.json()) as {
      status: string;
      results?: Array<{
        geometry: {
          location: {
            lat: number;
            lng: number;
          };
        };
      }>;
    };
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const coords = data.results[0].geometry.location;
      // Save the geocoded coordinates to the persistent Firestore cache
      await setCachedGeocode(name, coords);
      return coords;
    }
    console.warn(
      `[Geocoding] No results or error status from Google API for ${name}:`,
      data.status,
    );
  } catch (error) {
    console.error(`[Geocoding] Error during fetch for ${name}:`, error);
  }
  return undefined;
}

interface AuthenticatedRequest extends express.Request {
  user: admin.auth.DecodedIdToken;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({limit: '50mb'}));
  app.use(express.urlencoded({limit: '50mb', extended: true}));

  // Centralized Firebase ID Token authentication middleware for all /api endpoints
  const authenticateToken = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      (req as AuthenticatedRequest).user = decodedToken;
      next();
    } catch (error) {
      console.error('[Auth Middleware] Token verification failed:', error);
      return res.status(401).json({error: 'Unauthorized: Invalid token'});
    }
  };

  // Centralized permission check helper to secure library resources
  const checkLibraryAccess = async (
    libraryId: string,
    uid: string,
    email?: string,
  ) => {
    const libRef = dbAdmin.collection('libraries').doc(libraryId);
    const libSnap = await libRef.get();
    if (!libSnap.exists) {
      return {access: false, status: 404, message: 'Library not found'};
    }
    const libData = libSnap.data();
    const ownerId = libData?.ownerId;
    const sharedWith = libData?.sharedWith || [];
    const normalizedEmail = email?.toLowerCase().trim() || '';

    if (ownerId === uid) {
      return {access: true, libRef};
    }
    if (normalizedEmail && sharedWith.includes(normalizedEmail)) {
      return {access: true, libRef};
    }
    return {access: false, status: 403, message: 'Forbidden'};
  };

  app.use('/api', authenticateToken);

  app.delete('/api/libraries/:libraryId', async (req, res) => {
    const {libraryId} = req.params;

    if (!libraryId) {
      return res.status(400).json({error: 'Missing libraryId'});
    }

    try {
      const decodedToken = (req as AuthenticatedRequest).user;

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

    try {
      const decodedToken = (req as AuthenticatedRequest).user;

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

    try {
      const decodedToken = (req as AuthenticatedRequest).user;

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

    try {
      const decodedToken = (req as AuthenticatedRequest).user;

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

    try {
      const decodedToken = (req as AuthenticatedRequest).user;

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
        case 'extractBookGeoMetadata':
          result = await geminiService.extractBookGeoMetadata(
            payload.title,
            payload.author,
            payload.synopsis,
          );
          break;
        case 'extractBookGeoMetadataBatch':
          result = await geminiService.extractBookGeoMetadataBatch(
            payload.books as {
              id: string;
              title: string;
              author: string;
              synopsis?: string;
            }[],
          );
          break;
        case 'extractBookTemporalMetadataBatch':
          result = await geminiService.extractBookTemporalMetadataBatch(
            payload.books as {
              id: string;
              title: string;
              author: string;
              synopsis?: string;
            }[],
          );
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

  app.post('/api/books/:libraryId/enrich-geo', async (req, res) => {
    const {libraryId} = req.params;
    const {bookId, title, author, synopsis} = req.body;

    if (!libraryId || !bookId || !title || !author) {
      return res.status(400).json({error: 'Missing required parameters'});
    }

    try {
      const u = (req as AuthenticatedRequest).user;
      const accessCheck = await checkLibraryAccess(libraryId, u.uid, u.email);
      if (!accessCheck.access) {
        return res
          .status(accessCheck.status || 403)
          .json({error: accessCheck.message});
      }

      console.log(`[Enrich Geo] Processing book: ${title}`);
      const extracted = await geminiService.extractBookGeoMetadata(
        title,
        author,
        synopsis,
      );

      let geoMetadata;
      if (!extracted || extracted.isNonEarth) {
        geoMetadata = {
          isNonEarth: true,
          locations: [],
          lastSyncedAt: new Date().toISOString(),
        };
      } else {
        const locationsWithCoords = [];
        for (const loc of extracted.locations || []) {
          let coords = await geocodeLocation(loc.name);
          if (!coords) {
            const staticDict: Record<string, {lat: number; lng: number}> = {
              'paris, france': {lat: 48.8566, lng: 2.3522},
              'kyoto, japan': {lat: 35.0116, lng: 135.7681},
              'delhi, india': {lat: 28.6139, lng: 77.209},
              'kyiv, ukraine': {lat: 50.4501, lng: 30.5234},
              'new york, ny, usa': {lat: 40.7128, lng: -74.006},
              'london, uk': {lat: 51.5074, lng: -0.1278},
              'karachi, pakistan': {lat: 24.8607, lng: 67.0011},
              'bombay, india': {lat: 18.975, lng: 72.8258},
              'mumbai, india': {lat: 18.975, lng: 72.8258},
              'gettysburg, pa, usa': {lat: 39.8309, lng: -77.2311},
              'rome, italy': {lat: 41.9028, lng: 12.4964},
            };
            const lowerKey = loc.name.toLowerCase().trim();
            if (staticDict[lowerKey]) {
              coords = staticDict[lowerKey];
            } else {
              for (const [key, val] of Object.entries(staticDict)) {
                if (lowerKey.includes(key) || key.includes(lowerKey)) {
                  coords = val;
                  break;
                }
              }
            }
          }
          locationsWithCoords.push({
            name: loc.name,
            adminLevel: loc.adminLevel,
            rationale: loc.rationale,
            ...(coords ? {coordinates: coords} : {}),
          });
        }
        geoMetadata = {
          isNonEarth: false,
          locations: locationsWithCoords.slice(0, 5),
          lastSyncedAt: new Date().toISOString(),
        };
      }

      // Secure backend Firestore update
      const bookRef = dbAdmin
        .collection('libraries')
        .doc(libraryId)
        .collection('books')
        .doc(bookId);
      await bookRef.update({geoMetadata});
      console.log(
        `[Enrich Geo] Successfully saved geoMetadata for "${title}" to Firestore.`,
      );

      return res.json({status: 'success', geoMetadata});
    } catch (error) {
      console.error('[Enrich Geo] Failed:', error);
      return res
        .status(500)
        .json({error: error instanceof Error ? error.message : String(error)});
    }
  });

  app.post('/api/books/:libraryId/batch-enrich-geo', async (req, res) => {
    const {libraryId} = req.params;
    const {books} = req.body;

    if (!libraryId || !Array.isArray(books)) {
      return res.status(400).json({error: 'Missing required parameters'});
    }

    try {
      console.log(
        `[Batch Enrich Geo] Processing batch of ${books.length} books in /api/books/${libraryId}/batch-enrich-geo`,
      );

      // Perform a single structured JSON schema call to Gemini for all books in the batch
      const extractedBatch =
        await geminiService.extractBookGeoMetadataBatch(books);
      if (!extractedBatch || !Array.isArray(extractedBatch.enrichment)) {
        throw new Error('Failed to extract geocoding metadata from books');
      }

      const results = [];

      for (const item of extractedBatch.enrichment) {
        try {
          let geoMetadata;
          if (item.isNonEarth) {
            geoMetadata = {
              isNonEarth: true,
              locations: [],
              lastSyncedAt: new Date().toISOString(),
            };
          } else {
            const locationsWithCoords = [];
            for (const loc of item.locations || []) {
              let coords = await geocodeLocation(loc.name);
              if (!coords) {
                const staticDict: Record<string, {lat: number; lng: number}> = {
                  'paris, france': {lat: 48.8566, lng: 2.3522},
                  'kyoto, japan': {lat: 35.0116, lng: 135.7681},
                  'delhi, india': {lat: 28.6139, lng: 77.209},
                  'kyiv, ukraine': {lat: 50.4501, lng: 30.5234},
                  'new york, ny, usa': {lat: 40.7128, lng: -74.006},
                  'london, uk': {lat: 51.5074, lng: -0.1278},
                  'karachi, pakistan': {lat: 24.8607, lng: 67.0011},
                  'bombay, india': {lat: 18.975, lng: 72.8258},
                  'mumbai, india': {lat: 18.975, lng: 72.8258},
                  'gettysburg, pa, usa': {lat: 39.8309, lng: -77.2311},
                  'rome, italy': {lat: 41.9028, lng: 12.4964},
                };
                const lowerKey = loc.name.toLowerCase().trim();
                if (staticDict[lowerKey]) {
                  coords = staticDict[lowerKey];
                } else {
                  for (const [key, val] of Object.entries(staticDict)) {
                    if (lowerKey.includes(key) || key.includes(lowerKey)) {
                      coords = val;
                      break;
                    }
                  }
                }
              }
              locationsWithCoords.push({
                name: loc.name,
                adminLevel: loc.adminLevel,
                rationale: loc.rationale,
                ...(coords ? {coordinates: coords} : {}),
              });
            }
            geoMetadata = {
              isNonEarth: false,
              locations: locationsWithCoords.slice(0, 5),
              lastSyncedAt: new Date().toISOString(),
            };
          }

          results.push({id: item.id, geoMetadata});
        } catch (err) {
          console.error(`[Batch Enrich Geo] Skipped book ID ${item.id}:`, err);
        }
      }

      return res.json({status: 'success', results});
    } catch (error) {
      console.error('[Batch Enrich Geo] Failed:', error);
      return res
        .status(500)
        .json({error: error instanceof Error ? error.message : String(error)});
    }
  });

  app.post('/api/books/:libraryId/batch-enrich-temporal', async (req, res) => {
    const {libraryId} = req.params;
    const {books} = req.body;

    if (!libraryId || !Array.isArray(books)) {
      return res.status(400).json({error: 'Missing required parameters'});
    }

    try {
      console.log(
        `[Batch Enrich Temporal] Processing batch of ${books.length} books in /api/books/${libraryId}/batch-enrich-temporal`,
      );

      const extractedBatch =
        await geminiService.extractBookTemporalMetadataBatch(books);
      if (!extractedBatch || !Array.isArray(extractedBatch.enrichment)) {
        throw new Error('Failed to extract temporal metadata from books');
      }

      const results = [];

      for (const item of extractedBatch.enrichment) {
        try {
          const temporalMetadata = {
            isNonHistorical: item.isNonHistorical,
            startYear: item.startYear !== undefined ? item.startYear : null,
            endYear: item.endYear !== undefined ? item.endYear : null,
            eraName: item.eraName || null,
            rationale: item.rationale || null,
            lastProcessedAt: new Date().toISOString(),
          };

          results.push({id: item.id, temporalMetadata});
        } catch (err) {
          console.error(
            `[Batch Enrich Temporal] Skipped book ID ${item.id}:`,
            err,
          );
        }
      }

      return res.json({status: 'success', results});
    } catch (error) {
      console.error('[Batch Enrich Temporal] Failed:', error);
      return res
        .status(500)
        .json({error: error instanceof Error ? error.message : String(error)});
    }
  });

  // Dedicated API 404 handler to prevent unmatched API requests from falling back to HTML
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
      // Skip non-GET requests, API requests, file requests (extensions) or internal Vite requests
      if (
        req.method !== 'GET' ||
        url.startsWith('/api/') ||
        url.includes('.') ||
        url.startsWith('/@') ||
        url.startsWith('/node_modules/')
      ) {
        return next();
      }
      try {
        let template = fs.readFileSync(
          path.resolve(appDirname, 'index.html'),
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
      if (req.originalUrl.startsWith('/api/')) {
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
