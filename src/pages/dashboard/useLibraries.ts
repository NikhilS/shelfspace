import {useState, useEffect} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {db, auth, handleFirestoreError, OperationType} from '../../firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  or,
  getCountFromServer,
  updateDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import {Library} from '../../types';
import {toast} from 'sonner';
import {generateLibraryHeroImage} from '../../services/gemini';

export function useLibraries() {
  const {user} = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'libraries'),
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.email?.toLowerCase() || ''),
      ),
    );

    const unsubscribe = onSnapshot(
      q,
      async snapshot => {
        const libs: Library[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          libs.push({
            id: doc.id,
            ...data,
          } as Library);
        });

        setLibraries(libs);
        setIsLoading(false);

        // Auto-migrate legacy libraries missing bookCount
        libs.forEach(async lib => {
          if (lib.bookCount === undefined) {
            const coll = collection(db, 'libraries', lib.id, 'books');
            try {
              const countSnap = await getCountFromServer(coll);
              await updateDoc(doc(db, 'libraries', lib.id), {
                bookCount: countSnap.data().count,
              });
            } catch (e) {
              console.error(`Failed to migrate bookCount for lib ${lib.id}`, e);
            }
          }
        });
      },
      error => {
        setIsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'libraries');
      },
    );

    return () => unsubscribe();
  }, [user]);

  const createLibrary = async (name: string) => {
    if (!name.trim() || !user || isSubmitting) return;

    const trimmedName = name.trim();
    const tempId = `temp-${Date.now()}`;
    const tempLib: Library = {
      id: tempId,
      name: trimmedName,
      ownerId: user.uid,
      ownerName: user.displayName || user.email || 'Unknown',
      sharedWith: [],
      createdAt: Timestamp.now(),
      bookCount: 0,
    };

    const originalLibraries = [...libraries];
    setIsSubmitting(true);
    setLibraries(prev => [tempLib, ...prev]);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not logged in');
      const token = await user.getIdToken();

      const res = await fetch('/api/libraries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({name: trimmedName}),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create library');
      }

      const {id: newLibraryId} = await res.json();
      toast.success('Library created successfully');

      // Generate hero image in background
      generateLibraryHeroImage(trimmedName)
        .then(async url => {
          if (url) {
            try {
              await updateDoc(doc(db, 'libraries', newLibraryId), {
                heroImageUrl: url,
              });
            } catch (e) {
              console.error('Failed to save hero image', e);
            }
          }
        })
        .catch(console.error);
    } catch (error) {
      setLibraries(originalLibraries);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    libraries,
    isLoading,
    isSubmitting,
    createLibrary,
  };
}
