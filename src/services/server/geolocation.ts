import fs from 'fs';
import path from 'path';
import {getAdminDb} from './firebaseAdmin';

const cache = new Map<string, {lat: number; lng: number}>();

// Seed known common locations to eliminate redundant external calls
const SEED_LOCATIONS: Record<string, {lat: number; lng: number}> = {
  paris: {lat: 48.8566, lng: 2.3522},
  'paris-france': {lat: 48.8566, lng: 2.3522},
  london: {lat: 51.5074, lng: -0.1278},
  'london-uk': {lat: 51.5074, lng: -0.1278},
  'london-england': {lat: 51.5074, lng: -0.1278},
  'new-york': {lat: 40.7128, lng: -74.006},
  'new-york-ny': {lat: 40.7128, lng: -74.006},
  'new-york-ny-usa': {lat: 40.7128, lng: -74.006},
  'new-york-city': {lat: 40.7128, lng: -74.006},
  tokyo: {lat: 35.6762, lng: 139.6503},
  'tokyo-japan': {lat: 35.6762, lng: 139.6503},
  'kyoto-japan': {lat: 35.0116, lng: 135.7681},
  'delhi-india': {lat: 28.6139, lng: 77.209},
  'rome-italy': {lat: 41.9028, lng: 12.4964},
  'berlin-germany': {lat: 52.52, lng: 13.405},
  'madrid-spain': {lat: 40.4168, lng: -3.7038},
  'kyiv-ukraine': {lat: 50.4501, lng: 30.5234},
  'gettysburg-pa-usa': {lat: 39.8309, lng: -77.2311},
  'mumbai-india': {lat: 18.975, lng: 72.8258},
  'bombay-india': {lat: 18.975, lng: 72.8258},
  'karachi-pakistan': {lat: 24.8607, lng: 67.0011},
};

for (const [slug, coords] of Object.entries(SEED_LOCATIONS)) {
  cache.set(slug, coords);
}

// Local disk cache path
const CACHE_FILE = path.join(process.cwd(), '.cache', 'geocache.json');

// Initialize cache from local disk if present
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (
          v &&
          typeof (v as {lat: number; lng: number}).lat === 'number' &&
          typeof (v as {lat: number; lng: number}).lng === 'number'
        ) {
          cache.set(k, v as {lat: number; lng: number});
        }
      }
    }
  }
} catch {
  // Ignore disk cache load errors
}

function persistToDisk() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
    }
    const obj: Record<string, {lat: number; lng: number}> = {};
    for (const [k, v] of cache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // Non-fatal disk write error
  }
}

// Circuit breaker for Firestore L2 cache:
// If server credentials are missing or lack Firestore IAM permissions (e.g. Cloud Run sandbox),
// we gracefully disable Firestore L2 after the first permission rejection to avoid repetitive gRPC retry timeouts and error logs.
let firestoreL2Disabled = false;

function isPermissionOrUnavailableError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as {code?: number | string})?.code;
  return (
    code === 7 ||
    code === 'permission-denied' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('Could not load the default credentials') ||
    msg.includes('Firebase config not found')
  );
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function getCachedGeocode(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
  if (!name || name.trim().length === 0) return undefined;
  const slug = toSlug(name);
  if (!slug) return undefined;

  // 1. Check in-memory L1 cache
  if (cache.has(slug)) {
    return cache.get(slug);
  }

  // 2. Check Firestore L2 cache if enabled
  if (!firestoreL2Disabled) {
    try {
      const db = getAdminDb();
      const docSnap = await db.collection('geolocationCache').doc(slug).get();
      if (docSnap.exists) {
        const data = docSnap.data();
        if (typeof data?.lat === 'number' && typeof data?.lng === 'number') {
          const coords = {lat: data.lat, lng: data.lng};
          cache.set(slug, coords);
          persistToDisk();
          return coords;
        }
      }
    } catch (err) {
      if (isPermissionOrUnavailableError(err)) {
        // Quietly trip circuit breaker; rely on in-memory and disk caching
        firestoreL2Disabled = true;
      }
    }
  }

  return undefined;
}

export async function cacheGeocode(
  name: string,
  coordinates: {lat: number; lng: number},
) {
  const slug = toSlug(name);
  if (!slug) return;

  // 1. Update in-memory L1 cache and persist to disk
  cache.set(slug, coordinates);
  persistToDisk();

  // 2. Persist to Firestore L2 cache if enabled
  if (!firestoreL2Disabled) {
    try {
      const db = getAdminDb();
      await db.collection('geolocationCache').doc(slug).set(
        {
          name,
          lat: coordinates.lat,
          lng: coordinates.lng,
          updatedAt: new Date().toISOString(),
        },
        {merge: true},
      );
    } catch (err) {
      if (isPermissionOrUnavailableError(err)) {
        firestoreL2Disabled = true;
      }
    }
  }
}

let hasLoggedMissingApiKey = false;

export async function geocodeLocation(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
  const cached = await getCachedGeocode(name);
  if (cached) return cached;

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
    if (!hasLoggedMissingApiKey) {
      hasLoggedMissingApiKey = true;
      console.info(
        '[Geocoding] Google Maps API key not set; relying on cache and built-in dictionary.',
      );
    }
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
      results?: Array<{geometry: {location: {lat: number; lng: number}}}>;
    };
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const coords = data.results[0].geometry.location;
      await cacheGeocode(name, coords);
      return coords;
    }
    return undefined;
  } catch (error) {
    console.error(`[Geocoding] Exception for ${name}:`, error);
    return undefined;
  }
}
