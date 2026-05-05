import React, {useState} from 'react';
import {useParams} from 'react-router-dom';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';

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
      <LibrarySidebarNav libraryId={libraryId} />
      <div className="layout-page-content">
        <div className="layout-header">
          <div>
            <h2 className="layout-header-title">Spruce Up Library</h2>
            <p className="layout-header-subtitle">
              Find and fix issues with your library, such as duplicate entries
              and missing metadata.
            </p>
          </div>
        </div>

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
