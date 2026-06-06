import React from 'react';
import {useParams} from 'react-router-dom';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {motion} from 'motion/react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {LibraryIntegrityTable} from './spruce-up/LibraryIntegrityTable';
import {SpruceUpActionBar} from './spruce-up/SpruceUpActionBar';
import {SpruceUpOperationsDirectory} from './spruce-up/SpruceUpOperationsDirectory';
import {PageLoading} from '../components/PageLoading';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const isOnline = useOnlineStatus();
  const {
    booksWithDetails,
    loading,
    duplicates,
    processingIds,
    fixingAll,
    fixingProgress,
    selectedIds,
    filter,
    setFilter,
    toggleSelect,
    toggleSelectAll,
    handleDelete,
    handleAllowDuplicateGroup,
    handleBulkFixMetadata,
    handleBulkForceResync,
    handleBulkFixGenreAPI,
    handleBulkForceGenreAPI,
    handleBulkFixGenreAI,
    handleBulkForceGenreAI,
    emptyCoverUrls,
  } = useSpruceUp(libraryId);

  if (loading) {
    return (
      <PageLoading
        title="Scanning for anomalies..."
        subtitle="Analyzing duplicates and identifying missing metadata in your collection."
      />
    );
  }

  const filteredBooks = booksWithDetails.filter(b => {
    const isMissingGenre = !b.genres || b.genres.length === 0;
    const isMissingMetadata =
      !b.synopsis ||
      !b.publishedDate ||
      !b.coverUrl ||
      emptyCoverUrls.has(b.coverUrl);
    const isLowResCover = b.coverUrl && b.coverUrl.includes('zoom=1');
    const isMissingCover = !b.coverUrl || emptyCoverUrls.has(b.coverUrl);

    if (filter === 'missing_metadata')
      return isMissingMetadata || isMissingGenre;
    if (filter === 'missing_genre') return isMissingGenre;
    if (filter === 'low_res_cover') return isLowResCover;
    if (filter === 'missing_cover') return isMissingCover;
    return true;
  });

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />
      <div className="layout-page-content">
        <SpruceUpActionBar
          selectedCount={selectedIds.size}
          totalSelected={filteredBooks.length}
          isOnline={isOnline}
          isProcessing={fixingAll}
          progress={fixingProgress}
          onFixMetadata={handleBulkFixMetadata}
          onForceResyncAll={handleBulkForceResync}
          onFixGenreAPI={handleBulkFixGenreAPI}
          onForceGenreAPI={handleBulkForceGenreAPI}
          onFixGenreAI={handleBulkFixGenreAI}
          onForceGenreAI={handleBulkForceGenreAI}
        />

        <div className="layout-header">
          <div>
            <h2 className="layout-header-title">Spruce Up Library</h2>
            <p className="layout-header-subtitle">
              Manage library integrity, fix missing metadata, and enrich your
              collection with AI-categorized BISAC genres.
            </p>
          </div>
        </div>

        <ErrorBoundary name="Spruce Up View Content">
          <motion.div
            initial={{opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.4}}
            className="flex flex-col gap-10"
          >
            <SpruceUpOperationsDirectory
              books={booksWithDetails}
              duplicateGroupsCount={duplicates.length}
              selectedCount={selectedIds.size}
              isOnline={isOnline}
              isProcessing={fixingAll}
              progress={fixingProgress}
              onFixMetadata={handleBulkFixMetadata}
              onForceResyncAll={handleBulkForceResync}
              onFixGenreAPI={handleBulkFixGenreAPI}
              onForceGenreAPI={handleBulkForceGenreAPI}
              onFixGenreAI={handleBulkFixGenreAI}
              onForceGenreAI={handleBulkForceGenreAI}
              emptyCoverUrls={emptyCoverUrls}
            />

            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold text-on-surface">
                    Library Integrity
                  </h3>
                  <div className="flex items-center bg-surface-container rounded-lg p-1 border border-outline-variant/30">
                    <button
                      onClick={() => setFilter('missing_metadata')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'missing_metadata' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                    >
                      Missing Metadata
                    </button>
                    <button
                      onClick={() => setFilter('missing_genre')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'missing_genre' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                    >
                      Missing Genre
                    </button>
                    <button
                      onClick={() => setFilter('missing_cover')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'missing_cover' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                    >
                      No Cover
                    </button>
                    <button
                      onClick={() => setFilter('all')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'all' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                    >
                      Show All
                    </button>
                  </div>
                </div>
              </div>

              <LibraryIntegrityTable
                books={booksWithDetails}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={() => toggleSelectAll(filteredBooks)}
                filter={filter}
                emptyCoverUrls={emptyCoverUrls}
              />
            </section>

            <DuplicateSection
              duplicates={duplicates}
              processingIds={processingIds}
              handleAllowDuplicateGroup={handleAllowDuplicateGroup}
              handleDelete={handleDelete}
            />
          </motion.div>
        </ErrorBoundary>
      </div>
    </>
  );
}
