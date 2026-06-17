import React from 'react';
import {useParams} from 'react-router-dom';
import {motion} from 'motion/react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {PageLoading} from '../components/PageLoading';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const {
    loading,
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
            <h2 className="layout-header-title text-3xl font-serif tracking-tight pr-4">
              Shelf Care
            </h2>
            <p className="layout-header-subtitle font-sans text-xs sm:text-sm text-on-surface-variant/80 mt-1 max-w-2xl leading-relaxed">
              Audit your collection's health by identifying and resolving
              duplicate entries.
            </p>
          </div>
        </div>

        <ErrorBoundary name="Spruce Up View Workspace">
          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.4, ease: 'easeOut', delay: 0.15}}
            className="flex flex-col gap-8"
          >
            {duplicates.length > 0 ? (
              <DuplicateSection
                duplicates={duplicates}
                processingIds={processingIds}
                handleAllowDuplicateGroup={handleAllowDuplicateGroup}
                handleDelete={handleDelete}
              />
            ) : (
              <div className="bg-surface-container-low p-8 rounded-2xl border border-outline-variant/30 text-center">
                <h3 className="font-serif text-xl font-bold text-primary mb-2">
                  No Duplicates Found
                </h3>
                <p className="font-sans text-sm text-on-surface-variant">
                  Your library looks clean and free of duplicates!
                </p>
              </div>
            )}
          </motion.div>
        </ErrorBoundary>
      </div>
    </>
  );
}
