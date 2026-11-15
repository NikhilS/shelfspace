import type express from 'express';
import type {LibraryApiRecord} from '../services/library/libraryCrudService';
import type {UserReadingState} from '../../types';

export type LibraryRole = 'owner' | 'editor' | 'viewer';

export interface AuthUser {
  uid: string;
  email: string;
  isSuperAdmin?: boolean;
  displayName?: string;
  name?: string;
  photoURL?: string;
}

export interface SecurityPermissions {
  isAppAllowed: boolean;
  isAdmin: boolean;
  hasAiPlan?: boolean;
}

export interface CachedLibraryAccess {
  role: LibraryRole;
  libraryData?: Record<string, unknown>;
}

export interface RequestScopedLoaders {
  getUserLibraries: (
    userId: string,
    userEmail?: string,
    isAdmin?: boolean,
  ) => Promise<{libraries: LibraryApiRecord[]}>;
  getUserReadingStatesMap: (
    userId: string,
  ) => Promise<Map<string, Partial<UserReadingState>>>;
}

export interface SecurityContext {
  req: express.Request;
  res: express.Response;
  user: AuthUser | null;
  isAppAllowed: boolean;
  isAdmin: boolean;
  hasAiPlan?: boolean;
  libraryId?: string;
  callerRole?: LibraryRole;
  libraryData?: Record<string, unknown>;
  libraryAccessCache?: Map<string, CachedLibraryAccess>;
  requestLoaders?: RequestScopedLoaders;
}
