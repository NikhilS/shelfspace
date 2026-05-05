import {useState, useEffect} from 'react';
import {doc, getDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library} from '../types';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!libraryId || !userId) {
      setLoading(false);
      return;
    }

    const checkPerms = async () => {
      setLoading(true);
      try {
        const libDoc = await getDoc(doc(db, 'libraries', libraryId));
        if (libDoc.exists()) {
          const library = libDoc.data() as Library;
          const owner = library.ownerId === userId;
          const edit =
            owner ||
            (library.sharedWith && library.sharedWith.includes(userId));
          setIsOwner(owner);
          setCanEdit(edit);
        }
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.GET,
          `libraries/${libraryId}`
        );
      } finally {
        setLoading(false);
      }
    };
    
    checkPerms();
  }, [libraryId, userId]);

  return {canEdit, isOwner, loading};
}
