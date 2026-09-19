import type express from 'express';

export type LibraryRole = 'owner' | 'editor' | 'viewer';

export interface AuthUser {
  uid: string;
  email: string;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
  isSuperAdmin?: boolean;
}

export interface SecurityPermissions {
  isAppAllowed: boolean;
  isAdmin: boolean;
}

export interface SecurityContext {
  req: express.Request;
  res: express.Response;
  user: AuthUser | null;
  isAppAllowed: boolean;
  isAdmin: boolean;
}

export interface AuthenticatedSecurityContext extends SecurityContext {
  user: AuthUser;
  isAppAllowed: true;
}

export interface AuthenticatedApiRequest extends express.Request {
  user: AuthUser;
  isAppAllowed: boolean;
  isAdmin: boolean;
}

export interface OpenApiMeta {
  openapi?: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    protect?: boolean;
    deprecated?: boolean;
  };
}
