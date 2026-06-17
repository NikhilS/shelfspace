import {getAdminDb} from './firebaseAdmin';

export async function getCachedGeocode(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
  if (!name || name.trim().length === 0) return undefined;
  try {
    const dbAdmin = getAdminDb();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 100);
    const snap = await dbAdmin.collection('geolocationCache').doc(slug).get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.coordinates) {
        console.log(`[Geocoding Cache] Hit for "${name}" ->`, data.coordinates);
        return data.coordinates as {lat: number; lng: number};
      }
    }
  } catch (error) {
    console.error('[Geocoding Cache] Read error:', error);
  }
  return undefined;
}

export async function cacheGeocode(
  name: string,
  coordinates: {lat: number; lng: number},
) {
  try {
    const dbAdmin = getAdminDb();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 100);
    await dbAdmin.collection('geolocationCache').doc(slug).set({
      originalName: name,
      coordinates,
      cachedAt: new Date().toISOString(),
    });
    console.log(`[Geocoding Cache] Saved "${name}" to store.`);
  } catch (error) {
    console.error('[Geocoding Cache] Write error:', error);
  }
}

export async function geocodeLocation(
  name: string,
): Promise<{lat: number; lng: number} | undefined> {
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
      results?: Array<{geometry: {location: {lat: number; lng: number}}}>;
    };
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const coords = data.results[0].geometry.location;
      await cacheGeocode(name, coords);
      return coords;
    }
    console.warn(`[Geocoding] API returned status ${data.status} for ${name}`);
    return undefined;
  } catch (error) {
    console.error(`[Geocoding] Exception for ${name}:`, error);
    return undefined;
  }
}
