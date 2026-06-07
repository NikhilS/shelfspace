import {useState, useEffect} from 'react';
import {doc, getDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library} from '../types';
import {useAuth} from '../contexts/AuthContext';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user, isAuthReady} = useAuth();
  const [role, setRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
  const [loading, setLoading] = useState(true);

  const email = user?.email?.toLowerCase();

  useEffect(() => {
    if (!isAuthReady) {
      setLoading(true);
      return;
    }

    setRole(null);
    setLoading(true);

    if (!libraryId || !userId || !user) {
      setLoading(false);
      return;
    }

    const checkPerms = async () => {
      setLoading(true);
      try {
        const libDoc = await getDoc(doc(db, 'libraries', libraryId));
        if (libDoc.exists()) {
          const library = libDoc.data() as Library;

          let assignedRole: 'owner' | 'editor' | 'viewer' | null = null;

          if (library.ownerId === userId) {
            assignedRole = 'owner';
          } else if (email && library.access && library.access[email]) {
            assignedRole = library.access[email];
          }

          setRole(assignedRole);
        } else {
          setRole(null);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `libraries/${libraryId}`);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    void checkPerms();
  }, [libraryId, userId, email, isAuthReady]);

  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  const canDelete = role === 'owner' || role === 'editor';
  const canView = role === 'owner' || role === 'editor' || role === 'viewer';

  return {canEdit, isOwner, canDelete, canView, role, loading};
}
