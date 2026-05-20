import React, {useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {Navigate} from 'react-router-dom';
import {Plus, Library as LibraryIcon} from 'lucide-react';
import SidebarActions from '../components/SidebarActions';
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
    <>
      <SidebarActions>
        <button
          onClick={() => setIsCreating(true)}
          className="sidebar-nav-item"
        >
          <Plus className="text-on-surface-variant w-5 h-5 flex-shrink-0" />
          <span>Create Library</span>
        </button>
      </SidebarActions>
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Main Canvas */}
        <div className="layout-page-content">
          <div className="layout-header border-none pb-0">
            <div>
              <h2 className="layout-header-title">My Libraries</h2>
              <p className="layout-header-subtitle">
                Your curated collections, meticulously organized for deep focus
                and easy retrieval.
              </p>
            </div>
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
              <div className="text-center py-24 px-6 bg-surface-container-low rounded-lg border border-outline-variant/30 architectural-shadow">
                <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-outline-variant/50">
                  <LibraryIcon className="w-10 h-10 text-on-surface-variant" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3 text-primary tracking-tight">
                  The Archives are Empty
                </h3>
                <p className="text-on-surface-variant text-lg max-w-md mx-auto mb-8">
                  Establish your first collection to begin cataloging your
                  physical volumes.
                </p>
                <Button
                  onClick={() => setIsCreating(true)}
                  className="mx-auto flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Library
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {libraries.map((lib, index) => (
                  <LibraryCard key={lib.id} lib={lib} index={index} />
                ))}
              </div>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
