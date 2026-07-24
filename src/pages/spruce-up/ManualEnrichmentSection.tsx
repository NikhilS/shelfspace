import React, {useState, useMemo} from 'react';
import {Book} from '../../types';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Play, LibraryBig} from 'lucide-react';
import {MetadataKey} from '../../types/metadata';
import {useBulkEnrichment} from '../../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../../components/BulkEnrichmentBanner';
import {TableVirtuoso} from 'react-virtuoso';

interface ManualEnrichmentSectionProps {
  books: Book[];
  libraryId: string;
}

const ALL_METADATA_KEYS = [
  {id: MetadataKey.GEO, label: 'Geographic'},
  {id: MetadataKey.TEMPORAL, label: 'Temporal'},
  {id: MetadataKey.GENRE, label: 'Genre'},
  {id: MetadataKey.SYNOPSIS, label: 'Synopsis'},
  {id: MetadataKey.AUTHOR_BIO, label: 'Author Bio'},
  {id: MetadataKey.SERIES, label: 'Series'},
  {id: MetadataKey.COVER_IMAGE, label: 'Cover Image'},
];

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

    return books.filter(b => {
      // Return true if the book is MISSING the field
      const val =
        b[filterMissing as keyof Book] ||
        (b as {_inBooks?: Record<string, unknown>})._inBooks?.[filterMissing];
      if (Array.isArray(val)) return val.length === 0;
      if (typeof val === 'object' && val !== null)
        return Object.keys(val).length === 0;
      return !val; // missing or falsy
    });
  }, [books, filterMissing]);

  // Handle select all logic for currently filtered books
  const allFilteredSelected =
    filteredBooks.length > 0 &&
    filteredBooks.every(b => selectedBookIds.has(b.id));

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
                Targeted Bulk Enrichment
              </h3>
              <p className="text-sm text-on-surface-variant font-sans">
                Filter missing metadata and enrich specific records.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-on-surface-variant mr-2">
              Show Missing:
            </span>
            <select
              value={filterMissing}
              onChange={e => {
                const val = e.target.value as MetadataKey | 'all';
                setFilterMissing(val);
                // Clear selections when filter changes
                setSelectedBookIds(new Set());
                if (val !== 'all') {
                  setTargetMetadata(val as MetadataKey);
                }
              }}
              className="bg-surface text-sm border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface outline-none focus:border-primary"
            >
              <option value="all">Show All Books</option>
              {ALL_METADATA_KEYS.map(k => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
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
            <select
              value={targetMetadata}
              onChange={e => setTargetMetadata(e.target.value as MetadataKey)}
              className="bg-surface text-sm border-outline/30 rounded-lg px-3 py-1.5 text-on-surface outline-none focus:border-primary flex-1 md:min-w-[140px]"
            >
              {ALL_METADATA_KEYS.map(k => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
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

      {/* Table view */}
      <div className="overflow-x-auto min-h-[500px]">
        {filteredBooks.length === 0 ? (
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-surface-container-low text-on-surface-variant font-medium font-sans sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 border-b border-outline-variant/30 w-12">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3 border-b border-outline-variant/30">
                  Book
                </th>
                {ALL_METADATA_KEYS.map(k => (
                  <th
                    key={k.id}
                    className="px-4 py-3 border-b border-outline-variant/30 text-center whitespace-nowrap"
                  >
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-outline-variant/20">
              <tr>
                <td
                  colSpan={ALL_METADATA_KEYS.length + 2}
                  className="px-6 py-12 text-center text-on-surface-variant"
                >
                  No books found matching this filter.
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <TableVirtuoso
            data={filteredBooks}
            useWindowScroll
            className="w-full text-left border-collapse text-sm"
            components={{
              Table: ({...props}) => (
                <table
                  {...props}
                  className="w-full text-left border-collapse text-sm"
                />
              ),
              TableHead: React.forwardRef<
                HTMLTableSectionElement,
                React.HTMLAttributes<HTMLTableSectionElement>
              >((props, ref) => <thead {...props} ref={ref} />),
              TableRow: ({item, ...props}) => {
                void item;
                const isSelected = selectedBookIds.has(item.id);
                return (
                  <tr
                    {...props}
                    className={`hover:bg-surface-container-lowest/50 transition-colors bg-surface ${isSelected ? 'bg-primary/5' : ''}`}
                  />
                );
              },
              TableBody: React.forwardRef<
                HTMLTableSectionElement,
                React.HTMLAttributes<HTMLTableSectionElement>
              >((props, ref) => (
                <tbody
                  {...props}
                  ref={ref}
                  className="divide-y divide-outline-variant/20"
                />
              )),
            }}
            fixedHeaderContent={() => (
              <tr className="bg-surface-container-low text-on-surface-variant font-medium font-sans shadow-sm">
                <th className="px-4 py-3 border-b border-outline-variant/30 w-12 bg-surface-container-low">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3 border-b border-outline-variant/30 bg-surface-container-low">
                  Book
                </th>
                {ALL_METADATA_KEYS.map(k => (
                  <th
                    key={k.id}
                    className="px-4 py-3 border-b border-outline-variant/30 text-center whitespace-nowrap bg-surface-container-low"
                  >
                    {k.label}
                  </th>
                ))}
              </tr>
            )}
            itemContent={(_index, book) => {
              const isSelected = selectedBookIds.has(book.id);
              return (
                <>
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(book.id)}
                    />
                  </td>
                  <td className="px-4 py-3 min-w-[200px]">
                    <div className="font-medium text-on-surface">
                      {book.title}
                    </div>
                    <div className="text-xs text-on-surface-variant">
                      {book.author}
                    </div>
                  </td>
                  {ALL_METADATA_KEYS.map(keyDef => {
                    const k = keyDef.id;
                    const val =
                      book[k as keyof Book] ||
                      (book as {_inBooks?: Record<string, unknown>})._inBooks?.[
                        k
                      ];
                    let isPresent = false;
                    if (Array.isArray(val)) isPresent = val.length > 0;
                    else if (typeof val === 'object' && val !== null)
                      isPresent = Object.keys(val).length > 0;
                    else isPresent = !!val;

                    return (
                      <td key={k} className="px-4 py-3 text-center">
                        {isPresent ? (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500/80"
                            title="Present"
                          />
                        ) : (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full bg-error/40"
                            title="Missing"
                          />
                        )}
                      </td>
                    );
                  })}
                </>
              );
            }}
          />
        )}
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
  const {isBackfilling, progress, inFlightCount} = useBulkEnrichment({
    books,
    isBooksLoading: false,
    libraryId,
    providerKey: targetMetadata,
    metadataField: targetMetadata,
    batchSize: 50,
    filterPredicate: b => {
      if (overwrite) return true;
      const val =
        b[targetMetadata as keyof Book] ||
        (b as {_inBooks?: Record<string, unknown>})._inBooks?.[targetMetadata];
      if (Array.isArray(val)) return val.length === 0;
      if (typeof val === 'object' && val !== null)
        return Object.keys(val).length === 0;
      return !val;
    },
    successToastMessage: `Successfully enriched ${targetMetadata}`,
    errorToastMessage: `Failed to enrich ${targetMetadata}`,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-on-surface text-sm">
            Enrichment in Progress...
          </h4>
          <p className="text-xs text-on-surface-variant mt-1">
            Fetching metadata securely using Gemini extraction.
          </p>
        </div>
        {!isBackfilling && (
          <Button size="sm" variant="outline" onClick={onComplete}>
            Close
          </Button>
        )}
      </div>
      {(progress.total > 0 || isBackfilling) && (
        <BulkEnrichmentBanner
          isBackfilling={isBackfilling}
          completed={progress.completed}
          failed={progress.failed}
          total={progress.total}
          title="Curator Enrichment"
          description="Fetching deep metadata..."
          inFlightCount={inFlightCount}
        />
      )}
    </div>
  );
}
