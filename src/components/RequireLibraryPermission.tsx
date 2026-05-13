import React from 'react';
import {useParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';
import {AlertCircle, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface RequireLibraryPermissionProps {
  children?: React.ReactNode;
  requires: 'owner' | 'editor' | 'viewer';
}

export function RequireLibraryPermission({
  children,
  requires,
}: RequireLibraryPermissionProps) {
  const {id} = useParams<{id: string}>();
  const {user} = useAuth();
  const {canEdit, isOwner, canView, role, loading} = useLibraryPermissions(
    id,
    user?.uid,
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-tertiary" />
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
