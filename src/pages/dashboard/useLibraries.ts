import {useState, useEffect, useRef} from 'react';
import {useAuth} from '../../stores/authStore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {reconcileBookCount} from '../../services/db/books';
import {uploadBase64Image} from '../../services/db/storage';
import {useQueryClient} from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  onSnapshot,
  or,
  FieldPath,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {Library} from '../../types';
import {toast} from 'sonner';
import {trpc} from '../../lib/trpc';

export function useLibraries() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  const reconciledLibsRef = useRef<Set<string>>(new Set());

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

        // Pre-seed TanStack Query cache so navigation to any library is immediate (0ms delay)
        libs.forEach(lib => {
          queryClient.setQueryData(['library', lib.id], lib);
          if (user) {
            const email = user.email?.toLowerCase();
            const role =
              lib.ownerId === user.uid
                ? 'owner'
                : (email && lib.access?.[email]) ||
                  (email && lib.access?.[user.email || '']) ||
                  'viewer';
            queryClient.setQueryData(
              ['libraryPermissions', lib.id, user.uid, email],
              role,
            );
          }
        });

        // Reconcile legacy libraries that lack a bookCount field
        libs.forEach(async lib => {
          if (
            lib.bookCount === undefined &&
            !reconciledLibsRef.current.has(lib.id)
          ) {
            reconciledLibsRef.current.add(lib.id);
            try {
              const count = await reconcileBookCount(lib.id);
              if (lib.bookCount !== count) {
                await updateDoc(doc(db, 'libraries', lib.id), {
                  bookCount: count,
                });
              }
            } catch (e) {
              console.error(
                `Failed to reconcile legacy bookCount for lib ${lib.id}`,
                e,
              );
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
      generateLibraryHeroImageMutation
        .mutateAsync({libraryName: trimmedName})
        .then(async url => {
          if (url) {
            try {
              const storagePath = `libraries/${docRef.id}/hero.png`;
              const storageUrl = await uploadBase64Image(url, storagePath);
              await updateDoc(doc(db, 'libraries', docRef.id), {
                heroImageUrl: storageUrl,
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
