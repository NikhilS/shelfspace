import {useAuth} from '../stores/authStore';
import {trpc} from '../lib/trpc';
import {SUPERADMIN_EMAIL} from '../constants/auth';
import {getAccessFromLibrary} from '../lib/permissions';
import {Library} from '../types';

export function useLibraryPermissions(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase().trim();
  let utils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      utils = trpc.useUtils();
    }
  } catch {
    utils = undefined;
  }

  // Fast-path for superadmin
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();

  const deriveFromCachedLibrary = () => {
    if (!libraryId || !userId || !utils?.library) return undefined;
    const cachedLib =
      (utils.library.get?.getData?.({libraryId}) as Library | undefined) ||
      (
        utils.library.list?.getData?.({scopes: ['owned', 'shared']})
          ?.libraries as Library[] | undefined
      )?.find(l => l.id === libraryId) ||
      (
        utils.library.list?.getData?.()?.libraries as Library[] | undefined
      )?.find(l => l.id === libraryId);

    if (!cachedLib) return undefined;

    const access = getAccessFromLibrary(cachedLib, userId, email);
    const derivedRole: 'owner' | 'editor' | 'viewer' | null = access.role;

    if (!derivedRole) return undefined;
    return {
      role: derivedRole,
      isOwner: access.isOwner,
      canEdit: access.canEdit,
    };
  };

  const cachedAccess = deriveFromCachedLibrary();

  const {data, isLoading} = trpc.library.getPermissions.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(isAuthReady && libraryId && userId && !isSuperAdmin),
      initialData: () => cachedAccess,
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

  const effective = data ?? cachedAccess;
  const role = effective?.role ?? null;
  const isOwner = effective?.isOwner ?? false;
  const canEdit = effective?.canEdit ?? false;
  const canDelete = isOwner || canEdit;
  const canView = isOwner || canEdit || role === 'viewer';

  return {
    canEdit,
    isOwner,
    canDelete,
    canView,
    role,
    loading: Boolean(libraryId && userId && isLoading && !effective),
  };
}
