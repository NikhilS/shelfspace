import {describe, it} from 'vitest';
import {db} from './firebase';
import {collection, getDocs} from 'firebase/firestore';

describe('Firebase Emulator Test', () => {
  it('connects to firestore', async () => {
    await getDocs(collection(db, 'test-collection'));
  });
});
