import {TRPCError} from '@trpc/server';
import {LibraryService} from '../../services/server/libraryService';
import type {AuthUser, LibraryRole} from './types';

export class PermissionService {
  /**
   * Asserts caller has required permission for a library.
   * Throws TRPCError(UNAUTHORIZED) if user is not logged in.
   * Throws TRPCError(FORBIDDEN) if user lacks the required role.
   */
  static async verifyLibraryAccess(
    user: AuthUser | null,
    libraryId: string,
    requiredRole: LibraryRole = 'viewer',
  ): Promise<boolean> {
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
  ): Promise<boolean> {
    return this.verifyLibraryAccess(user, libraryId, 'editor');
  }

  /**
   * Helper specifically for read/viewer access.
   */
  static async verifyLibraryReadAccess(
    libraryId: string,
    user: AuthUser | null,
  ): Promise<boolean> {
    return this.verifyLibraryAccess(user, libraryId, 'viewer');
  }
}
