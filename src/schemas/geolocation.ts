import {z} from 'zod';

/**
 * Validated WGS84 coordinate pair used by in-memory, disk, and Firestore L2 geolocation caches.
 */
export const geolocationCoordinatesSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

export type GeolocationCoordinates = z.infer<
  typeof geolocationCoordinatesSchema
>;

/**
 * Stored Firestore document schema for `geolocationCache/{slug}`.
 */
export const storedGeolocationCacheDocSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    name: z.string().min(1).max(300).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    formattedAddress: z.string().max(500).optional(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

export type StoredGeolocationCacheDoc = z.infer<
  typeof storedGeolocationCacheDocSchema
>;

/**
 * Local disk cache schema for `.cache/geocache.json`.
 */
export const diskGeolocationCacheSchema = z.record(
  z.string().min(1).max(128),
  geolocationCoordinatesSchema,
);

export type DiskGeolocationCache = z.infer<typeof diskGeolocationCacheSchema>;
