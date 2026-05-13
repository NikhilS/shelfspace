import {useState, useEffect} from 'react';
import {doc, getDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library} from '../types';
import {useAuth} from '../contexts/AuthContext';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user} = useAuth();
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canView, setCanView] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [role, setRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
          } else if (
            user.email &&
            library.access &&
            library.access[user.email.toLowerCase()]
          ) {
            assignedRole = library.access[user.email.toLowerCase()];
          }

          setRole(assignedRole);
          const isOwnerVal = assignedRole === 'owner';
          setIsOwner(isOwnerVal);

          setCanEdit(assignedRole === 'owner' || assignedRole === 'editor');
          setCanDelete(assignedRole === 'owner' || assignedRole === 'editor');
          setCanView(
            assignedRole === 'owner' ||
              assignedRole === 'editor' ||
              assignedRole === 'viewer',
          );
        } else {
          // If library doesn't exist, they can't do anything
          setRole(null);
          setIsOwner(false);
          setCanEdit(false);
          setCanDelete(false);
          setCanView(false);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `libraries/${libraryId}`);
        // Default to denied on error
        setRole(null);
        setIsOwner(false);
        setCanEdit(false);
        setCanDelete(false);
        setCanView(false);
      } finally {
        setLoading(false);
      }
    };

    void checkPerms();
  }, [libraryId, userId, user]);

  return {canEdit, isOwner, canDelete, canView, role, loading};
}
