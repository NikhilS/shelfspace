import React, {useState, useMemo} from 'react';
import {Book} from '../../types';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Play, LibraryBig, Square, CheckCircle2} from 'lucide-react';
import {MetadataKey} from '../../types/metadata';
import {useBulkEnrichment} from '../../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../../components/BulkEnrichmentBanner';
import {
  DataTable,
  DataTableColumn,
  DataTableCheckboxHeader,
  DataTableCheckboxCell,
  StatusDotCell,
  BookTitleCell,
} from '@/components/ui/data-table';

interface ManualEnrichmentSectionProps {
  books: Book[];
  libraryId: string;
}

const ALL_METADATA_KEYS = [
  {id: MetadataKey.GEO, label: 'Settings & Places'},
  {id: MetadataKey.TEMPORAL, label: 'Historical Eras'},
  {id: MetadataKey.GENRE, label: 'Genres'},
  {id: MetadataKey.SYNOPSIS, label: 'Summaries'},
  {id: MetadataKey.AUTHOR_BIO, label: 'Author Bios'},
  {id: MetadataKey.SERIES, label: 'Series'},
  {id: MetadataKey.COVER_IMAGE, label: 'Cover Art'},
];

function isMetadataPresent(book: Book, key: MetadataKey): boolean {
  if (key === MetadataKey.SYNOPSIS) {
    return Boolean(
      book.bookDetailsMetadata?.hasSynopsis ||
      book.enrichmentStatus?.synopsis === 'completed',
    );
  }
  if (key === MetadataKey.AUTHOR_BIO) {
    return Boolean(
      book.bookDetailsMetadata?.hasAuthorBio ||
      book.enrichmentStatus?.authorBio === 'completed',
    );
  }
  if (key === MetadataKey.EMBEDDING) {
    return Boolean(
      book.bookDetailsMetadata?.hasEmbedding ||
      book.enrichmentStatus?.embedding === 'completed',
    );
  }
  if (key === MetadataKey.GEO) {
    return Boolean(
      book.geoMetadata?.locations &&
      Array.isArray(book.geoMetadata.locations) &&
      book.geoMetadata.locations.length > 0,
    );
  }
  if (key === MetadataKey.TEMPORAL) {
    return Boolean(
      book.temporalMetadata &&
      (book.temporalMetadata.startYear !== undefined ||
        book.temporalMetadata.eraName ||
        book.temporalMetadata.rationale),
    );
  }
  if (key === MetadataKey.GENRE) {
    return Boolean(book.primaryGenre && book.primaryGenre.trim().length > 0);
  }
  if (key === MetadataKey.COVER_IMAGE) {
    return Boolean(book.coverUrl || book.coverUrlRaw);
  }
  if (key === MetadataKey.SERIES) {
    return Boolean(book.series && book.series.trim().length > 0);
  }
  const val = (book as Record<string, unknown>)[key];
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object' && val !== null)
    return Object.keys(val).length > 0;
  return Boolean(val);
}

export function ManualEnrichmentSection({
  books,
  libraryId,
}: ManualEnrichmentSectionProps) {
  const [filterMissing, setFilterMissing] = useState<MetadataKey | 'all'>(
    'all',
  );
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(
    new Set(),
  );

  const [isEnriching, setIsEnriching] = useState(false);
  const [targetMetadata, setTargetMetadata] = useState<MetadataKey>(
    MetadataKey.GEO,
  );
  const [overwrite, setOverwrite] = useState(false);

  // Filter books based on missing metadata selection
  const filteredBooks = useMemo(() => {
    if (filterMissing === 'all') return books;

    return books.filter(b => !isMetadataPresent(b, filterMissing));
  }, [books, filterMissing]);

  // Handle select all logic for currently filtered books
  const allFilteredSelected =
    filteredBooks.length > 0 &&
    filteredBooks.every(b => selectedBookIds.has(b.id));

  const someFilteredSelected =
    filteredBooks.length > 0 &&
    filteredBooks.some(b => selectedBookIds.has(b.id)) &&
    !allFilteredSelected;

  const selectAllState = allFilteredSelected
    ? true
    : someFilteredSelected
      ? 'indeterminate'
      : false;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all filtered
      const next = new Set(selectedBookIds);
      filteredBooks.forEach(b => next.delete(b.id));
      setSelectedBookIds(next);
    } else {
      // Select all filtered
      const next = new Set(selectedBookIds);
      filteredBooks.forEach(b => next.add(b.id));
      setSelectedBookIds(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedBookIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBookIds(next);
  };

  const selectedBooksCount = selectedBookIds.size;
  const showActionBar = selectedBooksCount > 0 && !isEnriching;

  const columns: DataTableColumn<Book>[] = useMemo(
    () => [
      {
        id: 'select',
        width: 48,
        headerClassName:
          'w-12 px-4 py-3 bg-surface-container-low border-b border-outline-variant/30 text-center',
        cellClassName: 'w-12 px-4 py-3 text-center',
        header: () => (
          <DataTableCheckboxHeader
            checked={selectAllState}
            onCheckedChange={toggleSelectAll}
            ariaLabel="Select all books"
          />
        ),
        cell: book => (
          <DataTableCheckboxCell
            checked={selectedBookIds.has(book.id)}
            onCheckedChange={() => toggleSelect(book.id)}
            ariaLabel={`Select ${book.title}`}
          />
        ),
      },
      {
        id: 'book',
        header: 'Book',
        headerClassName:
          'px-4 py-3 bg-surface-container-low border-b border-outline-variant/30 font-medium font-sans text-on-surface-variant w-[240px] sm:w-[280px] max-w-[320px]',
        cellClassName: 'px-4 py-3 w-[240px] sm:w-[280px] max-w-[320px]',
        wrap: true,
        maxWidth: 320,
        cell: book => (
          <BookTitleCell
            title={book.title}
            author={book.author}
            coverUrl={book.coverUrl}
            size="sm"
            maxWidth={280}
          />
        ),
      },
      ...ALL_METADATA_KEYS.map(k => ({
        id: k.id,
        header: k.label,
        align: 'center' as const,
        headerClassName:
          'px-4 py-3 border-b border-outline-variant/30 text-center whitespace-nowrap bg-surface-container-low font-medium font-sans text-on-surface-variant',
        cellClassName: 'px-4 py-3 text-center',
        cell: (book: Book) => (
          <StatusDotCell
            present={isMetadataPresent(book, k.id)}
            title={isMetadataPresent(book, k.id) ? 'Present' : 'Missing'}
          />
        ),
      })),
    ],
    [selectAllState, selectedBookIds, toggleSelectAll, toggleSelect],
  );

  return (
    <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      {/* Header and Filtering */}
      <div className="p-6 border-b border-outline-variant/30 bg-surface-container-low">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <LibraryBig className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold text-on-surface">
                Complete Book Details
              </h3>
              <p className="text-sm text-on-surface-variant font-sans">
                Review missing metadata and enrich specific volumes in your
                collection.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-on-surface-variant mr-2">
              Show Missing:
            </span>
            <Select
              value={filterMissing}
              onValueChange={val => {
                const typedVal = val as MetadataKey | 'all';
                setFilterMissing(typedVal);
                setSelectedBookIds(new Set());
                if (typedVal !== 'all') {
                  setTargetMetadata(typedVal as MetadataKey);
                }
              }}
            >
              <SelectTrigger className="bg-surface text-sm border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface h-10 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Show All Books</SelectItem>
                {ALL_METADATA_KEYS.map(k => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Floating Action Bar */}
      <div
        className={`fixed bottom-6 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-max z-50 rounded-2xl md:rounded-full bg-surface-container-highest shadow-2xl border border-outline/20 px-6 py-4 flex flex-col md:flex-row items-center gap-4 transition-all duration-300 ${
          showActionBar
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-8 pointer-events-none hidden'
        }`}
      >
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto text-on-surface">
          <span className="font-medium text-primary text-sm font-sans whitespace-nowrap">
            {selectedBooksCount} books selected
          </span>
          <div className="hidden md:block h-4 w-px bg-outline/30" />
          <div className="flex items-center justify-between gap-3 w-full md:w-auto">
            <span className="text-sm text-on-surface-variant whitespace-nowrap hidden sm:inline">
              Enrich with:
            </span>
            <Select
              value={targetMetadata}
              onValueChange={val => setTargetMetadata(val as MetadataKey)}
            >
              <SelectTrigger className="bg-surface text-sm border-outline/30 rounded-lg px-3 py-1.5 text-on-surface flex-1 md:min-w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_METADATA_KEYS.map(k => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between w-full md:w-auto md:ml-2">
            <label
              htmlFor="overwrite"
              className="text-sm text-on-surface-variant font-sans cursor-pointer select-none flex items-center gap-2"
            >
              <Checkbox
                id="overwrite"
                checked={overwrite}
                onCheckedChange={v => setOverwrite(v as boolean)}
              />
              Overwrite existing
            </label>
          </div>
        </div>
        <Button
          onClick={() => setIsEnriching(true)}
          size="sm"
          className="gap-2 w-full md:w-auto flex-shrink-0"
        >
          <Play className="w-4 h-4" /> Start
        </Button>
      </div>

      {/* In-Progress Enrichment Runner view */}
      {isEnriching && (
        <div className="p-6 bg-surface-container border-b border-outline-variant/30">
          <EnrichmentRunner
            books={books.filter(b => selectedBookIds.has(b.id))}
            libraryId={libraryId}
            targetMetadata={targetMetadata}
            overwrite={overwrite}
            onComplete={() => {
              setIsEnriching(false);
              setSelectedBookIds(new Set());
            }}
          />
        </div>
      )}

      {/* Table view - nested in a bounded scrollable container so users don't have to scroll far to reach functionality below */}
      <div className="relative border-t border-outline-variant/30 bg-surface rounded-b-xl overflow-hidden">
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
          <DataTable<Book>
            data={filteredBooks}
            columns={columns}
            keyExtractor={b => b.id}
            onRowClick={book => toggleSelect(book.id)}
            rowClassName={item =>
              `transition-colors bg-surface ${selectedBookIds.has(item.id) ? 'bg-primary/5' : 'hover:bg-surface-container-lowest/50'}`
            }
            emptyPlaceholder="No books found matching this filter."
            useWindowScroll={false}
            style={{
              height: Math.min(
                500,
                Math.max(220, filteredBooks.length * 52 + 50),
              ),
            }}
          />
        </div>
        {/* Table footer bar showing count and scroll helper */}
        <div className="px-4 py-2.5 bg-surface-container-lowest border-t border-outline-variant/20 flex items-center justify-between text-xs text-on-surface-variant select-none">
          <span className="font-medium text-on-surface">
            {filteredBooks.length}{' '}
            {filteredBooks.length === 1 ? 'book' : 'books'} shown
            {selectedBookIds.size > 0 && ` (${selectedBookIds.size} selected)`}
          </span>
          <span className="text-[11px] text-on-surface-variant/70 italic">
            Scroll inside table to browse • Headers stay pinned
          </span>
        </div>
      </div>
    </div>
  );
}

function EnrichmentRunner({
  books,
  libraryId,
  targetMetadata,
  overwrite,
  onComplete,
}: {
  books: Book[];
  libraryId: string;
  targetMetadata: MetadataKey;
  overwrite: boolean;
  onComplete: () => void;
}) {
  const {isBackfilling, progress, inFlightCount, cancelEnrichment} =
    useBulkEnrichment({
      books,
      isBooksLoading: false,
      libraryId,
      providerKey: targetMetadata,
      metadataField: targetMetadata,
      overwrite,
      filterPredicate: b => {
        if (overwrite) return true;
        return !isMetadataPresent(b, targetMetadata);
      },
      successToastMessage: `Successfully enriched ${targetMetadata}`,
      errorToastMessage: `Failed to enrich ${targetMetadata}`,
    });

  const isFinished =
    !isBackfilling &&
    progress.total > 0 &&
    progress.completed + progress.failed >= progress.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-on-surface text-sm flex items-center gap-2">
            {isBackfilling ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                Enrichment in Progress...
              </>
            ) : isFinished ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Enrichment Complete
              </>
            ) : (
              'Enrichment Stopped / Ready'
            )}
          </h4>
          <p className="text-xs text-on-surface-variant mt-1">
            {isBackfilling
              ? 'Analyzing books and extracting rich metadata with Gemini AI.'
              : `${progress.completed} of ${progress.total} enriched${progress.failed > 0 ? ` (${progress.failed} skipped/unsupported)` : ''}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isBackfilling ? (
            <Button
              size="sm"
              variant="outline"
              onClick={cancelEnrichment}
              className="text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1.5 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop Enrichment
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onComplete}>
              Close
            </Button>
          )}
        </div>
      </div>
      {(progress.total > 0 || isBackfilling) && (
        <BulkEnrichmentBanner
          isBackfilling={isBackfilling}
          completed={progress.completed}
          failed={progress.failed}
          total={progress.total}
          title="Curator Enrichment"
          description="Extracting metadata..."
          inFlightCount={inFlightCount}
          onCancel={cancelEnrichment}
          cancelLabel="Stop"
        />
      )}
    </div>
  );
}
