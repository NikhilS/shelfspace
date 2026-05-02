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
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <Plus className="text-on-surface-variant w-5 h-5 flex-shrink-0" />
          <span>Create Library</span>
        </button>
      </SidebarActions>
      <div className="flex-grow flex flex-col min-h-screen w-full">
        {/* Main Canvas */}
        <main className="flex-grow p-4 sm:p-8 lg:p-12 max-w-[1200px] mx-auto w-full">
          <div className="mb-8 flex flex-col gap-4">
            <div>
              <h2 className="font-headline-xl text-headline-xl text-primary-container mb-4">
                My Libraries
              </h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
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
                <button
                  onClick={() => setIsCreating(true)}
                  className="bg-primary text-on-primary px-6 py-3 rounded-md font-body-md hover:bg-primary/90 transition-all architectural-shadow flex items-center gap-2 mx-auto"
                >
                  <Plus className="w-4 h-4" />
                  Create Library
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {libraries.map((lib, index) => (
                  <LibraryCard key={lib.id} lib={lib} index={index} />
                ))}
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}
