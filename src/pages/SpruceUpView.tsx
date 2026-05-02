import React, {useState} from 'react';
import {useParams, Link} from 'react-router-dom';
import SidebarActions from '../components/SidebarActions';
import {ArrowLeft} from 'lucide-react';
import {motion} from 'motion/react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {MetadataSection} from './spruce-up/MetadataSection';
import {ForceResyncModal} from './spruce-up/ForceResyncModal';
import {PageLoading} from '../components/PageLoading';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const isOnline = useOnlineStatus();
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

  if (loading) {
    return (
      <PageLoading
        title="Scanning for anomalies..."
        subtitle="Analyzing duplicates and identifying missing metadata in your collection."
      />
    );
  }

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
              isOnline={isOnline}
              onFixAll={handleFixAllMetadata}
              onForceResync={() => setIsForceResyncModalOpen(true)}
              onFixMetadata={handleFixMetadata}
            />
          </motion.div>
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
