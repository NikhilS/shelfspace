import {useQuery} from '@tanstack/react-query';
import {doc, getDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {useAuth} from '../stores/authStore';
import {Library} from '../types';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase();

  const {data: role = null, isLoading: loading} = useQuery({
    queryKey: ['libraryPermissions', libraryId, userId, email],
    queryFn: async () => {
      if (!libraryId || !userId || !email) return null;
      try {
        const libDoc = await getDoc(doc(db, 'libraries', libraryId));
        if (libDoc.exists()) {
          const library = libDoc.data() as Library;
          if (library.ownerId === userId) {
            return 'owner';
          } else if (library.access && library.access[email]) {
            return library.access[email];
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
