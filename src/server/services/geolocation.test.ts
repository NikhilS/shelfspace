import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  getCachedGeocode,
  cacheGeocode,
  geocodeLocation,
  warmGeocodeCacheBulk,
  cacheGeocodesBulk,
} from './geolocation';
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
    const mockBatchSet = vi.fn();
    const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn((slug: string) => ({id: slug})),
      })),
      batch: () => ({
        set: mockBatchSet,
        commit: mockBatchCommit,
      }),
    } as unknown as ReturnType<typeof adminModule.getAdminDb>);

    const customCity = 'Atlantis Ocean Center';
    const customCoords = {lat: 25.0, lng: -71.0};

    await cacheGeocode(customCity, customCoords);
    const retrieved = await getCachedGeocode(customCity);

    expect(retrieved).toEqual(customCoords);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('pre-warms multiple uncached locations in a single db.getAll call and writes multiple geocodes in a single db.batch', async () => {
    const mockGetAll = vi.fn().mockResolvedValueOnce([
      {
        exists: true,
        data: () => ({lat: 37.9838, lng: 23.7275}),
      },
      {
        exists: true,
        data: () => ({lat: 30.0444, lng: 31.2357}),
      },
    ]);
    const mockBatchSet = vi.fn();
    const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn((slug: string) => ({id: slug})),
      })),
      getAll: mockGetAll,
      batch: () => ({
        set: mockBatchSet,
        commit: mockBatchCommit,
      }),
    } as unknown as ReturnType<typeof adminModule.getAdminDb>);

    const uniqueSuffix = Date.now();
    const loc1 = `Athens Greece ${uniqueSuffix}`;
    const loc2 = `Cairo Egypt ${uniqueSuffix}`;

    await warmGeocodeCacheBulk([
      'Paris, France', // Already in L1 cache -> skipped from Firestore read
      loc1,
      loc2,
    ]);

    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockGetAll.mock.calls[0]).toHaveLength(2);

    const athens = await getCachedGeocode(loc1, {
      skipL2Read: true,
    });
    const cairo = await getCachedGeocode(loc2, {
      skipL2Read: true,
    });
    expect(athens).toEqual({lat: 37.9838, lng: 23.7275});
    expect(cairo).toEqual({lat: 30.0444, lng: 31.2357});

    await cacheGeocodesBulk([
      {
        name: `Lima Peru ${uniqueSuffix}`,
        coordinates: {lat: -12.0464, lng: -77.0428},
      },
      {
        name: `Cusco Peru ${uniqueSuffix}`,
        coordinates: {lat: -13.532, lng: -71.9675},
      },
    ]);

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
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
      batch: () => ({
        set: vi.fn(),
        commit: vi
          .fn()
          .mockRejectedValue(
            new Error(
              '7 PERMISSION_DENIED: Missing or insufficient permissions.',
            ),
          ),
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
