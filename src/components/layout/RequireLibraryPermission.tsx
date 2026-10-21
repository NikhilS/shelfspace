import React, {useEffect, useRef} from 'react';
import {useParams, useLocation} from 'react-router-dom';
import {useAuth} from '../../stores/authStore';
import {useLibraryPermissions} from '../../hooks/useLibraryPermissions';
import {AlertCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {SuspenseFallbackRouter} from './SuspenseFallbackRouter';
import {trpc} from '../../lib/trpc';
import {preloadRouteByPathname} from '../../lib/routePreload';

interface RequireLibraryPermissionProps {
  children?: React.ReactNode;
  requires: 'owner' | 'editor' | 'viewer';
}

export function RequireLibraryPermission({
  children,
  requires,
}: RequireLibraryPermissionProps) {
  const params = useParams<Record<string, string>>();
  const location = useLocation();
  const libraryId = params.id || params.libraryId;
  const {user} = useAuth();
  const {canEdit, isOwner, canView, role, loading, isError} =
    useLibraryPermissions(libraryId, user?.uid);

  let utils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      utils = trpc.useUtils();
    }
  } catch {
    utils = undefined;
  }
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  // Preload view chunk and prefetch book list in parallel with library/permission resolution
  useEffect(() => {
    preloadRouteByPathname(location.pathname);
    const currentUtils = utilsRef.current;
    if (libraryId && user?.uid && currentUtils?.book?.list?.prefetch) {
      void currentUtils.book.list.prefetch(
        {libraryId},
        {staleTime: 1000 * 60 * 5},
      );
    }
  }, [libraryId, user?.uid, location.pathname]);

  // For viewer routes, mount children immediately while library.get is in flight
  // so lazy chunks and child queries run in parallel with server-enforced RBAC.
  if (loading) {
    if (requires === 'viewer' && !isError) {
      return <>{children}</>;
    }
    return <SuspenseFallbackRouter />;
  }

  let hasAccess = false;
  if (role) {
    if (requires === 'viewer' && canView) hasAccess = true;
    if (requires === 'editor' && canEdit) hasAccess = true;
    if (requires === 'owner' && isOwner) hasAccess = true;
  }

  if (!hasAccess) {
    return (
      <div className="flex-1 bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface">
        <div className="max-w-md w-full bg-surface-variant/30 border border-outline-variant/30 rounded-2xl p-8 space-y-6">
          <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-sans font-bold text-on-surface">
            Access Denied
          </h1>
          <p className="text-on-surface-variant leading-relaxed">
            You don't have the necessary permissions ({requires}) to view this
            page.
          </p>
          <div className="pt-4">
            <Button
              onClick={() => window.history.back()}
              variant="default"
              className="w-full"
            >
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
