import {describe, it, expect, vi, beforeEach} from 'vitest';
import {getCachedGeocode, cacheGeocode, geocodeLocation} from './geolocation';
import * as adminModule from './firebaseAdmin';

describe('geolocation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves pre-seeded locations from memory instantly', async () => {
    const coords = await getCachedGeocode('Paris, France');
    expect(coords).toBeDefined();
    expect(coords?.lat).toBeCloseTo(48.8566, 2);
    expect(coords?.lng).toBeCloseTo(2.3522, 2);
  });

  it('resolves London from pre-seeded memory cache', async () => {
    const coords = await getCachedGeocode('London, UK');
    expect(coords).toBeDefined();
    expect(coords?.lat).toBeCloseTo(51.5074, 2);
    expect(coords?.lng).toBeCloseTo(-0.1278, 2);
  });

  it('updates cache and returns coordinates for custom locations', async () => {
    const customCity = 'Atlantis Ocean Center';
    const customCoords = {lat: 25.0, lng: -71.0};

    await cacheGeocode(customCity, customCoords);
    const retrieved = await getCachedGeocode(customCity);

    expect(retrieved).toEqual(customCoords);
  });

  it('handles Firestore L2 permission denied gracefully without throwing', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi
            .fn()
            .mockRejectedValue(
              new Error(
                '7 PERMISSION_DENIED: Missing or insufficient permissions.',
              ),
            ),
          set: vi
            .fn()
            .mockRejectedValue(
              new Error(
                '7 PERMISSION_DENIED: Missing or insufficient permissions.',
              ),
            ),
        }),
      }),
    };

    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue(
      mockDb as unknown as ReturnType<typeof adminModule.getAdminDb>,
    );

    const res = await getCachedGeocode('NonExistentCity12345');
    expect(res).toBeUndefined();

    // Cache should still succeed in memory/disk without throwing
    await expect(
      cacheGeocode('NewTestPlace98765', {lat: 10.0, lng: 20.0}),
    ).resolves.not.toThrow();

    const cached = await getCachedGeocode('NewTestPlace98765');
    expect(cached).toEqual({lat: 10.0, lng: 20.0});
  });

  it('returns undefined gracefully when geocoding without API key', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;

    const coords = await geocodeLocation('Unknown Faraway Hamlet 99999');
    expect(coords).toBeUndefined();
  });
});
