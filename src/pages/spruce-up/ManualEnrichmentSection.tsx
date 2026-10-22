import React, {useState, useMemo, useEffect} from 'react';
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
import {
  Play,
  Square,
  CheckCircle2,
  Loader2,
  Activity,
  Sparkles,
} from 'lucide-react';
import {MetadataKey} from '../../types/metadata';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {
  useBulkEnrichment,
  BookJobTelemetry,
  ProviderTelemetrySummary,
} from '../../hooks/useBulkEnrichment';
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
  {id: MetadataKey.GEO, label: 'Settings & Places', aiOnly: true},
  {id: MetadataKey.TEMPORAL, label: 'Historical Eras', aiOnly: true},
  {id: MetadataKey.GENRE, label: 'Genres', aiOnly: true},
  {id: MetadataKey.SERIES, label: 'Series', aiOnly: false},
  {id: MetadataKey.SYNOPSIS, label: 'Summaries', aiOnly: false},
  {id: MetadataKey.AUTHOR_BIO, label: 'Author Bios', aiOnly: false},
  {id: MetadataKey.EMBEDDING, label: 'Embeddings', aiOnly: true},
  {id: MetadataKey.COVER_IMAGE, label: 'Cover Art', aiOnly: false},
];

const PURE_AI_KEYS = new Set<MetadataKey>([
  MetadataKey.GEO,
  MetadataKey.TEMPORAL,
  MetadataKey.GENRE,
  MetadataKey.EMBEDDING,
]);

function isMetadataPresent(book: Book, key: MetadataKey): boolean {
  const status = book.enrichmentStatus || {};
  if (key === MetadataKey.SYNOPSIS) {
    return Boolean(
      book.bookDetailsMetadata?.hasSynopsis ||
      status.synopsis === 'completed' ||
      status.synopsis === 'unsupported',
    );
  }
  if (key === MetadataKey.AUTHOR_BIO) {
    return Boolean(
      book.bookDetailsMetadata?.hasAuthorBio ||
      status.authorBio === 'completed' ||
      status.authorBio === 'unsupported',
    );
  }
  if (key === MetadataKey.EMBEDDING) {
    return Boolean(
      book.embedding?.length ||
      book.bookDetailsMetadata?.hasEmbedding ||
      status.embedding === 'completed' ||
      status.embedding === 'unsupported',
    );
  }
  if (key === MetadataKey.GEO) {
    return Boolean(
      book.geoMetadata?.isNonEarth ||
      (book.geoMetadata?.locations &&
        Array.isArray(book.geoMetadata.locations) &&
        book.geoMetadata.locations.length > 0) ||
      status.geo === 'completed' ||
      status.geo === 'unsupported',
    );
  }
  if (key === MetadataKey.TEMPORAL) {
    return Boolean(
      (book.temporalMetadata &&
        (book.temporalMetadata.isNonHistorical ||
          book.temporalMetadata.startYear !== undefined ||
          book.temporalMetadata.eraName ||
          book.temporalMetadata.eraLabel ||
          book.temporalMetadata.rationale)) ||
      status.temporal === 'completed' ||
      status.temporal === 'unsupported',
    );
  }
  if (key === MetadataKey.GENRE) {
    return Boolean(
      (book.primaryGenre && book.primaryGenre.trim().length > 0) ||
      status.genre === 'completed' ||
      status.genre === 'unsupported',
    );
  }
  if (key === MetadataKey.COVER_IMAGE) {
    return Boolean(
      book.coverUrl ||
      book.coverUrlRaw ||
      status.coverImage === 'completed' ||
      status.coverImage === 'unsupported',
    );
  }
  if (key === MetadataKey.SERIES) {
    return Boolean(
      (book.series && book.series.trim().length > 0) ||
      status.series === 'completed' ||
      status.series === 'unsupported',
    );
  }
  const val = (book as unknown as Record<string, unknown>)[key];
  if (Array.isArray(val)) {
    return val.length > 0;
  }
  if (typeof val === 'object' && val !== null) {
    return Object.keys(val).length > 0;
  }
  return Boolean(val);
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  open_library: 'Open Library',
  google_books: 'Google Books',
  isbn_db: 'ISBNdb',
  library_of_congress: 'Library of Congress',
  worldcat_classify: 'WorldCat',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  hardcover: 'Hardcover',
  crossref: 'Crossref',
  gemini_structured: 'Gemini AI',
  gemini_embedding: 'Gemini Embeddings',
};

function formatProviderName(rawId: string): string {
  if (PROVIDER_DISPLAY_NAMES[rawId]) {
    return PROVIDER_DISPLAY_NAMES[rawId];
  }
  return rawId
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatProviderList(ids: string[], maxVisible = 2): string {
  const formatted = ids.map(formatProviderName);
  if (formatted.length <= maxVisible) {
    return formatted.join(', ');
  }
  const visible = formatted.slice(0, maxVisible).join(', ');
  return `${visible} +${formatted.length - maxVisible} more`;
}

function renderBookLiveTelemetryBadge(state?: BookJobTelemetry) {
  if (!state) {
    return <span className="text-xs text-outline">—</span>;
  }

  const winningList = state.winningProviders
    ? Array.from(new Set(Object.values(state.winningProviders)))
    : [];
  const providerTag =
    winningList.length > 0 ? formatProviderName(winningList[0]) : null;

  switch (state.stage) {
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="w-1.5 h-1.5 rounded-full bg-outline/50" />
          Queued
        </span>
      );
    case 'fetching_catalog':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <Loader2 className="w-3 h-3 animate-spin" />
          Cataloging
        </span>
      );
    case 'fetching_ai':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <Loader2 className="w-3 h-3 animate-spin" />
          AI Enriching
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
          <span>Done</span>
          {providerTag && (
            <>
              <span aria-hidden="true" className="text-outline">
                ·
              </span>
              <span className="text-on-surface-variant font-normal">
                {providerTag}
              </span>
            </>
          )}
        </span>
      );
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="w-1.5 h-1.5 rounded-full bg-outline/40" />
          Unchanged
        </span>
      );
    case 'failed':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium text-error"
          title={state.error}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-error" />
          Failed
        </span>
      );
    default:
      return <span className="text-xs text-outline">—</span>;
  }
}

export function ManualEnrichmentSection({
  books,
  libraryId,
}: ManualEnrichmentSectionProps) {
  const {hasAiPlan} = useAppPermissions();
  const [filterMissing, setFilterMissing] = useState<MetadataKey | 'all'>(
    'all',
  );
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(
    new Set(),
  );

  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentBatchBooks, setEnrichmentBatchBooks] = useState<Book[]>([]);
  const [enrichmentEffectiveOverwrite, setEnrichmentEffectiveOverwrite] =
    useState(false);
  const [targetMetadata, setTargetMetadata] = useState<MetadataKey>(() =>
    hasAiPlan ? MetadataKey.GEO : MetadataKey.SYNOPSIS,
  );
  const [overwrite, setOverwrite] = useState(false);
  const [liveBookStates, setLiveBookStates] = useState<
    Record<string, BookJobTelemetry>
  >({});

  const isTargetBlockedByAiPlan =
    !hasAiPlan && PURE_AI_KEYS.has(targetMetadata);

  const filteredBooks = useMemo(() => {
    if (filterMissing === 'all') {
      return books;
    }
    return books.filter(b => !isMetadataPresent(b, filterMissing));
  }, [books, filterMissing]);

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
      const next = new Set(selectedBookIds);
      filteredBooks.forEach(b => next.delete(b.id));
      setSelectedBookIds(next);
    } else {
      const next = new Set(selectedBookIds);
      filteredBooks.forEach(b => next.add(b.id));
      setSelectedBookIds(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedBookIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedBookIds(next);
  };

  const handleStartEnrichment = () => {
    if (isTargetBlockedByAiPlan) {
      return;
    }
    const selected = books.filter(b => selectedBookIds.has(b.id));
    if (selected.length === 0) {
      return;
    }

    const missingInSelection = selected.filter(
      b => !isMetadataPresent(b, targetMetadata),
    );
    const shouldOverwriteAll = overwrite || missingInSelection.length === 0;
    const batchToRun = shouldOverwriteAll ? selected : missingInSelection;

    setEnrichmentBatchBooks(batchToRun);
    setEnrichmentEffectiveOverwrite(shouldOverwriteAll);
    setIsEnriching(true);
  };

  const handleRunnerComplete = React.useCallback(() => {
    setIsEnriching(false);
    setSelectedBookIds(new Set());
  }, []);

  const selectedBooksCount = selectedBookIds.size;
  const showActionBar = selectedBooksCount > 0 && !isEnriching;
  const hasAnyLiveBookState = Object.keys(liveBookStates).length > 0;

  const columns: Array<DataTableColumn<Book>> = useMemo(
    () => [
      {
        id: 'select',
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        headerClassName:
          'w-[48px] px-3 py-3 bg-surface-container-low border-b border-outline-variant/30 text-center',
        cellClassName: 'w-[48px] px-3 py-3 text-center',
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
        width: 280,
        minWidth: 280,
        maxWidth: 280,
        headerClassName:
          'w-[280px] px-4 py-3 bg-surface-container-low border-b border-outline-variant/30 font-medium font-sans text-on-surface-variant',
        cellClassName: 'w-[280px] px-4 py-3 overflow-hidden',
        wrap: true,
        cell: book => (
          <BookTitleCell
            title={book.title}
            author={book.author}
            coverUrl={book.coverUrl}
            size="sm"
            maxWidth={248}
          />
        ),
      },
      ...(hasAnyLiveBookState || isEnriching
        ? [
            {
              id: 'liveStatus',
              header: (
                <span className="block text-center leading-tight whitespace-normal">
                  Status & Source
                </span>
              ),
              width: 148,
              minWidth: 148,
              maxWidth: 148,
              align: 'center' as const,
              headerClassName:
                'w-[148px] h-auto px-2.5 py-2.5 border-b border-outline-variant/30 text-center whitespace-normal break-words leading-tight bg-surface-container-low font-medium font-sans text-primary align-middle',
              cellClassName:
                'w-[148px] px-2.5 py-3 text-center whitespace-nowrap overflow-hidden text-ellipsis',
              cell: (book: Book) =>
                renderBookLiveTelemetryBadge(liveBookStates[book.id]),
            },
          ]
        : []),
      ...ALL_METADATA_KEYS.map(k => ({
        id: k.id,
        header: (
          <span className="block text-center leading-tight whitespace-normal">
            {k.label}
          </span>
        ),
        width: 104,
        minWidth: 104,
        maxWidth: 104,
        align: 'center' as const,
        headerClassName:
          'w-[104px] h-auto px-2 py-2.5 border-b border-outline-variant/30 text-center whitespace-normal break-words leading-tight bg-surface-container-low font-medium font-sans text-on-surface-variant align-middle',
        cellClassName: 'w-[104px] px-2 py-3 text-center',
        cell: (book: Book) => (
          <StatusDotCell
            present={isMetadataPresent(book, k.id)}
            title={isMetadataPresent(book, k.id) ? 'Present' : 'Missing'}
          />
        ),
      })),
    ],
    [
      selectAllState,
      selectedBookIds,
      toggleSelectAll,
      toggleSelect,
      hasAnyLiveBookState,
      isEnriching,
      liveBookStates,
    ],
  );

  return (
    <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      {/* Header and Filtering */}
      <div className="p-6 border-b border-outline-variant/30 bg-surface-container-low">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-serif text-xl font-semibold text-on-surface">
              Complete Book Details
            </h3>
            <p className="text-sm text-on-surface-variant font-sans mt-0.5">
              See which books are missing covers, summaries, or settings, and
              fill them in with one click.
            </p>
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
                    {!hasAiPlan && k.aiOnly ? ' (Requires AI Plan)' : ''}
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
        {isTargetBlockedByAiPlan ? (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans font-medium bg-surface-container text-on-surface-variant border border-outline-variant/50 whitespace-nowrap"
            title="Requires AI Plan (Admin-enabled)"
          >
            <Sparkles className="w-3.5 h-3.5 text-on-surface-variant/70" />
            Requires AI Plan (Admin-enabled)
          </span>
        ) : (
          <Button
            onClick={handleStartEnrichment}
            size="sm"
            className="gap-2 w-full md:w-auto flex-shrink-0"
          >
            <Play className="w-4 h-4" /> Start
          </Button>
        )}
      </div>

      {/* In-Progress Enrichment Runner view */}
      {isEnriching && (
        <div className="px-6 py-4 bg-surface-container border-b border-outline-variant/30">
          <EnrichmentRunner
            books={enrichmentBatchBooks}
            libraryId={libraryId}
            targetMetadata={targetMetadata}
            overwrite={enrichmentEffectiveOverwrite}
            onBookStatesChange={setLiveBookStates}
            onComplete={handleRunnerComplete}
          />
        </div>
      )}

      {/* Table view */}
      <div className="relative border-t border-outline-variant/30 bg-surface rounded-b-xl overflow-hidden">
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
          <DataTable<Book>
            data={filteredBooks}
            columns={columns}
            keyExtractor={b => b.id}
            onRowClick={book => toggleSelect(book.id)}
            tableClassName="table-fixed w-full min-w-[1160px]"
            rowClassName={item =>
              `transition-colors bg-surface ${selectedBookIds.has(item.id) ? 'bg-primary/5' : 'hover:bg-surface-container-lowest/50'}`
            }
            emptyPlaceholder={
              books.length === 0
                ? 'No books in this library yet.'
                : 'All caught up—every book has this detail filled in.'
            }
            useWindowScroll={false}
            style={{
              height: Math.min(
                500,
                Math.max(220, filteredBooks.length * 52 + 50),
              ),
            }}
          />
        </div>
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
  onBookStatesChange,
  onComplete,
}: {
  books: Book[];
  libraryId: string;
  targetMetadata: MetadataKey;
  overwrite: boolean;
  onBookStatesChange: (states: Record<string, BookJobTelemetry>) => void;
  onComplete: () => void;
}) {
  const metadataLabel =
    ALL_METADATA_KEYS.find(k => k.id === targetMetadata)?.label ||
    targetMetadata;

  const alwaysIncludeSelected = React.useCallback(() => true, []);

  const {
    isBackfilling,
    progress,
    inFlightCount,
    cancelEnrichment,
    perBookStates,
    providerTelemetry,
  } = useBulkEnrichment({
    books,
    isBooksLoading: false,
    libraryId,
    providerKey: targetMetadata,
    metadataField: targetMetadata,
    overwrite,
    ignoreUnsupportedStatus: true,
    filterPredicate: alwaysIncludeSelected,
    successToastMessage: `Finished enriching ${metadataLabel}`,
    errorToastMessage: `Failed to enrich ${metadataLabel}`,
  });

  useEffect(() => {
    onBookStatesChange(perBookStates);
  }, [perBookStates, onBookStatesChange]);

  const totalCount = progress.total || books.length;
  const processedCount = progress.completed + progress.failed;
  const percentage =
    totalCount > 0 ? Math.min(100, (processedCount / totalCount) * 100) : 0;

  const isFinished =
    !isBackfilling && totalCount > 0 && processedCount >= totalCount;

  return (
    <div className="flex flex-col gap-3">
      {/* Top row: status title, compact progress count, and single action button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h4 className="font-semibold text-on-surface text-sm flex items-center gap-2">
            {isBackfilling ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Enriching {metadataLabel}
              </>
            ) : isFinished ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Enrichment Complete
              </>
            ) : (
              'Enrichment Paused'
            )}
          </h4>
          <span aria-hidden="true" className="text-outline-variant">
            ·
          </span>
          <span className="text-xs text-on-surface-variant font-mono">
            {progress.completed} enriched
            {progress.failed > 0
              ? `, ${progress.failed} unchanged`
              : ''} of {totalCount} {totalCount === 1 ? 'book' : 'books'}
          </span>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {isBackfilling ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void cancelEnrichment()}
              className="h-7 px-2.5 text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1.5 cursor-pointer"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onComplete}
              className="h-7 px-3 text-xs"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {/* Unified progress bar */}
      <div className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
        <div
          className="h-1.5 rounded-full bg-primary transition-all duration-300"
          style={{width: `${percentage}%`}}
        />
      </div>

      {/* Quiet, informative provider telemetry footer */}
      {providerTelemetry && (
        <ProviderTelemetryStrip
          telemetry={providerTelemetry}
          fallbackInFlight={inFlightCount}
        />
      )}
    </div>
  );
}

function ProviderTelemetryStrip({
  telemetry,
  fallbackInFlight = 0,
}: {
  telemetry: ProviderTelemetrySummary;
  fallbackInFlight?: number;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const inFlight =
    telemetry.totalInFlight ??
    (telemetry as {totalActiveRequests?: number}).totalActiveRequests ??
    fallbackInFlight;
  const maxSlots = telemetry.maxGlobalConcurrent ?? 24;

  const readyCount = telemetry.activeProviders.length;
  const delayedCount = telemetry.delayedProviders.length;
  const cooldownCount = telemetry.cooldownProviders.length;
  const allHealthy = delayedCount === 0 && cooldownCount === 0;

  return (
    <div
      className="flex flex-col gap-2 text-xs text-on-surface-variant"
      data-testid="provider-telemetry-strip"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-on-surface font-medium">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span>
              {inFlight > 0
                ? `${inFlight} of ${maxSlots} active requests`
                : `Idle (${maxSlots} slots available)`}
            </span>
          </span>

          <span aria-hidden="true" className="text-outline-variant">
            ·
          </span>

          {allHealthy ? (
            <span>
              {readyCount > 0
                ? `All ${readyCount} catalog & AI sources ready`
                : 'Catalog & AI sources ready'}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {readyCount > 0 && <span>{readyCount} ready</span>}
              {delayedCount > 0 && (
                <>
                  {readyCount > 0 && (
                    <span aria-hidden="true" className="text-outline-variant">
                      ·
                    </span>
                  )}
                  <span className="text-amber-700 dark:text-amber-300">
                    Paced: {formatProviderList(telemetry.delayedProviders)}
                  </span>
                </>
              )}
              {cooldownCount > 0 && (
                <>
                  {(readyCount > 0 || delayedCount > 0) && (
                    <span aria-hidden="true" className="text-outline-variant">
                      ·
                    </span>
                  )}
                  <span className="text-error">
                    Rate-limited:{' '}
                    {telemetry.cooldownProviders
                      .slice(0, 2)
                      .map(c => {
                        const ms =
                          c.cooldownRemainingMs ??
                          (c as {remainingMs?: number}).remainingMs ??
                          0;
                        return `${formatProviderName(c.providerId)} (${Math.ceil(ms / 1000)}s)`;
                      })
                      .join(', ')}
                    {cooldownCount > 2 ? ` +${cooldownCount - 2} more` : ''}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {(readyCount > 0 || delayedCount > 0 || cooldownCount > 0) && (
          <button
            type="button"
            onClick={() => setShowDetails(prev => !prev)}
            className="text-xs text-primary hover:underline font-medium cursor-pointer select-none"
          >
            {showDetails ? 'Hide sources' : 'View sources'}
          </button>
        )}
      </div>

      {showDetails && (
        <div className="pt-2 border-t border-outline-variant/20 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px]">
          {telemetry.activeProviders.map(id => (
            <div key={id} className="flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
              <span className="text-on-surface truncate">
                {formatProviderName(id)}
              </span>
            </div>
          ))}
          {telemetry.delayedProviders.map(id => (
            <div key={id} className="flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-300 truncate">
                {formatProviderName(id)} (paced)
              </span>
            </div>
          ))}
          {telemetry.cooldownProviders.map(c => {
            const ms =
              c.cooldownRemainingMs ??
              (c as {remainingMs?: number}).remainingMs ??
              0;
            return (
              <div
                key={c.providerId}
                className="flex items-center gap-1.5 truncate"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
                <span className="text-error truncate">
                  {formatProviderName(c.providerId)} ({Math.ceil(ms / 1000)}s)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
