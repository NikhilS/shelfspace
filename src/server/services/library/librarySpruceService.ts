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
import {
  normalizeIsbnForDedupe,
  computeBookDedupeKey,
  computeBookSearchTokens,
} from '../../../lib/duplicateDetection';
import {catalogOrchestrator} from '../catalog';
import {
  bookDocConverter,
  bookDetailsDocConverter,
  normalizeFirestoreTimestamp,
} from '../book/bookPartitioner';
import {storedBookDocSchema} from '../../../schemas/book';
import {
  storedAllowedDuplicateDocSchema,
  type StoredAllowedDuplicateDoc,
} from '../../../schemas/libraryApi';
import {
  SchemaValidationError,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';

export const allowedDuplicateConverter = {
  toFirestoreWrite(
    libraryId: string,
    docId: string,
    bookIds: string[],
  ): {bookIds: string[]; createdAt: unknown} {
    const payload = {
      bookIds,
      createdAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(storedAllowedDuplicateDocSchema, payload, {
      entity: 'StoredAllowedDuplicateDoc',
      documentPath: `/libraries/${libraryId}/allowedDuplicates/${docId}`,
      operation: 'create',
    });
    return payload;
  },

  fromFirestore(
    libraryId: string,
    docId: string,
    raw: Record<string, unknown>,
  ): StoredAllowedDuplicateDoc {
    const createdAt = normalizeFirestoreTimestamp(raw.createdAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: docId,
    };
    if (createdAt !== undefined) {
      candidate.createdAt = createdAt;
    } else {
      delete candidate.createdAt;
    }
    for (const k of Object.keys(candidate)) {
      if (candidate[k] === undefined) {
        delete candidate[k];
      }
    }
    return validateFirestoreReadPayload(
      storedAllowedDuplicateDocSchema,
      candidate,
      {
        entity: 'StoredAllowedDuplicateDoc',
        documentPath: `/libraries/${libraryId}/allowedDuplicates/${docId}`,
        operation: 'read',
      },
    );
  },
};

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
        const docId =
          doc.id || (doc.ref as {id?: string})?.id || 'sanitized_book';
        const raw = (doc.data() || {}) as Record<string, unknown>;
        const {book, leakedDetails, hasLeaks} =
          bookDocConverter.fromFirestoreWithLegacyLeaks(
            docId,
            raw,
            `/libraries/${libraryId}/books/${docId}`,
          );

        const rawTitle =
          typeof raw.title === 'string' && raw.title.trim()
            ? raw.title
            : undefined;
        const rawAuthor =
          typeof raw.author === 'string' && raw.author.trim()
            ? raw.author
            : undefined;

        const computedCleanIsbn = normalizeIsbnForDedupe(book.isbn);
        const computedDedupeKey = computeBookDedupeKey(rawTitle, rawAuthor);
        const computedSearchTokens = computeBookSearchTokens({
          title: rawTitle,
          author: rawAuthor,
          isbn: book.isbn,
          series: book.series ?? undefined,
        });

        const needsIndexBackfill =
          (Boolean(computedCleanIsbn) &&
            book.cleanIsbn !== computedCleanIsbn) ||
          (Boolean(computedDedupeKey) &&
            book.dedupeKey !== computedDedupeKey) ||
          !Array.isArray(book.searchTokens) ||
          book.searchTokens.length === 0;

        if (hasLeaks || needsIndexBackfill) {
          const bookUpdates: Record<string, unknown> = {};

          if (computedCleanIsbn) {
            bookUpdates.cleanIsbn = computedCleanIsbn;
          }
          if (computedDedupeKey) {
            bookUpdates.dedupeKey = computedDedupeKey;
          }
          if (computedSearchTokens.length > 0) {
            bookUpdates.searchTokens = computedSearchTokens;
          }

          if (hasLeaks) {
            const detailPayload: Record<string, unknown> = {};
            if (leakedDetails.synopsis || leakedDetails.description) {
              detailPayload.synopsis =
                leakedDetails.synopsis || leakedDetails.description;
            }
            if (leakedDetails.authorBio) {
              detailPayload.authorBio = leakedDetails.authorBio;
            }
            if (leakedDetails.embedding) {
              detailPayload.embedding = leakedDetails.embedding;
            }
            if (leakedDetails.clusterCoordinates) {
              detailPayload.clusterCoordinates =
                leakedDetails.clusterCoordinates;
            }

            const detailRef = db
              .collection('libraries')
              .doc(libraryId)
              .collection('bookDetails')
              .doc(docId);
            if (
              typeof batch.set === 'function' &&
              Object.keys(detailPayload).length > 0
            ) {
              batch.set(
                detailRef,
                bookDetailsDocConverter.toFirestoreWrite(
                  docId,
                  detailPayload,
                  'upsert',
                  `/libraries/${libraryId}/bookDetails/${docId}`,
                ),
                {merge: true},
              );
              count++;
            }

            bookUpdates['bookDetailsMetadata.hasSynopsis'] = Boolean(
              leakedDetails.synopsis || leakedDetails.description,
            );
            bookUpdates['bookDetailsMetadata.hasAuthorBio'] = Boolean(
              leakedDetails.authorBio,
            );
            bookUpdates['bookDetailsMetadata.hasEmbedding'] = Boolean(
              leakedDetails.embedding,
            );
            bookUpdates['bookDetailsMetadata.hasClusterCoordinates'] = Boolean(
              leakedDetails.clusterCoordinates,
            );
            bookUpdates.synopsis = FieldValue.delete();
            bookUpdates.authorBio = FieldValue.delete();
            bookUpdates.embedding = FieldValue.delete();
            bookUpdates.clusterCoordinates = FieldValue.delete();
            bookUpdates.description = FieldValue.delete();
          }

          validateFirestoreWritePayload(
            storedBookDocSchema.partial(),
            bookUpdates,
            {
              entity: 'StoredBookDoc',
              documentPath: `/libraries/${libraryId}/books/${docId}`,
              operation: 'update',
            },
          );
          batch.update(doc.ref, bookUpdates);
          count++;
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

    validateFirestoreWritePayload(
      storedBookDocSchema.partial(),
      deletePayload,
      {
        entity: 'StoredBookDoc',
        documentPath: `/libraries/${libraryId}/books/*`,
        operation: 'update',
      },
    );
    if (detailDeletePayload) {
      bookDetailsDocConverter.toFirestoreWrite(
        'reset_details',
        detailDeletePayload,
        'update',
        `/libraries/${libraryId}/bookDetails/*`,
      );
    }

    const batchSize = 400;
    let batch = db.batch();
    let count = 0;
    let totalReset = 0;

    for (const doc of snapshot.docs) {
      const docId = doc.id || (doc.ref as {id?: string})?.id || 'reset_book';
      bookDocConverter.fromFirestoreWithLegacyLeaks(
        docId,
        (doc.data?.() || {}) as Record<string, unknown>,
        `/libraries/${libraryId}/books/${docId}`,
      );
      batch.update(doc.ref, deletePayload);
      count++;
      totalReset++;

      if (detailDeletePayload && typeof batch.set === 'function') {
        const resolvedId = doc.id || (doc.ref as {id?: string})?.id;
        if (resolvedId) {
          const detailRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('bookDetails')
            .doc(resolvedId);
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
    if (err instanceof TRPCError || err instanceof SchemaValidationError) {
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

export interface AuditPlaceholderCoversResult {
  scannedCount: number;
  clearedCount: number;
  clearedBookIds: string[];
}

export function isAuditableCoverUrl(url?: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('http')) {
    return false;
  }
  return (
    url.includes('books.google.com') ||
    url.includes('books.googleusercontent.com') ||
    url.includes('images.randomhouse.com') ||
    url.includes('covers.openlibrary.org')
  );
}

/**
 * Scans books in a library whose coverUrl or coverUrlRaw points to Google Books
 * (or other verifiable CDNs), verifies each unique URL via catalogOrchestrator.verifyCoverUrl,
 * and clears coverUrl, coverUrlRaw, and enrichmentStatus.coverImage for any book
 * with a placeholder cover (such as Google Books' 9,103-byte placeholder PNG).
 */
export async function auditPlaceholderCovers(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  options?: {skipAccessCheck?: boolean},
): Promise<AuditPlaceholderCoversResult> {
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
      return {scannedCount: 0, clearedCount: 0, clearedBookIds: []};
    }

    const candidateBooks: Array<{
      doc: FirebaseFirestore.QueryDocumentSnapshot;
      coverUrl?: string;
      coverUrlRaw?: string;
    }> = [];
    const uniqueUrls = new Set<string>();

    for (const doc of snapshot.docs) {
      const docId = doc.id || (doc.ref as {id?: string})?.id || 'audit_book';
      const parsedBook = bookDocConverter.fromFirestore(
        docId,
        (doc.data() || {}) as Record<string, unknown>,
        `/libraries/${libraryId}/books/${docId}`,
      );
      const coverUrl = parsedBook.coverUrl?.trim() || undefined;
      const coverUrlRaw = parsedBook.coverUrlRaw?.trim() || undefined;

      const hasAuditableCover =
        isAuditableCoverUrl(coverUrl) || isAuditableCoverUrl(coverUrlRaw);
      if (hasAuditableCover) {
        candidateBooks.push({doc, coverUrl, coverUrlRaw});
        if (isAuditableCoverUrl(coverUrl)) {
          uniqueUrls.add(coverUrl);
        }
        if (isAuditableCoverUrl(coverUrlRaw)) {
          uniqueUrls.add(coverUrlRaw);
        }
      }
    }

    if (candidateBooks.length === 0) {
      return {scannedCount: 0, clearedCount: 0, clearedBookIds: []};
    }

    // Verify unique URLs with bounded concurrency (5 concurrent requests)
    const urlList = Array.from(uniqueUrls);
    const urlValidity = new Map<string, boolean>();
    const concurrency = 5;
    let cursor = 0;

    const workers = Array.from(
      {length: Math.min(concurrency, urlList.length)},
      async () => {
        while (cursor < urlList.length) {
          const index = cursor++;
          const url = urlList[index];
          const isValid = await catalogOrchestrator.verifyCoverUrl(url);
          urlValidity.set(url, isValid);
        }
      },
    );
    await Promise.all(workers);

    const batchSize = 400;
    let batch = db.batch();
    let batchCount = 0;
    const clearedBookIds: string[] = [];
    const nowIso = new Date().toISOString();

    for (const item of candidateBooks) {
      const primaryInvalid =
        Boolean(item.coverUrl) &&
        isAuditableCoverUrl(item.coverUrl) &&
        urlValidity.get(item.coverUrl) === false;
      const rawInvalid =
        Boolean(item.coverUrlRaw) &&
        isAuditableCoverUrl(item.coverUrlRaw) &&
        urlValidity.get(item.coverUrlRaw) === false;

      const shouldClearAll = primaryInvalid || (!item.coverUrl && rawInvalid);

      if (shouldClearAll) {
        const docId = item.doc.id || (item.doc.ref as {id?: string})?.id || '';
        const clearAllPayload = {
          coverUrl: FieldValue.delete(),
          coverUrlRaw: FieldValue.delete(),
          'enrichmentStatus.coverImage': FieldValue.delete(),
          updatedAt: nowIso,
        };
        validateFirestoreWritePayload(
          storedBookDocSchema.partial(),
          clearAllPayload,
          {
            entity: 'StoredBookDoc',
            documentPath: `/libraries/${libraryId}/books/${docId || 'audit_book'}`,
            operation: 'update',
          },
        );
        batch.update(item.doc.ref, clearAllPayload);
        batchCount++;
        if (docId) {
          clearedBookIds.push(docId);
        }

        if (batchCount >= batchSize) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      } else if (rawInvalid) {
        const docId = item.doc.id || (item.doc.ref as {id?: string})?.id || '';
        const clearRawPayload = {
          coverUrlRaw: FieldValue.delete(),
          updatedAt: nowIso,
        };
        validateFirestoreWritePayload(
          storedBookDocSchema.partial(),
          clearRawPayload,
          {
            entity: 'StoredBookDoc',
            documentPath: `/libraries/${libraryId}/books/${docId || 'audit_book'}`,
            operation: 'update',
          },
        );
        batch.update(item.doc.ref, clearRawPayload);
        batchCount++;

        if (batchCount >= batchSize) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      scannedCount: candidateBooks.length,
      clearedCount: clearedBookIds.length,
      clearedBookIds,
    };
  } catch (err: unknown) {
    if (err instanceof TRPCError || err instanceof SchemaValidationError) {
      throw err;
    }
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      '[LibraryService] Error auditing placeholder covers:',
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to audit placeholder covers: ${errMsg}`,
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

    const groups = snap.docs.map(
      d =>
        allowedDuplicateConverter.fromFirestore(
          libraryId,
          d.id || 'dup_group',
          (d.data() || {}) as Record<string, unknown>,
        ).bookIds,
    );

    return {allowedDuplicateGroups: groups};
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
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

  const payload = allowedDuplicateConverter.toFirestoreWrite(
    libraryId,
    ref.id || 'dup_group',
    bookIds,
  );
  await ref.set(payload);

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
  if (buffer.length < 4) {
    return false;
  }

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
    if (buffer.length < 12) {
      return false;
    }
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
