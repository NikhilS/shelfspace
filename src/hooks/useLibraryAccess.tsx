import {createContext, useContext} from 'react';
import {Library} from '../types';

export interface LibraryAccess {
  role: 'owner' | 'editor' | 'viewer' | null;
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canView: boolean;
}

export function getAccessFromLibrary(
  library: Library | null,
  userId: string | undefined,
  userEmail: string | undefined | null,
): LibraryAccess {
  if (!library || !userId) {
    return {
      role: null,
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canView: false,
    };
  }

  // Check new ABAC map first
  let role: 'owner' | 'editor' | 'viewer' | null = null;
  if (library.ownerId === userId) {
    role = 'owner';
  } else if (
    userEmail &&
    library.access &&
    library.access[userEmail.toLowerCase()]
  ) {
    role = library.access[userEmail.toLowerCase()];
  }

  return {
    role,
    isOwner: role === 'owner',
    canEdit: role === 'owner' || role === 'editor',
    canDelete: role === 'owner' || role === 'editor', // According to spec, editor can delete books. Owner can delete library
    canView: role === 'owner' || role === 'editor' || role === 'viewer',
  };
}

const LibraryAccessContext = createContext<LibraryAccess | null>(null);

export function useLibraryAccess() {
  const context = useContext(LibraryAccessContext);
  if (!context) {
    return {
      role: null,
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canView: false,
    };
  }
  return context;
}
