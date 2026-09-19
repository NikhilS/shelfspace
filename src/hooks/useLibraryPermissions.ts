import {useAuth} from '../stores/authStore';
import {trpc} from '../lib/trpc';
import {SUPERADMIN_EMAIL} from '../constants/auth';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase().trim();

  // Fast-path for superadmin
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();

  const {data, isLoading} = trpc.library.getPermissions.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(isAuthReady && libraryId && userId && !isSuperAdmin),
      staleTime: 1000 * 60 * 5,
    },
  );

  if (isSuperAdmin) {
    return {
      canEdit: true,
      isOwner: true,
      canDelete: true,
      canView: true,
      role: 'owner',
      loading: false,
    };
  }

  const role = data?.role ?? null;
  const isOwner = data?.isOwner ?? false;
  const canEdit = data?.canEdit ?? false;
  const canDelete = isOwner || canEdit;
  const canView = isOwner || canEdit || role === 'viewer';

  return {
    canEdit,
    isOwner,
    canDelete,
    canView,
    role,
    loading: Boolean(libraryId && userId && isLoading),
  };
}
