import {
  getAdminApp,
  getAdminDb,
  firebaseConfig,
  formatFirestoreAdminError,
} from '../firebaseAdmin';
import admin from 'firebase-admin';
import crypto from 'crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import {LibraryService} from './index';

/**
 * Generalized metadata reset: purges any supported metadata category from all books
 * and corresponding heavy bookDetails records.
 */
export async function resetMetadata(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  metadataType: string,
  options?: {skipAccessCheck?: boolean},
): Promise<{count: number}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'editor',
    );
  }

  try {
    const db = getAdminDb();
    const booksRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books');
    const snapshot = await booksRef.get();

    if (snapshot.empty) {
      return {count: 0};
    }

    let deletePayload: Record<string, unknown> = {};
    let detailDeletePayload: Record<string, unknown> | undefined;

    if (metadataType === 'genre' || metadataType === 'primaryGenre') {
      deletePayload = {
        primaryGenre: FieldValue.delete(),
        subgenres: FieldValue.delete(),
        isCustomPrimary: FieldValue.delete(),
        'enrichmentStatus.genre': FieldValue.delete(),
      };
    } else if (metadataType === 'geo') {
      deletePayload = {
        geoMetadata: FieldValue.delete(),
        'enrichmentStatus.geo': FieldValue.delete(),
      };
    } else if (metadataType === 'temporal') {
      deletePayload = {
        temporalMetadata: FieldValue.delete(),
        'enrichmentStatus.temporal': FieldValue.delete(),
      };
    } else if (metadataType === 'synopsis') {
      deletePayload = {
        synopsis: FieldValue.delete(),
        description: FieldValue.delete(),
        'enrichmentStatus.synopsis': FieldValue.delete(),
        'bookDetailsMetadata.hasSynopsis': false,
      };
      detailDeletePayload = {
        synopsis: FieldValue.delete(),
        description: FieldValue.delete(),
      };
    } else if (metadataType === 'authorBio') {
      deletePayload = {
        authorBio: FieldValue.delete(),
        'enrichmentStatus.authorBio': FieldValue.delete(),
        'bookDetailsMetadata.hasAuthorBio': false,
      };
      detailDeletePayload = {
        authorBio: FieldValue.delete(),
      };
    } else if (metadataType === 'embedding') {
      deletePayload = {
        embedding: FieldValue.delete(),
        clusterCoordinates: FieldValue.delete(),
        'enrichmentStatus.embedding': FieldValue.delete(),
        'bookDetailsMetadata.hasEmbedding': false,
        'bookDetailsMetadata.hasClusterCoordinates': false,
      };
      detailDeletePayload = {
        embedding: FieldValue.delete(),
        clusterCoordinates: FieldValue.delete(),
      };
    } else if (metadataType === 'coverImage') {
      deletePayload = {
        coverUrl: FieldValue.delete(),
        coverUrlRaw: FieldValue.delete(),
        'enrichmentStatus.coverImage': FieldValue.delete(),
      };
    } else if (metadataType === 'series') {
      deletePayload = {
        series: FieldValue.delete(),
        'enrichmentStatus.series': FieldValue.delete(),
      };
    } else if (metadataType === 'sanitize') {
      const batchSize = 400;
      let batch = db.batch();
      let count = 0;
      let totalSanitized = 0;

      for (const doc of snapshot.docs) {
        const raw = doc.data();
        const hasLeaks =
          raw.synopsis !== undefined ||
          raw.authorBio !== undefined ||
          raw.embedding !== undefined ||
          raw.clusterCoordinates !== undefined ||
          raw.description !== undefined;

        if (hasLeaks) {
          const detailPayload: Record<string, unknown> = {};
          if (raw.synopsis || raw.description) {
            detailPayload.synopsis = raw.synopsis || raw.description;
          }
          if (raw.authorBio) detailPayload.authorBio = raw.authorBio;
          if (raw.embedding) detailPayload.embedding = raw.embedding;
          if (raw.clusterCoordinates) {
            detailPayload.clusterCoordinates = raw.clusterCoordinates;
          }

          const detailRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('bookDetails')
            .doc(doc.id);
          if (typeof batch.set === 'function') {
            batch.set(detailRef, detailPayload, {merge: true});
          }

          const bookUpdates: Record<string, unknown> = {
            'bookDetailsMetadata.hasSynopsis': Boolean(
              raw.synopsis || raw.description,
            ),
            'bookDetailsMetadata.hasAuthorBio': Boolean(raw.authorBio),
            'bookDetailsMetadata.hasEmbedding': Boolean(raw.embedding),
            'bookDetailsMetadata.hasClusterCoordinates': Boolean(
              raw.clusterCoordinates,
            ),
            synopsis: FieldValue.delete(),
            authorBio: FieldValue.delete(),
            embedding: FieldValue.delete(),
            clusterCoordinates: FieldValue.delete(),
            description: FieldValue.delete(),
          };

          batch.update(doc.ref, bookUpdates);
          count += 2;
          totalSanitized++;

          if (count >= batchSize) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      return {count: totalSanitized};
    } else {
      throw new Error(`Unsupported metadata reset type: '${metadataType}'`);
    }

    const batchSize = 400;
    let batch = db.batch();
    let count = 0;
    let totalReset = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, deletePayload);
      count++;
      totalReset++;

      if (detailDeletePayload && typeof batch.set === 'function') {
        const docId = doc.id || (doc.ref as {id?: string})?.id;
        if (docId) {
          const detailRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('bookDetails')
            .doc(docId);
          batch.set(detailRef, detailDeletePayload, {merge: true});
          count++;
        }
      }

      if (count >= batchSize) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    return {count: totalReset};
  } catch (err: unknown) {
    if (err instanceof TRPCError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error resetting metadata:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to reset metadata: ${errMsg}`,
    });
  }
}

/**
 * Lists allowed duplicate groups.
 */
export async function listAllowedDuplicates(
  libraryId: string,
): Promise<{allowedDuplicateGroups: string[][]}> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('allowedDuplicates')
      .get();

    const groups = snap.docs
      .map(d => d.data()?.bookIds as string[] | undefined)
      .filter((g): g is string[] => Array.isArray(g));

    return {allowedDuplicateGroups: groups};
  } catch {
    return {allowedDuplicateGroups: []};
  }
}

/**
 * Records a dismissed duplicate group.
 */
export async function allowDuplicateGroup(
  libraryId: string,
  bookIds: string[],
): Promise<{success: true; id: string}> {
  const db = getAdminDb();
  const ref = db
    .collection('libraries')
    .doc(libraryId)
    .collection('allowedDuplicates')
    .doc();

  await ref.set({
    bookIds,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {success: true, id: ref.id};
}

const ALLOWED_RASTER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const SAFE_STORAGE_PATH_REGEX =
  /^libraries\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_./-]{1,160}$/;

/**
 * Verifies that the decoded binary buffer matches the declared raster image MIME type magic bytes
 * and does not contain embedded SVG/HTML script tags.
 */
export function hasValidRasterMagicBytes(
  buffer: Buffer,
  mimeType: string,
): boolean {
  if (buffer.length < 4) return false;

  // Block disguised HTML/SVG payloads
  const headAscii = buffer.subarray(0, 256).toString('utf8').toLowerCase();
  if (
    headAscii.includes('<svg') ||
    headAscii.includes('<script') ||
    headAscii.includes('<!doctype html') ||
    headAscii.includes('<html')
  ) {
    return false;
  }

  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (normalizedMime === 'image/gif') {
    return (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    );
  }
  if (normalizedMime === 'image/webp') {
    if (buffer.length < 12) return false;
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }
  return false;
}

/**
 * Uploads a base64 image data URL to Firebase Cloud Storage via Admin SDK
 * after verifying editor permissions on the target library, MIME allowlist,
 * magic-byte signatures, and 5MB size cap.
 */
export async function uploadImage(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  path: string,
  base64Data: string,
  options?: {skipAccessCheck?: boolean},
): Promise<{url: string}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'editor',
    );
  }

  const expectedPrefix = `libraries/${libraryId}/`;
  if (
    !path ||
    !path.startsWith(expectedPrefix) ||
    path.includes('..') ||
    path.includes('//') ||
    path.includes('\\') ||
    !SAFE_STORAGE_PATH_REGEX.test(path)
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid storage path '${path}' for library '${libraryId}'`,
    });
  }

  if (!base64Data) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Image data is required',
    });
  }

  if (!base64Data.startsWith('data:')) {
    try {
      const parsed = new URL(base64Data);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Disallowed URL protocol');
      }
      return {url: base64Data};
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Non-data image URL must be a valid http(s) URL',
      });
    }
  }

  const match = base64Data.match(/^data:([^;]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid base64 image data URL format',
    });
  }

  const mimeType = match[1].trim().toLowerCase();
  if (!ALLOWED_RASTER_MIME_TYPES.has(mimeType)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unsupported or unsafe image MIME type '${mimeType}'. Allowed: PNG, JPEG, WebP, GIF`,
    });
  }

  const rawBase64 = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(rawBase64, 'base64');

  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Decoded image size (${buffer.length} bytes) exceeds 5MB limit or is empty`,
    });
  }

  if (!hasValidRasterMagicBytes(buffer, mimeType)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Image binary header does not match declared MIME type '${mimeType}'`,
    });
  }

  try {
    const app = getAdminApp();
    const bucketName =
      firebaseConfig?.storageBucket ||
      (firebaseConfig?.projectId
        ? `${firebaseConfig.projectId}.firebasestorage.app`
        : undefined);
    const bucket = admin.storage(app).bucket(bucketName);
    const file = bucket.file(path);
    const downloadToken = crypto.randomUUID();

    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
        contentDisposition: 'inline',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
      bucket.name,
    )}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;

    return {url: downloadUrl};
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error('[LibraryService] Error uploading image to Storage:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to upload image: ${errMsg}`,
    });
  }
}
