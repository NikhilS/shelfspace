import {useState, useEffect, useCallback} from 'react';
import {useAuth} from '../../stores/authStore';
import {uploadBase64Image} from '../../services/db/storage';
import {Library} from '../../types';
import {LibraryScope} from '../../schemas/libraryApi';
import {toast} from 'sonner';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../../lib/telemetry';

function normalizeLibraries(data: unknown): Library[] {
  if (Array.isArray(data)) return data as Library[];
  if (data && typeof data === 'object') {
    if (
      'libraries' in data &&
      Array.isArray((data as {libraries: unknown}).libraries)
    ) {
      return (data as {libraries: Library[]}).libraries;
    }
    if ('data' in data && Array.isArray((data as {data: unknown}).data)) {
      return (data as {data: Library[]}).data;
    }
  }
  return [];
}

export function useLibraries(
  initialScopes: LibraryScope[] = ['owned', 'shared'],
) {
  const {user} = useAuth();
  const utils = trpc.useUtils();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scopes, setScopes] = useState<LibraryScope[]>(initialScopes);

  const librariesQuery = trpc.library.list.useQuery(
    {scopes},
    {
      enabled: Boolean(user),
      staleTime: 1000 * 60 * 5,
    },
  );

  const toggleScope = useCallback((scope: LibraryScope) => {
    setScopes(prev => {
      if (scope === 'all') {
        if (prev.includes('all')) {
          return ['owned', 'shared'];
        }
        return ['all'];
      }

      // If 'all' was active, switch to specific filters
      const withoutAll = prev.filter(s => s !== 'all');
      const isCurrentlySelected = withoutAll.includes(scope);

      if (isCurrentlySelected) {
        // Prevent deselecting if it's the only active filter
        if (withoutAll.length === 1) {
          return withoutAll;
        }
        return withoutAll.filter(s => s !== scope);
      } else {
        return [...withoutAll, scope];
      }
    });
  }, []);

  const createLibraryMutation = trpc.library.create.useMutation({
    onSuccess: () => {
      void utils.library.list.invalidate();
    },
  });

  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  const rawData = librariesQuery.data;
  const libraries = normalizeLibraries(rawData);

  // Pre-seed individual library caches for instant navigation
  useEffect(() => {
    if (libraries.length > 0) {
      const schedule =
        typeof window !== 'undefined' && 'requestIdleCallback' in window
          ? window.requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 10);
      const cancel =
        typeof window !== 'undefined' && 'cancelIdleCallback' in window
          ? window.cancelIdleCallback
          : (id: number) => clearTimeout(id);

      const handle = schedule(() => {
        const payloadBytes = calculatePayloadBytes(libraries);
        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Loaded ${libraries.length} libraries via tRPC (scopes: ${scopes.join(', ')}) (${(payloadBytes / 1024).toFixed(1)} KB)`,
          {
            path: 'trpc.library.list',
            scopes,
            size: libraries.length,
            bytes: payloadBytes,
          },
        );
      });

      libraries.forEach(lib => {
        if (lib.id) {
          utils.library.get.setData(
            {libraryId: lib.id},
            lib as unknown as NonNullable<
              ReturnType<typeof utils.library.get.getData>
            >,
          );
        }
      });

      return () => {
        cancel(handle as number);
      };
    }
  }, [libraries, scopes, utils]);

  const createLibrary = async (name: string) => {
    if (!name.trim() || !user || isSubmitting) return;

    const trimmedName = name.trim();
    setIsSubmitting(true);

    try {
      const result = await createLibraryMutation.mutateAsync({
        name: trimmedName,
      });

      toast.success('Library created successfully');
      const createdId = result.id;

      // Generate hero image in background
      generateLibraryHeroImageMutation
        .mutateAsync({libraryName: trimmedName})
        .then(async url => {
          if (url && createdId) {
            try {
              const storagePath = `libraries/${createdId}/hero.png`;
              const storageUrl = await uploadBase64Image(url, storagePath);
              await trpcVanilla.library.update.mutate({
                libraryId: createdId,
                heroImageUrl: storageUrl,
              });
              void utils.library.list.invalidate();
            } catch (e) {
              console.error('Failed to save hero image', e);
            }
          }
        })
        .catch(console.error);
    } catch (error) {
      console.error('Failed to create library:', error);
      toast.error('Failed to create library');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    libraries,
    isLoading: librariesQuery.isLoading,
    isSubmitting,
    createLibrary,
    scopes,
    setScopes,
    toggleScope,
  };
}
