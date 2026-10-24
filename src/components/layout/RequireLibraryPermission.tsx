import React, {useEffect, useRef} from 'react';
import {useParams, useLocation, useNavigate} from 'react-router-dom';
import {useAuth} from '../../stores/authStore';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {useLibraryPermissions} from '../../hooks/useLibraryPermissions';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {AlertCircle, ArrowLeft} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookshelfBookendsIllustration} from '@/components/ui/empty-state-illustrations';
import {SuspenseFallbackRouter} from './SuspenseFallbackRouter';
import {trpc} from '../../lib/trpc';
import {preloadRouteByPathname} from '../../lib/routePreload';

interface RequireLibraryPermissionProps {
  children?: React.ReactNode;
  requires: 'owner' | 'editor' | 'viewer';
  requireAdmin?: boolean;
}

export function RequireLibraryPermission({
  children,
  requires,
  requireAdmin = false,
}: RequireLibraryPermissionProps) {
  const params = useParams<Record<string, string>>();
  const location = useLocation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const libraryId = params.id || params.libraryId;
  const {user} = useAuth();
  const {isAdmin, isLoadingPermissions} = useAppPermissions();
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
    if (!isOnline) {
      return;
    }
    const currentUtils = utilsRef.current;
    if (libraryId && user?.uid && currentUtils?.book?.list?.prefetch) {
      void currentUtils.book.list.prefetch(
        {libraryId},
        {staleTime: 1000 * 60 * 5},
      );
    }
  }, [libraryId, user?.uid, location.pathname, isOnline]);

  // When offline, block mutating editor/owner routes with a friendly read-only offline notice
  if (!isOnline && (requires === 'editor' || requires === 'owner')) {
    const returnPath = libraryId ? `/library/${libraryId}` : '/';
    return (
      <div className="flex-1 bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface min-h-[60vh]">
        <div className="max-w-md w-full bg-surface-container-low border border-outline-variant/40 rounded-2xl p-8 space-y-5 shadow-elevation-1">
          <BookshelfBookendsIllustration className="mx-auto" />
          <div className="space-y-2">
            <h1 className="font-serif text-2xl font-semibold text-on-surface">
              Available When You&apos;re Back Online
            </h1>
            <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
              Adding books and Shelf Care require an internet connection. Your
              saved shelves remain open for browsing while offline.
            </p>
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate(returnPath)}
              className="w-full gap-2 rounded-lg font-sans font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>
                {libraryId ? 'Back to Library' : 'Return to Reading Room'}
              </span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // For viewer routes, mount children immediately while library.get is in flight
  // so lazy chunks and child queries run in parallel with server-enforced RBAC.
  if (loading || (requireAdmin && isLoadingPermissions)) {
    if (requires === 'viewer' && !requireAdmin && !isError) {
      return <>{children}</>;
    }
    return <SuspenseFallbackRouter />;
  }

  let hasAccess = false;
  if (role && (!requireAdmin || isAdmin)) {
    if (requires === 'viewer' && canView) {
      hasAccess = true;
    }
    if (requires === 'editor' && canEdit) {
      hasAccess = true;
    }
    if (requires === 'owner' && isOwner) {
      hasAccess = true;
    }
  }

  if (!hasAccess) {
    if (!isOnline && !role) {
      return (
        <div className="flex-1 bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface min-h-[60vh]">
          <div className="max-w-md w-full bg-surface-container-low border border-outline-variant/40 rounded-2xl p-8 space-y-5 shadow-elevation-1">
            <BookshelfBookendsIllustration className="mx-auto" />
            <div className="space-y-2">
              <h1 className="font-serif text-2xl font-semibold text-on-surface">
                Not Available Offline Yet
              </h1>
              <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                This library hasn&apos;t been saved to your device&apos;s
                offline archive yet. Connect to the internet once to open and
                cache this shelf.
              </p>
            </div>
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigate('/')}
                className="w-full gap-2 rounded-lg font-sans font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Reading Room</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    const requiredPermissionLabel =
      requireAdmin && !isAdmin ? 'admin' : requires;

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
            You don&apos;t have the necessary permissions (
            {requiredPermissionLabel}) to view this page.
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
