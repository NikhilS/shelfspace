import React from 'react';
import {useParams} from 'react-router-dom';
import {motion} from 'motion/react';
import {WifiOff} from 'lucide-react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {ManualEnrichmentSection} from './spruce-up/ManualEnrichmentSection';
import {ResetMetadataSection} from './spruce-up/ResetMetadataSection';
import {PageLoading} from '../components/PageLoading';
import {BackToLibrary} from '../components/BackToLibrary';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const isOnline = useOnlineStatus();
  const {
    loading,
    books,
    duplicates,
    processingIds,
    handleDelete,
    handleAllowDuplicateGroup,
  } = useSpruceUp(libraryId);

  if (loading) {
    return (
      <PageLoading
        title="Scanning for anomalies..."
        subtitle="Analyzing duplicates in your collection."
      />
    );
  }

  return (
    <>
      <div className="layout-page-content pb-24 lg:pb-8">
        <div className="layout-header mb-6">
          <div>
            <BackToLibrary libraryId={libraryId} className="mb-2" />
            <h1 className="layout-header-title">Shelf Care</h1>
            <p className="layout-header-subtitle">
              Audit your collection's health by identifying and resolving
              duplicate entries and backfilling missing record metadata.
            </p>
          </div>
        </div>

        {!isOnline && (
          <div
            role="status"
            className="mb-8 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-3 rounded-xl flex items-center gap-3 text-xs font-medium"
            data-testid="spruce-up-offline-notice"
          >
            <WifiOff className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <span>
              Working offline. Duplicate pruning and metadata enrichment require
              an active network connection.
            </span>
          </div>
        )}

        <ErrorBoundary name="Spruce Up View Workspace">
          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.4, ease: 'easeOut', delay: 0.15}}
            className="flex flex-col gap-12"
          >
            <section>
              {duplicates.length > 0 ? (
                <DuplicateSection
                  duplicates={duplicates}
                  processingIds={processingIds}
                  handleAllowDuplicateGroup={handleAllowDuplicateGroup}
                  handleDelete={handleDelete}
                />
              ) : (
                <div className="bg-surface-container-low p-8 rounded-2xl border border-outline-variant/30 text-center">
                  <h3 className="font-sans text-xl font-bold text-primary mb-2">
                    No Duplicates Found
                  </h3>
                  <p className="font-sans text-sm text-on-surface-variant">
                    Your library looks clean and free of duplicates!
                  </p>
                </div>
              )}
            </section>

            <section>
              <ManualEnrichmentSection
                books={books || []}
                libraryId={libraryId!}
              />
            </section>

            <section>
              <ResetMetadataSection
                libraryId={libraryId!}
                books={books || []}
              />
            </section>
          </motion.div>
        </ErrorBoundary>
      </div>
    </>
  );
}
