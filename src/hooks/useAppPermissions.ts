import {useEffect} from 'react';
import {useAuth} from '../stores/authStore';
import {SUPERADMIN_EMAIL} from '../constants/auth';
import {trpc} from '../lib/trpc';

const PERMISSIONS_CACHE_PREFIX = 'bookish_app_permissions_';

interface CachedPermissions {
  isAppAllowed: boolean;
  isAdmin: boolean;
}

function readCachedPermissions(
  email: string | undefined,
): CachedPermissions | undefined {
  if (!email || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(
      `${PERMISSIONS_CACHE_PREFIX}${email}`,
    );
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedPermissions>;
    if (
      typeof parsed.isAppAllowed === 'boolean' &&
      typeof parsed.isAdmin === 'boolean'
    ) {
      return {
        isAppAllowed: parsed.isAppAllowed,
        isAdmin: parsed.isAdmin,
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return undefined;
}

function writeCachedPermissions(
  email: string | undefined,
  perms: CachedPermissions,
): void {
  if (!email || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PERMISSIONS_CACHE_PREFIX}${email}`,
      JSON.stringify(perms),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function useAppPermissions() {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase().trim();
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();

  const cached = readCachedPermissions(email);

  const {data, isLoading, refetch} = trpc.auth.getPermissions.useQuery(
    undefined,
    {
      enabled: Boolean(isAuthReady && email && !isSuperAdmin),
      initialData: () => (cached ? {...cached, user: null} : undefined),
      staleTime: 1000 * 60 * 5,
    },
  );

  useEffect(() => {
    if (email && data && typeof data.isAppAllowed === 'boolean') {
      writeCachedPermissions(email, {
        isAppAllowed: data.isAppAllowed,
        isAdmin: Boolean(data.isAdmin),
      });
    }
  }, [email, data]);

  if (isSuperAdmin) {
    return {
      isAppAllowed: true,
      isAdmin: true,
      isLoadingPermissions: false,
      refetchPermissions: async () => {},
    };
  }

  const effectiveData = data ?? cached;

  return {
    isAppAllowed: effectiveData?.isAppAllowed ?? false,
    isAdmin: effectiveData?.isAdmin ?? false,
    isLoadingPermissions: Boolean(
      isAuthReady && email && isLoading && !effectiveData,
    ),
    refetchPermissions: refetch,
  };
}
