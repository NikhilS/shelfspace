import {ref, uploadString, getDownloadURL} from 'firebase/storage';
import {storage} from '../../firebase';

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
  const storageRef = ref(storage, path);
  await uploadString(storageRef, base64Data, 'data_url');
  return await getDownloadURL(storageRef);
}
