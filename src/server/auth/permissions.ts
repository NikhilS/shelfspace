import {TRPCError} from '@trpc/server';
import {LibraryService} from '../services/library';
import type {AuthUser, LibraryRole} from './types';

const ROLE_HIERARCHY: Record<LibraryRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export class PermissionService {
  /**
   * Returns true if `callerRole` meets or exceeds `requiredRole` in the library role hierarchy.
   */
  static hasSufficientRole(
    callerRole: LibraryRole,
    requiredRole: LibraryRole,
  ): boolean {
    return (
      (ROLE_HIERARCHY[callerRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0)
    );
  }

  /**
   * Asserts caller has required permission for a library.
   * Throws TRPCError(UNAUTHORIZED) if user is not logged in.
   * Throws TRPCError(FORBIDDEN) if user lacks the required role.
   */
  static async verifyLibraryAccess(
    user: AuthUser | null,
    libraryId: string,
    requiredRole: LibraryRole = 'viewer',
  ): Promise<boolean | {role: string; userId: string}> {
    if (!user || !user.uid) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    }

    return LibraryService.verifyLibraryAccess(
      user.uid,
      user.email,
      libraryId,
      requiredRole,
    );
  }

  /**
   * Helper specifically for write/edit access.
   */
  static async verifyLibraryWriteAccess(
    libraryId: string,
    user: AuthUser | null,
  ): Promise<boolean | {role: string; userId: string}> {
    return this.verifyLibraryAccess(user, libraryId, 'editor');
  }

  /**
   * Helper specifically for read/viewer access.
   */
  static async verifyLibraryReadAccess(
    libraryId: string,
    user: AuthUser | null,
  ): Promise<boolean | {role: string; userId: string}> {
    return this.verifyLibraryAccess(user, libraryId, 'viewer');
  }
}
