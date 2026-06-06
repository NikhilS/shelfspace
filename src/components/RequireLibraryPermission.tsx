import React from 'react';
import {useParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';
import {AlertCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface RequireLibraryPermissionProps {
  children?: React.ReactNode;
  requires: 'owner' | 'editor' | 'viewer';
}

export function RequireLibraryPermission({
  children,
  requires,
}: RequireLibraryPermissionProps) {
  const params = useParams<Record<string, string>>();
  const libraryId = params.id || params.libraryId;
  const {user} = useAuth();
  const {canEdit, isOwner, canView, role, loading} = useLibraryPermissions(
    libraryId,
    user?.uid,
  );

  if (loading) {
    return (
      <div className="flex-1 bg-surface py-12 px-8 sm:px-12 animate-pulse min-h-[calc(100vh-4rem)]">
        {/* Skeleton Header */}
        <div className="h-9 bg-surface-variant/40 rounded-lg w-1/3 mb-4" />
        <div className="h-4 bg-surface-variant/30 rounded w-1/2 mb-12" />

        {/* Skeleton Filter Selector */}
        <div className="flex items-center gap-4 mb-8">
          <div className="h-8 bg-surface-variant/30 rounded-md w-24" />
          <div className="h-8 bg-surface-variant/30 rounded-md w-28" />
          <div className="h-8 bg-surface-variant/30 rounded-md w-20" />
        </div>

        {/* Skeleton Book Grid Ledger Row Skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div
              key={i}
              className="bg-surface-container/50 border border-outline-variant/20 rounded-xl p-5 h-44 flex flex-col justify-between"
            >
              <div>
                <div className="h-5 bg-surface-variant/40 rounded w-3/4 mb-3" />
                <div className="h-4 bg-surface-variant/30 rounded w-1/2" />
              </div>
              <div className="flex items-center justify-between">
                <div className="h-4 bg-surface-variant/30 rounded w-1/4" />
                <div className="h-5 bg-surface-variant/30 rounded-full w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
          <h1 className="text-3xl font-serif text-on-surface">Access Denied</h1>
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
