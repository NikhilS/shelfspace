import {useEffect} from 'react';
import {useAuth} from '../stores/authStore';
import {SUPERADMIN_EMAIL} from '../constants/auth';
import {trpc} from '../lib/trpc';

const PERMISSIONS_CACHE_PREFIX = 'bookish_app_permissions_';

interface CachedPermissions {
  isAppAllowed: boolean;
  isAdmin: boolean;
  hasAiPlan?: boolean;
}

function readCachedPermissions(
  email: string | undefined,
): CachedPermissions | undefined {
  if (!email || typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(
      `${PERMISSIONS_CACHE_PREFIX}${email}`,
    );
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<CachedPermissions>;
    if (
      typeof parsed.isAppAllowed === 'boolean' &&
      typeof parsed.isAdmin === 'boolean'
    ) {
      return {
        isAppAllowed: parsed.isAppAllowed,
        isAdmin: parsed.isAdmin,
        hasAiPlan:
          typeof parsed.hasAiPlan === 'boolean'
            ? parsed.hasAiPlan
            : parsed.isAdmin,
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
  if (!email || typeof window === 'undefined') {
    return;
  }
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
  const {user, isAuthReady} = useAuth() ?? {};
  const email = user?.email?.toLowerCase().trim();
  const isSuperAdmin = email === SUPERADMIN_EMAIL.toLowerCase().trim();

  const cached = readCachedPermissions(email);

  const queryResult = trpc.auth.getPermissions.useQuery(undefined, {
    enabled: Boolean(isAuthReady && email && !isSuperAdmin),
    initialData: () =>
      cached?.isAppAllowed && user?.uid && email
        ? {
            isAppAllowed: cached.isAppAllowed,
            isAdmin: cached.isAdmin,
            hasAiPlan: Boolean(cached.isAdmin || cached.hasAiPlan),
            user: {
              uid: user.uid,
              email,
            },
          }
        : undefined,
    staleTime: 1000 * 60 * 5,
  });

  const data = queryResult.data;
  const isLoading = Boolean(queryResult.isLoading);
  const refetch = queryResult.refetch;

  useEffect(() => {
    if (email && data && typeof data.isAppAllowed === 'boolean') {
      writeCachedPermissions(email, {
        isAppAllowed: data.isAppAllowed,
        isAdmin: Boolean(data.isAdmin),
        hasAiPlan: Boolean(data.isAdmin || data.hasAiPlan),
      });
    }
  }, [email, data]);

  if (isSuperAdmin) {
    return {
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
      isLoadingPermissions: false,
      refetchPermissions: async () => {},
    };
  }

  const effectiveData = data ?? cached;
  const resolvedIsAdmin = effectiveData?.isAdmin ?? false;
  const resolvedHasAiPlan = effectiveData
    ? Boolean(resolvedIsAdmin || effectiveData.hasAiPlan)
    : Boolean(resolvedIsAdmin || !isAuthReady);

  return {
    isAppAllowed: effectiveData?.isAppAllowed ?? false,
    isAdmin: resolvedIsAdmin,
    hasAiPlan: resolvedHasAiPlan,
    isLoadingPermissions: Boolean(
      isAuthReady && email && isLoading && !effectiveData,
    ),
    refetchPermissions: refetch,
  };
}
