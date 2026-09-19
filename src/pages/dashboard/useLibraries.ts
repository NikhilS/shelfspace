import {useState} from 'react';
import {useAuth} from '../../stores/authStore';
import {uploadBase64Image} from '../../services/db/storage';
import {useQueryClient} from '@tanstack/react-query';
import {Library} from '../../types';
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

export function useLibraries() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const librariesQuery = trpc.library.list.useQuery(
    {},
    {
      enabled: Boolean(user),
      staleTime: 1000 * 60 * 5,
    },
  );

  const createLibraryMutation = trpc.library.create.useMutation({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [['library', 'list']],
      });
    },
  });

  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  const rawData = librariesQuery.data;
  const libraries = normalizeLibraries(rawData);

  // Pre-seed individual library caches for instant navigation
  if (libraries.length > 0) {
    const payloadBytes = calculatePayloadBytes(libraries);
    DebugTelemetryEngine.getInstance().addLog(
      'db_read',
      `Loaded ${libraries.length} user libraries via tRPC (${(payloadBytes / 1024).toFixed(1)} KB)`,
      {
        path: 'trpc.library.list',
        size: libraries.length,
        bytes: payloadBytes,
      },
    );

    libraries.forEach(lib => {
      queryClient.setQueryData(['library', lib.id], lib);
    });
  }

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
              void queryClient.invalidateQueries({
                queryKey: [['library', 'list']],
              });
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
  };
}
