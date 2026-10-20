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

  // Fast-path for superadmin or user's own virtual reading shelf
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();
  const isUserVirtualShelf = Boolean(
    libraryId && userId && libraryId === `virtual_${userId}`,
  );

  const getCachedLibrary = (): Library | undefined => {
    if (!libraryId || !userId || !utils?.library) return undefined;
    return (
      (utils.library.get?.getData?.({libraryId}) as Library | undefined) ||
      (
        utils.library.list?.getData?.({scopes: ['owned', 'shared']})
          ?.libraries as Library[] | undefined
      )?.find(l => l.id === libraryId) ||
      (
        utils.library.list?.getData?.()?.libraries as Library[] | undefined
      )?.find(l => l.id === libraryId)
    );
  };

  const cachedLibrary = getCachedLibrary();
  const cachedAccess = cachedLibrary
    ? getAccessFromLibrary(cachedLibrary, userId, email)
    : undefined;

  const isQueryEnabled = Boolean(
    isAuthReady && libraryId && userId && !isSuperAdmin && !isUserVirtualShelf,
  );

  // Share the canonical library.get query instead of firing a redundant library.getPermissions RPC
  const hasLibraryGetQuery = Boolean(trpc?.library?.get?.useQuery);
  const libraryQuery = hasLibraryGetQuery
    ? trpc.library.get.useQuery(
        {libraryId: libraryId || ''},
        {
          enabled: isQueryEnabled,
          initialData: cachedLibrary,
          staleTime: 1000 * 60 * 5,
          gcTime: 1000 * 60 * 60 * 24,
        },
      )
    : undefined;

  // Fallback for isolated test mocks that only define library.getPermissions.useQuery
  const legacyPermQuery =
    !hasLibraryGetQuery && Boolean(trpc?.library?.getPermissions?.useQuery)
      ? trpc.library.getPermissions.useQuery(
          {libraryId: libraryId || ''},
          {
            enabled: isQueryEnabled,
            staleTime: 1000 * 60 * 5,
          },
        )
      : undefined;

  if (isSuperAdmin || isUserVirtualShelf) {
    return {
      canEdit: true,
      isOwner: true,
      canDelete: true,
      canView: true,
      role: 'owner' as const,
      loading: false,
      isError: false,
    };
  }

  const resolvedFromLibrary = libraryQuery?.data
    ? getAccessFromLibrary(
        libraryQuery.data as unknown as Library,
        userId,
        email,
      )
    : undefined;

  const effective =
    resolvedFromLibrary && resolvedFromLibrary.role
      ? resolvedFromLibrary
      : legacyPermQuery?.data
        ? {
            role: legacyPermQuery.data.role,
            isOwner: legacyPermQuery.data.isOwner,
            canEdit: legacyPermQuery.data.canEdit,
          }
        : cachedAccess && cachedAccess.role
          ? cachedAccess
          : undefined;

  const role = effective?.role ?? null;
  const isOwner = effective?.isOwner ?? false;
  const canEdit = effective?.canEdit ?? false;
  const canDelete = isOwner || canEdit;
  const canView = isOwner || canEdit || role === 'viewer';
  const isQueryLoading = Boolean(
    libraryQuery?.isLoading ?? legacyPermQuery?.isLoading,
  );
  const isError = Boolean(libraryQuery?.isError ?? legacyPermQuery?.isError);

  return {
    canEdit,
    isOwner,
    canDelete,
    canView,
    role,
    loading: Boolean(libraryId && userId && isQueryLoading && !effective),
    isError,
  };
}
