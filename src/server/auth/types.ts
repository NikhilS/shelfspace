import type express from 'express';

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
}
