import {useQuery, useQueryClient} from '@tanstack/react-query';
import {doc, getDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {useAuth} from '../stores/authStore';
import {Library} from '../types';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user, isAuthReady} = useAuth();
  const queryClient = useQueryClient();
  const email = user?.email?.toLowerCase();

  const {data: role = null, isLoading: loading} = useQuery({
    queryKey: ['libraryPermissions', libraryId, userId, email],
    initialData: () => {
      if (!libraryId || !userId || !email) return undefined;
      const cachedRole = queryClient.getQueryData<string>([
        'libraryPermissions',
        libraryId,
        userId,
        email,
      ]);
      if (cachedRole) return cachedRole;

      const cachedLib = queryClient.getQueryData<Library>([
        'library',
        libraryId,
      ]);
      if (cachedLib) {
        if (cachedLib.ownerId === userId) return 'owner';
        if (
          cachedLib.access &&
          (cachedLib.access[email] || cachedLib.access[user?.email || ''])
        ) {
          return cachedLib.access[email] || cachedLib.access[user?.email || ''];
        }
      }
      return undefined;
    },
    queryFn: async () => {
      if (!libraryId || !userId || !email) return null;
      try {
        // Fast-path: Check if library is already in memory cache
        const cachedLib = queryClient.getQueryData<Library>([
          'library',
          libraryId,
        ]);
        if (cachedLib) {
          if (cachedLib.ownerId === userId) return 'owner';
          if (
            cachedLib.access &&
            (cachedLib.access[email] || cachedLib.access[user?.email || ''])
          ) {
            return (
              cachedLib.access[email] || cachedLib.access[user?.email || '']
            );
          }
        }

        const libDoc = await getDoc(doc(db, 'libraries', libraryId));
        if (libDoc.exists()) {
          const library = {id: libDoc.id, ...libDoc.data()} as Library;
          // Store library in TanStack cache so useLibraryData has it instantly
          queryClient.setQueryData(['library', libraryId], library);

          if (library.ownerId === userId) {
            return 'owner';
          } else if (
            library.access &&
            (library.access[email] || library.access[user?.email || ''])
          ) {
            return library.access[email] || library.access[user?.email || ''];
          }
        }
        return null;
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `libraries/${libraryId}`);
        return null;
      }
    },
    enabled: isAuthReady && !!libraryId && !!userId && !!email,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  const canDelete = role === 'owner' || role === 'editor';
  const canView = role === 'owner' || role === 'editor' || role === 'viewer';

  return {canEdit, isOwner, canDelete, canView, role, loading};
}
