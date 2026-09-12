import {useState, useEffect} from 'react';
import {useAuth} from '../../stores/authStore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
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
  getDocsFromCache,
} from 'firebase/firestore';
import {Library} from '../../types';
import {toast} from 'sonner';
import {trpc} from '../../lib/trpc';
import {
  DebugTelemetryEngine,
  calculatePayloadBytes,
  instrumentMutation,
} from '../../lib/telemetry';

export function useLibraries() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const userLibrariesKey = ['userLibraries', user?.uid];

  const [libraries, setLibraries] = useState<Library[]>(() => {
    if (!user) return [];
    return queryClient.getQueryData<Library[]>(userLibrariesKey) || [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!user) return true;
    const cached = queryClient.getQueryData<Library[]>(userLibrariesKey);
    return !cached || cached.length === 0;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  useEffect(() => {
    if (!user) return;

    let isMounted = true;
    let hasReceivedNetworkUpdate = false;

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

    const unregisterTelemetry =
      DebugTelemetryEngine.getInstance().registerListener(
        'useLibraries',
        'libraries(user)',
      );

    // Stage 1: Immediate IndexedDB Cache Paint for instant 0ms perception
    const hydrateFromCache = async () => {
      try {
        const cachedSnapshot = await getDocsFromCache(q);
        if (isMounted && !hasReceivedNetworkUpdate && !cachedSnapshot.empty) {
          const libs: Library[] = [];
          cachedSnapshot.forEach(doc => {
            const data = doc.data();
            libs.push({
              id: doc.id,
              ...data,
            } as Library);
          });

          const payloadBytes = calculatePayloadBytes(libs);
          DebugTelemetryEngine.getInstance().addLog(
            'db_read',
            `Hydrated libraries list from local cache (${cachedSnapshot.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB)`,
            {
              path: 'libraries(user)',
              fromCache: true,
              size: cachedSnapshot.size,
              bytes: payloadBytes,
              docCount: cachedSnapshot.size,
            },
          );

          setLibraries(libs);
          setIsLoading(false);
          queryClient.setQueryData(userLibrariesKey, libs);

          // Pre-seed individual library caches
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
        }
      } catch {
        // Cache miss or first visit - proceed smoothly to onSnapshot
      }
    };

    void hydrateFromCache();

    // Stage 2: Live real-time listener
    const unsubscribe = onSnapshot(
      q,
      {includeMetadataChanges: true},
      async snapshot => {
        hasReceivedNetworkUpdate = true;
        const parseStartTime = performance.now();
        const fromCache = snapshot.metadata.fromCache;
        const libs: Library[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          libs.push({
            id: doc.id,
            ...data,
          } as Library);
        });

        const parseDurationMs = Math.round(performance.now() - parseStartTime);
        const payloadBytes = calculatePayloadBytes(libs);

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Queried user libraries (${snapshot.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB, ${parseDurationMs}ms)`,
          {
            path: 'libraries(user)',
            fromCache,
            size: snapshot.size,
            bytes: payloadBytes,
            docCount: snapshot.size,
            parseDurationMs,
          },
        );

        if (isMounted) {
          setLibraries(libs);
          setIsLoading(false);
        }

        queryClient.setQueryData(userLibrariesKey, libs);

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
      },
      error => {
        if (isMounted) {
          setIsLoading(false);
        }
        handleFirestoreError(error, OperationType.LIST, 'libraries');
      },
    );

    return () => {
      isMounted = false;
      unregisterTelemetry();
      unsubscribe();
    };
  }, [user]);

  const createLibrary = async (name: string) => {
    if (!name.trim() || !user || isSubmitting) return;

    const trimmedName = name.trim();
    setIsSubmitting(true);

    try {
      const libPayload = {
        name: trimmedName,
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        access: {
          ...(user.email ? {[user.email.toLowerCase()]: 'owner'} : {}),
        },
        createdAt: serverTimestamp(),
        heroImageUrl: null,
        bookCount: 0,
      };

      const docRef = await instrumentMutation(
        'create',
        'libraries',
        libPayload,
        () => addDoc(collection(db, 'libraries'), libPayload),
      );

      toast.success('Library created successfully');

      // Generate hero image in background
      generateLibraryHeroImageMutation
        .mutateAsync({libraryName: trimmedName})
        .then(async url => {
          if (url) {
            try {
              const storagePath = `libraries/${docRef.id}/hero.png`;
              const storageUrl = await uploadBase64Image(url, storagePath);
              await instrumentMutation(
                'update',
                `libraries/${docRef.id}`,
                {heroImageUrl: storageUrl},
                () =>
                  updateDoc(doc(db, 'libraries', docRef.id), {
                    heroImageUrl: storageUrl,
                  }),
              );
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
