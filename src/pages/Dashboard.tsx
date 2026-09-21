import React, {useState} from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate} from 'react-router-dom';
import {Plus, Library as LibraryIcon, ShieldAlert} from 'lucide-react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useLibraries} from './dashboard/useLibraries';
import {LibraryCard} from './dashboard/LibraryCard';
import {LibrarySkeleton} from './dashboard/LibrarySkeleton';
import {CreateLibraryDialog} from './dashboard/CreateLibraryDialog';
import {LibraryFilterControls} from './dashboard/LibraryFilterControls';
import {Button} from '@/components/ui/button';
import {useAppPermissions} from '../hooks/useAppPermissions';

export default function Dashboard() {
  const {user} = useAuth();
  const {isAdmin} = useAppPermissions();
  const {
    libraries,
    isLoading,
    isSubmitting,
    createLibrary,
    scopes,
    toggleScope,
  } = useLibraries();
  const [isCreating, setIsCreating] = useState(false);

  const libraryList = Array.isArray(libraries)
    ? libraries
    : libraries &&
        typeof libraries === 'object' &&
        'libraries' in libraries &&
        Array.isArray((libraries as {libraries: unknown}).libraries)
      ? (libraries as {libraries: typeof libraries}).libraries
      : [];

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full w-full">
      {/* Main Canvas */}
      <div className="layout-page-content">
        <div className="layout-header border-none pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="layout-header-title">Libraries</h1>
            <p className="layout-header-subtitle">
              Personal archives, curated collections, and literary catalogs.
            </p>
          </div>
          {isLoading ? (
            <div className="h-[42px] w-36 bg-surface-variant/40 rounded-xl self-start sm:self-auto animate-pulse shrink-0" />
          ) : (
            <Button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 min-h-[42px] px-5 bg-primary text-on-primary font-sans font-semibold rounded-xl hover:bg-primary/90 shadow-xs self-start sm:self-auto transition-all"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Library</span>
            </Button>
          )}
        </div>

        {/* 3-State Filter Controls for User & Admin Scopes */}
        <LibraryFilterControls
          scopes={scopes}
          onToggleScope={toggleScope}
          isAdmin={isAdmin}
          totalCount={libraryList.length}
        />

        <ErrorBoundary name="Dashboard Content">
          <CreateLibraryDialog
            isOpen={isCreating}
            isSubmitting={isSubmitting}
            onClose={() => setIsCreating(false)}
            onCreate={createLibrary}
          />

          {isLoading ? (
            <LibrarySkeleton />
          ) : libraryList.length === 0 && !isCreating ? (
            <div className="text-center py-20 px-6 bg-surface-container-low rounded-2xl border border-outline-variant/30 shadow-elevation-1">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm border border-outline-variant/50">
                {scopes.includes('all') ? (
                  <ShieldAlert className="w-8 h-8 text-on-surface-variant" />
                ) : (
                  <LibraryIcon className="w-8 h-8 text-on-surface-variant" />
                )}
              </div>
              <h3 className="empty-state-title">
                {scopes.includes('all')
                  ? 'No Cataloged Libraries Found'
                  : scopes.length === 1 && scopes[0] === 'shared'
                    ? 'No Shared Libraries'
                    : scopes.length === 1 && scopes[0] === 'owned'
                      ? 'No Owned Libraries'
                      : 'No Libraries Found'}
              </h3>
              <p className="empty-state-description max-w-md mx-auto mb-6">
                {scopes.includes('all')
                  ? 'There are currently no libraries stored in the global system archive.'
                  : scopes.length === 1 && scopes[0] === 'shared'
                    ? 'No other users have granted you access to their library collections yet.'
                    : scopes.length === 1 && scopes[0] === 'owned'
                      ? 'You have not created any personal library collections yet.'
                      : 'Create your first library collection to begin archiving volumes, editions, and literary works.'}
              </p>
              {(!scopes.includes('shared') || scopes.includes('owned')) && (
                <Button
                  onClick={() => setIsCreating(true)}
                  className="mx-auto flex items-center gap-2 min-h-[44px] px-6 rounded-xl font-sans font-semibold"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Library</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-10">
              {/* Library Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {libraryList.map((lib, index) => (
                  <LibraryCard key={lib.id} lib={lib} index={index} />
                ))}
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
