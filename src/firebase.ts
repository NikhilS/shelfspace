import {initializeApp} from 'firebase/app';
import {getAuth, connectAuthEmulator} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App & Authentication for client-side OAuth token generation.
// All Firestore and Cloud Storage operations route exclusively through the server tRPC/OpenAPI Gateway.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

if (
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
}
