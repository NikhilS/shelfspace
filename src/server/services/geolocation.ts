import {getAdminDb} from './firebaseAdmin';
import {
  SchemaValidationError,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import {
  storedGeolocationCacheDocSchema,
  type StoredGeolocationCacheDoc,
} from '../../schemas/geolocation';
import {normalizeFirestoreTimestamp} from './book/bookPartitioner';

export const geolocationCacheConverter = {
  toFirestoreWrite(
    slug: string,
    input: {name: string; lat: number; lng: number; updatedAt: string},
  ): StoredGeolocationCacheDoc {
    const payload: StoredGeolocationCacheDoc = {
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      updatedAt: input.updatedAt,
    };
    validateFirestoreWritePayload(storedGeolocationCacheDocSchema, payload, {
      entity: 'StoredGeolocationCacheDoc',
      documentPath: `geolocationCache/${slug}`,
      operation: 'upsert',
    });
    return payload;
  },

  fromFirestore(
    slug: string,
    raw: Record<string, unknown>,
  ): StoredGeolocationCacheDoc {
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: slug,
    };
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    for (const k of Object.keys(candidate)) {
      if (candidate[k] === undefined) {
        delete candidate[k];
      }
    }
    return validateFirestoreReadPayload(
      storedGeolocationCacheDocSchema,
      candidate,
      {
        entity: 'StoredGeolocationCacheDoc',
        documentPath: `geolocationCache/${slug}`,
        operation: 'read',
      },
    );
  },
};

const MAX_L1_GEOCACHE_ENTRIES = 2000;
const cache = new Map<string, {lat: number; lng: number}>();

function setL1Cache(slug: string, coords: {lat: number; lng: number}): void {
  if (cache.has(slug)) {
    cache.delete(slug);
  } else if (cache.size >= MAX_L1_GEOCACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      cache.delete(oldestKey);
    }
  }
  cache.set(slug, coords);
}

function getL1Cache(slug: string): {lat: number; lng: number} | undefined {
  const hit = cache.get(slug);
  if (!hit) {
    return undefined;
  }
  cache.delete(slug);
  cache.set(slug, hit);
  return hit;
}

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
  setL1Cache(slug, coords);
}

// Circuit breaker for Firestore L2 cache:
// If server credentials are missing or lack Firestore IAM permissions (e.g. sandbox),
// gracefully disable Firestore L2 after the first permission rejection.
let firestoreL2Disabled = false;

function isPermissionOrUnavailableError(err: unknown): boolean {
  if (!err) {
    return false;
  }
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

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function getCachedGeocode(
  name: string,
  options?: {skipL2Read?: boolean},
): Promise<{lat: number; lng: number} | undefined> {
  if (!name || name.trim().length === 0) {
    return undefined;
  }
  const slug = toSlug(name);
  if (!slug) {
    return undefined;
  }

  const l1Hit = getL1Cache(slug);
  if (l1Hit) {
    return l1Hit;
  }

  if (options?.skipL2Read) {
    return undefined;
  }

  if (!firestoreL2Disabled) {
    try {
      const db = getAdminDb();
      const docSnap = await db.collection('geolocationCache').doc(slug).get();
      if (docSnap.exists) {
        const parsed = geolocationCacheConverter.fromFirestore(
          slug,
          docSnap.data() || {},
        );
        const coords = {lat: parsed.lat, lng: parsed.lng};
        setL1Cache(slug, coords);
        return coords;
      }
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      if (isPermissionOrUnavailableError(err)) {
        firestoreL2Disabled = true;
      }
    }
  }

  return undefined;
}

export async function warmGeocodeCacheBulk(names: string[]): Promise<void> {
  if (!names || names.length === 0 || firestoreL2Disabled) {
    return;
  }

  const missingSlugs: string[] = [];
  const seenSlugs = new Set<string>();

  for (const name of names) {
    if (!name || name.trim().length === 0) {
      continue;
    }
    const slug = toSlug(name);
    if (!slug || seenSlugs.has(slug) || cache.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);
    missingSlugs.push(slug);
  }

  if (missingSlugs.length === 0) {
    return;
  }

  try {
    const db = getAdminDb();
    const col = db.collection('geolocationCache');
    const refs = missingSlugs.map(slug => col.doc(slug));
    const snaps = await db.getAll(...refs);

    for (let i = 0; i < missingSlugs.length; i++) {
      const slug = missingSlugs[i];
      const docSnap = snaps[i];
      if (docSnap?.exists) {
        const parsed = geolocationCacheConverter.fromFirestore(
          slug,
          docSnap.data() || {},
        );
        setL1Cache(slug, {lat: parsed.lat, lng: parsed.lng});
      }
    }
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    if (isPermissionOrUnavailableError(err)) {
      firestoreL2Disabled = true;
    }
  }
}

export async function cacheGeocode(
  name: string,
  coordinates: {lat: number; lng: number},
): Promise<void> {
  await cacheGeocodesBulk([{name, coordinates}]);
}

export async function cacheGeocodesBulk(
  entries: Array<{name: string; coordinates: {lat: number; lng: number}}>,
): Promise<void> {
  if (!entries || entries.length === 0) {
    return;
  }

  const validEntries: Array<{
    slug: string;
    name: string;
    coordinates: {lat: number; lng: number};
  }> = [];
  const seenSlugs = new Set<string>();

  for (const entry of entries) {
    const slug = toSlug(entry.name);
    if (!slug || seenSlugs.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);
    setL1Cache(slug, entry.coordinates);
    validEntries.push({
      slug,
      name: entry.name,
      coordinates: entry.coordinates,
    });
  }

  if (validEntries.length === 0) {
    return;
  }

  if (!firestoreL2Disabled) {
    try {
      const db = getAdminDb();
      const col = db.collection('geolocationCache');
      const nowIso = new Date().toISOString();
      const BATCH_LIMIT = 400;

      for (let i = 0; i < validEntries.length; i += BATCH_LIMIT) {
        const chunk = validEntries.slice(i, i + BATCH_LIMIT);
        const batch = db.batch();
        for (const item of chunk) {
          batch.set(
            col.doc(item.slug),
            geolocationCacheConverter.toFirestoreWrite(item.slug, {
              name: item.name,
              lat: item.coordinates.lat,
              lng: item.coordinates.lng,
              updatedAt: nowIso,
            }),
            {merge: true},
          );
        }
        await batch.commit();
      }
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      if (isPermissionOrUnavailableError(err)) {
        firestoreL2Disabled = true;
      }
    }
  }
}

let hasLoggedMissingApiKey = false;

export async function geocodeLocation(
  name: string,
  options?: {skipPersist?: boolean; skipL2Read?: boolean},
): Promise<{lat: number; lng: number} | undefined> {
  if (options?.skipL2Read) {
    const slug = toSlug(name);
    if (slug) {
      const hit = getL1Cache(slug);
      if (hit) {
        return hit;
      }
    }
  } else {
    const cached = await getCachedGeocode(name);
    if (cached) {
      return cached;
    }
  }

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&key=${apiKey}`;
    const response = await fetch(url, {signal: controller.signal});
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
      if (!options?.skipPersist) {
        await cacheGeocode(name, coords);
      }
      return coords;
    }
    return undefined;
  } catch (error) {
    console.error(`[Geocoding] Exception for ${name}:`, error);
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}
