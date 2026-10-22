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

  let data:
    | {
        isAppAllowed: boolean;
        isAdmin: boolean;
        hasAiPlan?: boolean;
        user?: unknown;
      }
    | undefined;
  let isLoading = false;
  let refetch: () => Promise<unknown> = async () => {};

  const usePermissionsQuery = trpc?.auth?.getPermissions?.useQuery;
  if (typeof usePermissionsQuery === 'function') {
    try {
      const queryResult = usePermissionsQuery(undefined, {
        enabled: Boolean(isAuthReady && email && !isSuperAdmin),
        initialData: () =>
          cached?.isAppAllowed
            ? {
                isAppAllowed: cached.isAppAllowed,
                isAdmin: cached.isAdmin,
                hasAiPlan: Boolean(cached.isAdmin || cached.hasAiPlan),
                user: null,
              }
            : undefined,
        staleTime: 1000 * 60 * 5,
      });
      data = queryResult?.data;
      isLoading = Boolean(queryResult?.isLoading);
      if (queryResult?.refetch) {
        refetch = queryResult.refetch;
      }
    } catch {
      // Fallback when rendered outside tRPC Provider in isolated unit tests
    }
  }

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
    : Boolean(
        resolvedIsAdmin ||
        typeof usePermissionsQuery !== 'function' ||
        !isAuthReady,
      );

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
