import React, {useState} from 'react';
import {useParams, Link} from 'react-router-dom';
import SidebarActions from '../components/SidebarActions';
import {Loader2, ArrowLeft} from 'lucide-react';
import {motion} from 'motion/react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {MetadataSection} from './spruce-up/MetadataSection';
import {ForceResyncModal} from './spruce-up/ForceResyncModal';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const {
    books,
    loading,
    duplicates,
    missingMetadata,
    processingIds,
    fixingAll,
    fixingProgress,
    activeJob,
    handleDelete,
    handleAllowDuplicateGroup,
    handleFixMetadata,
    handleFixAllMetadata,
    handleForceResyncAllMetadata,
  } = useSpruceUp(libraryId);

  const [isForceResyncModalOpen, setIsForceResyncModalOpen] = useState(false);

  return (
    <>
      <SidebarActions>
        <Link
          to={`/library/${libraryId}`}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-display text-on-surface mb-2">
          Spruce Up Library
        </h1>
        <p className="text-on-surface-variant max-w-2xl mb-8">
          Find and fix issues with your library, such as duplicate entries and
          missing metadata.
        </p>

        <ErrorBoundary name="Spruce Up View Content">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 bg-surface-container-low rounded-2xl border border-surface-variant relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] mix-blend-overlay"></div>
              <Loader2 className="w-10 h-10 animate-[spin_3s_linear_infinite] text-primary relative z-10" />
              <p className="text-on-surface-variant font-mono text-sm uppercase tracking-widest relative z-10 text-center px-4">
                Scanning volumes for anomalies...
                <br />
                <span className="text-xs opacity-60 normal-case tracking-normal font-sans">
                  Dusting off the shelves
                </span>
              </p>
            </div>
          ) : (
            <motion.div
              initial={{opacity: 0, y: 10}}
              animate={{opacity: 1, y: 0}}
              transition={{duration: 0.4}}
              className="flex flex-col gap-12"
            >
              <DuplicateSection
                duplicates={duplicates}
                processingIds={processingIds}
                handleAllowDuplicateGroup={handleAllowDuplicateGroup}
                handleDelete={handleDelete}
              />

              <MetadataSection
                missingMetadata={missingMetadata}
                fixingAll={fixingAll}
                fixingProgress={fixingProgress}
                activeJob={activeJob}
                processingIds={processingIds}
                onFixAll={handleFixAllMetadata}
                onForceResync={() => setIsForceResyncModalOpen(true)}
                onFixMetadata={handleFixMetadata}
              />
            </motion.div>
          )}
        </ErrorBoundary>
      </div>

      <ForceResyncModal
        isOpen={isForceResyncModalOpen}
        onClose={() => setIsForceResyncModalOpen(false)}
        onConfirm={handleForceResyncAllMetadata}
        bookCount={books.length}
      />
    </>
  );
}
