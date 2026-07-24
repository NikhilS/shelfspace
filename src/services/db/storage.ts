import {ref, uploadString, getDownloadURL} from 'firebase/storage';
import {storage} from '../../firebase';
import {toast} from 'sonner';

/**
 * Uploads a base64 image data URL (e.g. data:image/png;base64,...) to Cloud Storage.
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

  try {
    const storageRef = ref(storage, path);
    await uploadString(storageRef, base64Data, 'data_url');
    return await getDownloadURL(storageRef);
  } catch (error: unknown) {
    if (String(error).includes('retry-limit-exceeded')) {
      console.error('Firebase Storage CORS or Setup Error:', error);
      toast.error('Storage Upload Failed', {
        description:
          'Firebase Storage requires setup. Please ensure Cloud Storage is enabled in your Firebase Console and CORS is configured.',
        duration: 8000,
      });
    } else {
      console.error('Firebase Storage Upload Error:', error);
    }
    throw error;
  }
}
