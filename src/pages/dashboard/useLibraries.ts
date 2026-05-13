import {useState, useEffect} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  or,
  FieldPath,
  getCountFromServer,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp,
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
        ...(user.email
          ? [
              where(new FieldPath('access', user.email), 'in', [
                'owner',
                'editor',
                'viewer',
              ]),
            ]
          : []),
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
    setIsSubmitting(true);

    try {
      const docRef = await addDoc(collection(db, 'libraries'), {
        name: trimmedName,
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        access: {
          ...(user.email ? {[user.email.toLowerCase()]: 'owner'} : {}),
        },
        createdAt: serverTimestamp(),
        heroImageUrl: null,
        bookCount: 0,
      });

      toast.success('Library created successfully');

      // Generate hero image in background
      generateLibraryHeroImage(trimmedName)
        .then(async url => {
          if (url) {
            try {
              await updateDoc(doc(db, 'libraries', docRef.id), {
                heroImageUrl: url,
              });
            } catch (e) {
              console.error('Failed to save hero image', e);
            }
          }
        })
        .catch(console.error);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'libraries');
      toast.error('Failed to create library');
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
