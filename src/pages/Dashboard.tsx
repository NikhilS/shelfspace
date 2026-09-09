import React, {useState} from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate} from 'react-router-dom';
import {Plus, Library as LibraryIcon} from 'lucide-react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useLibraries} from './dashboard/useLibraries';
import {LibraryCard} from './dashboard/LibraryCard';
import {LibrarySkeleton} from './dashboard/LibrarySkeleton';
import {CreateLibraryDialog} from './dashboard/CreateLibraryDialog';
import {Button} from '@/components/ui/button';

export default function Dashboard() {
  const {user} = useAuth();
  const {libraries, isLoading, isSubmitting, createLibrary} = useLibraries();
  const [isCreating, setIsCreating] = useState(false);

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full w-full">
      {/* Main Canvas */}
      <div className="layout-page-content">
        <div className="layout-header border-none pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="layout-header-title">My Libraries</h1>
            <p className="layout-header-subtitle">
              Personal archives, curated collections, and literary catalogs.
            </p>
          </div>
          {libraries.length > 0 && (
            <Button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 min-h-[42px] px-5 bg-primary text-on-primary font-sans font-semibold rounded-xl hover:bg-primary/90 shadow-xs self-start sm:self-auto transition-all"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Library</span>
            </Button>
          )}
        </div>

        <ErrorBoundary name="Dashboard Content">
          <CreateLibraryDialog
            isOpen={isCreating}
            isSubmitting={isSubmitting}
            onClose={() => setIsCreating(false)}
            onCreate={createLibrary}
          />

          {isLoading ? (
            <LibrarySkeleton />
          ) : libraries.length === 0 && !isCreating ? (
            <div className="text-center py-24 px-6 bg-surface-container-low rounded-2xl border border-outline-variant/30 shadow-elevation-1">
              <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-outline-variant/50">
                <LibraryIcon className="w-10 h-10 text-on-surface-variant" />
              </div>
              <h3 className="empty-state-title">No Libraries Cataloged</h3>
              <p className="empty-state-description">
                Create your first library collection to begin archiving volumes,
                editions, and literary works.
              </p>
              <Button
                onClick={() => setIsCreating(true)}
                className="mx-auto flex items-center gap-2 min-h-[44px] px-6 rounded-xl font-sans font-semibold"
              >
                <Plus className="w-4 h-4" />
                <span>Create Library</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-10">
              {/* Library Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {libraries.map((lib, index) => (
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
