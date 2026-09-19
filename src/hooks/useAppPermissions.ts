import {useAuth} from '../stores/authStore';
import {SUPERADMIN_EMAIL} from '../constants/auth';
import {trpc} from '../lib/trpc';

export function useAppPermissions() {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase().trim();
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();

  const {data, isLoading} = trpc.auth.getPermissions.useQuery(undefined, {
    enabled: Boolean(isAuthReady && email && !isSuperAdmin),
    staleTime: 1000 * 60 * 5,
  });

  if (isSuperAdmin) {
    return {
      isAppAllowed: true,
      isAdmin: true,
      isLoadingPermissions: false,
    };
  }

  return {
    isAppAllowed: data?.isAppAllowed ?? false,
    isAdmin: data?.isAdmin ?? false,
    isLoadingPermissions: Boolean(isAuthReady && email && isLoading),
  };
}
