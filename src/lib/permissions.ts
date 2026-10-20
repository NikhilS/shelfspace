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

  let role: 'owner' | 'editor' | 'viewer' | null = null;
  const normalizedEmail = userEmail?.trim().toLowerCase();

  if (library.ownerId === userId) {
    role = 'owner';
  } else if (
    normalizedEmail &&
    library.access &&
    (library.access[normalizedEmail] ||
      (userEmail && library.access[userEmail]))
  ) {
    role =
      library.access[normalizedEmail] ||
      (userEmail ? library.access[userEmail] : null);
  } else if (library.callerRole) {
    role = library.callerRole === 'admin' ? 'owner' : library.callerRole;
  }

  return {
    role,
    isOwner: role === 'owner',
    canEdit: role === 'owner' || role === 'editor',
    canDelete: role === 'owner' || role === 'editor',
    canView: role === 'owner' || role === 'editor' || role === 'viewer',
  };
}
