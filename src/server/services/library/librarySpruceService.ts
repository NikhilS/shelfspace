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
 * Generalized metadata reset: purges any supported metadata category from all books.
 */
export async function resetMetadata(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  metadataType: string,
): Promise<{count: number}> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'editor',
  );

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
        'enrichmentStatus.synopsis': FieldValue.delete(),
      };
    } else if (metadataType === 'authorBio') {
      deletePayload = {
        authorBio: FieldValue.delete(),
        'enrichmentStatus.authorBio': FieldValue.delete(),
      };
    } else if (metadataType === 'embedding') {
      deletePayload = {
        embedding: FieldValue.delete(),
        clusterCoordinates: FieldValue.delete(),
        'enrichmentStatus.embedding': FieldValue.delete(),
        'bookDetailsMetadata.hasEmbedding': false,
        'bookDetailsMetadata.hasClusterCoordinates': false,
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
          batch.set(detailRef, detailPayload, {merge: true});

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

      if (metadataType === 'embedding') {
        const detailRef = db
          .collection('libraries')
          .doc(libraryId)
          .collection('bookDetails')
          .doc(doc.id);
        batch.set(
          detailRef,
          {
            embedding: FieldValue.delete(),
            clusterCoordinates: FieldValue.delete(),
          },
          {merge: true},
        );
        count++;
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

/**
 * Uploads a base64 image data URL to Firebase Cloud Storage via Admin SDK
 * after verifying editor permissions on the target library.
 */
export async function uploadImage(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  path: string,
  base64Data: string,
): Promise<{url: string}> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'editor',
  );

  if (!base64Data || !base64Data.startsWith('data:')) {
    return {url: base64Data};
  }

  const expectedPrefix = `libraries/${libraryId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes('..')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid storage path '${path}' for library '${libraryId}'`,
    });
  }

  const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid base64 image data URL format',
    });
  }

  const mimeType = match[1];
  const rawBase64 = match[2];
  const buffer = Buffer.from(rawBase64, 'base64');

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
        contentType: mimeType,
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
