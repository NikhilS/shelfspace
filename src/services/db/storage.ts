import {trpcVanilla} from '../../lib/trpc';
import {toast} from 'sonner';

/**
 * Uploads a base64 image data URL (e.g. data:image/png;base64,...) to Cloud Storage
 * via the server-authoritative tRPC Gateway (firebase-admin/storage).
 * @param base64Data The base64 data string.
 * @param path The path in Firebase Storage (e.g. 'libraries/123/hero.png')
 */
export async function uploadBase64Image(
  base64Data: string,
  path: string,
): Promise<string> {
  if (!base64Data || !base64Data.startsWith('data:')) {
    // If it's already a URL or empty, return it directly.
    return base64Data;
  }

  const match = path.match(/^libraries\/([^/]+)\//);
  const libraryId = match?.[1] || '';

  if (!libraryId) {
    throw new Error(`Invalid storage path '${path}': missing libraryId prefix`);
  }

  try {
    const res = await trpcVanilla.library.uploadImage.mutate({
      libraryId,
      path,
      base64Data,
    });
    return res.url;
  } catch (error: unknown) {
    if (String(error).includes('retry-limit-exceeded')) {
      console.error('Firebase Storage Setup Error:', error);
      toast.error('Storage Upload Failed', {
        description:
          'Firebase Storage requires setup. Please ensure Cloud Storage is enabled in your Firebase Console.',
        duration: 8000,
      });
    } else {
      console.error('Server Storage Upload Error:', error);
    }
    throw error;
  }
}
