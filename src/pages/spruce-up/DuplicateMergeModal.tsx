import React, {useState, useEffect, useMemo} from 'react';
import {Book, BookDetails} from '../../types';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {GitMerge, Check, ShieldCheck, Loader2} from 'lucide-react';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import {trpcVanilla} from '../../lib/trpc';

export interface DuplicateMergePayload {
  survivorBookId: string;
  duplicateBookIds: string[];
  mergedFields: {
    title?: string;
    author?: string;
    isbn?: string;
    coverUrl?: string;
    publishedDate?: string;
    pageCount?: number;
    primaryGenre?: string;
    subgenres?: string[];
    series?: string;
    format?: 'physical' | 'ebook' | 'audiobook';
  };
  mergedHeavyFields?: {
    synopsis?: string;
    authorBio?: string;
  };
}

interface DuplicateMergeModalProps {
  libraryId: string;
  group: Book[] | null;
  open: boolean;
  onClose: () => void;
  onConfirmMerge: (payload: DuplicateMergePayload) => Promise<void>;
}

type MergeableFieldKey =
  | 'title'
  | 'author'
  | 'isbn'
  | 'coverUrl'
  | 'series'
  | 'primaryGenre'
  | 'publishedDate'
  | 'pageCount'
  | 'format'
  | 'synopsis'
  | 'authorBio';

const FIELD_DEFINITIONS: Array<{
  key: MergeableFieldKey;
  label: string;
  isHeavy?: boolean;
}> = [
  {key: 'title', label: 'Title'},
  {key: 'author', label: 'Author'},
  {key: 'isbn', label: 'ISBN'},
  {key: 'coverUrl', label: 'Cover Art'},
  {key: 'series', label: 'Series'},
  {key: 'primaryGenre', label: 'Genre & Subgenres'},
  {key: 'publishedDate', label: 'Published Date'},
  {key: 'pageCount', label: 'Page Count'},
  {key: 'format', label: 'Format'},
  {key: 'synopsis', label: 'Synopsis', isHeavy: true},
  {key: 'authorBio', label: 'Author Bio', isHeavy: true},
];

export function DuplicateMergeModal({
  libraryId,
  group,
  open,
  onClose,
  onConfirmMerge,
}: DuplicateMergeModalProps) {
  const [survivorId, setSurvivorId] = useState<string>('');
  const [heavyDetails, setHeavyDetails] = useState<
    Record<string, Partial<BookDetails>>
  >({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map from fieldKey -> bookId whose value is selected
  const [selectedSourceByField, setSelectedSourceByField] = useState<
    Record<MergeableFieldKey, string>
  >({} as Record<MergeableFieldKey, string>);

  const books = useMemo(() => group || [], [group]);

  useEffect(() => {
    if (!open || books.length === 0) {
      return;
    }

    const defaultSurvivor = books[0].id;
    setSurvivorId(defaultSurvivor);

    let cancelled = false;
    setLoadingDetails(true);

    void (async () => {
      let loadedDetails: Record<string, Partial<BookDetails>> = {};
      try {
        if (
          libraryId &&
          trpcVanilla.book?.getBookDetailsChunk?.mutate &&
          books.length > 0
        ) {
          const res = await trpcVanilla.book.getBookDetailsChunk.mutate({
            libraryId,
            bookIds: books.map(b => b.id),
          });
          if (res?.details) {
            loadedDetails = res.details;
          }
        }
      } catch {
        // Ignore if details chunk unavailable in tests
      }

      if (cancelled) {
        return;
      }
      setHeavyDetails(loadedDetails);
      setLoadingDetails(false);

      // Pick best non-empty source book for each field
      const initialSelection = {} as Record<MergeableFieldKey, string>;
      for (const field of FIELD_DEFINITIONS) {
        let bestBookId = defaultSurvivor;
        for (const b of books) {
          const val = getFieldValue(b, loadedDetails[b.id], field.key);
          if (hasMeaningfulValue(val)) {
            bestBookId = b.id;
            break;
          }
        }
        initialSelection[field.key] = bestBookId;
      }
      setSelectedSourceByField(initialSelection);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, books, libraryId]);

  if (!group || group.length < 2) {
    return null;
  }

  const handleConfirm = async () => {
    if (!survivorId) {
      return;
    }
    setIsSubmitting(true);
    try {
      const bookById = new Map(books.map(b => [b.id, b]));
      const pickBook = (field: MergeableFieldKey): Book =>
        bookById.get(selectedSourceByField[field]) ||
        bookById.get(survivorId) ||
        books[0];

      const genreSource = pickBook('primaryGenre');
      const synopsisSourceId = selectedSourceByField.synopsis || survivorId;
      const bioSourceId = selectedSourceByField.authorBio || survivorId;

      const synopsisVal =
        heavyDetails[synopsisSourceId]?.synopsis ??
        (bookById.get(synopsisSourceId) as Book & {synopsis?: string})
          ?.synopsis;
      const authorBioVal =
        heavyDetails[bioSourceId]?.authorBio ??
        (bookById.get(bioSourceId) as Book & {authorBio?: string})?.authorBio;

      const payload: DuplicateMergePayload = {
        survivorBookId: survivorId,
        duplicateBookIds: books.map(b => b.id).filter(id => id !== survivorId),
        mergedFields: {
          title: pickBook('title').title,
          author: pickBook('author').author,
          isbn: pickBook('isbn').isbn || undefined,
          coverUrl: pickBook('coverUrl').coverUrl || undefined,
          series: pickBook('series').series || undefined,
          primaryGenre: genreSource.primaryGenre || undefined,
          subgenres: genreSource.subgenres || undefined,
          publishedDate: pickBook('publishedDate').publishedDate || undefined,
          pageCount: pickBook('pageCount').pageCount || undefined,
          format:
            (pickBook('format').format as
              'physical' | 'ebook' | 'audiobook' | undefined) || 'physical',
        },
        mergedHeavyFields: {
          ...(synopsisVal ? {synopsis: synopsisVal} : {}),
          ...(authorBioVal ? {authorBio: authorBioVal} : {}),
        },
      };

      await onConfirmMerge(payload);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={val => !val && onClose()}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col bg-surface text-on-surface border-outline-variant/40 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-outline-variant/30 bg-surface-container-low">
          <div>
            <DialogTitle className="font-serif text-xl font-semibold text-on-surface">
              Merge Duplicate Books
            </DialogTitle>
            <DialogDescription className="text-xs text-on-surface-variant mt-0.5">
              Choose which copy to keep and click any detail below to combine
              the best information into a single book.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Automatic preservation banner */}
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3 flex items-start gap-3 text-xs text-emerald-950 dark:text-emerald-200">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                Reading progress &amp; reviews are kept automatically:
              </span>{' '}
              We&apos;ll keep your furthest reading status (Read &gt; Currently
              Reading &gt; Abandoned &gt; Want to Read) and move all reviews to
              the book you keep.
            </div>
          </div>

          {/* Survivor Record Selector */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-2.5">
              1. Choose Which Copy to Keep
            </div>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${Math.min(books.length, 3)}, minmax(0, 1fr))`,
              }}
            >
              {books.map((book, idx) => {
                const isSurvivor = book.id === survivorId;
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => setSurvivorId(book.id)}
                    data-testid={`select-survivor-${book.id}`}
                    className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                      isSurvivor
                        ? 'border-primary bg-primary/8 ring-1 ring-primary'
                        : 'border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="w-10 h-14 rounded bg-surface-container flex items-center justify-center overflow-hidden shrink-0 border border-outline-variant/20">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <MonographCoverFallback
                          title={book.title}
                          author={book.author}
                          variant="micro"
                          className="w-full h-full border-0"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                          Record #{idx + 1}
                        </span>
                        {isSurvivor && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-primary text-on-primary px-2 py-0.5 rounded">
                            <Check className="w-3 h-3" /> Keep ID
                          </span>
                        )}
                      </div>
                      <div className="font-semibold text-sm text-on-surface truncate mt-0.5">
                        {book.title}
                      </div>
                      <div className="text-xs text-on-surface-variant truncate">
                        {book.author}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Field-by-field comparison grid */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                2. Choose Best Value Per Field
              </span>
              {loadingDetails && (
                <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading synopses & bios...
                </span>
              )}
            </div>

            <div className="border border-outline-variant/30 rounded-xl overflow-hidden divide-y divide-outline-variant/20">
              {FIELD_DEFINITIONS.map(field => {
                const selectedBookId =
                  selectedSourceByField[field.key] || survivorId;
                return (
                  <div
                    key={field.key}
                    className="grid grid-cols-1 md:grid-cols-[150px_1fr] bg-surface"
                  >
                    <div className="px-3.5 py-3 bg-surface-container-low text-xs font-semibold text-on-surface-variant flex items-center border-b md:border-b-0 md:border-r border-outline-variant/20">
                      {field.label}
                    </div>
                    <div
                      className="grid gap-2 p-2.5"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min(books.length, 3)}, minmax(0, 1fr))`,
                      }}
                    >
                      {books.map(book => {
                        const rawVal = getFieldValue(
                          book,
                          heavyDetails[book.id],
                          field.key,
                        );
                        const isSelected = selectedBookId === book.id;
                        const hasVal = hasMeaningfulValue(rawVal);

                        return (
                          <button
                            key={book.id}
                            type="button"
                            onClick={() =>
                              setSelectedSourceByField(prev => ({
                                ...prev,
                                [field.key]: book.id,
                              }))
                            }
                            data-testid={`merge-pick-${field.key}-${book.id}`}
                            className={`text-left p-2.5 rounded-lg border text-xs transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-on-surface font-medium shadow-xs'
                                : 'border-outline-variant/30 bg-surface-container-lowest text-on-surface-variant hover:border-outline-variant'
                            }`}
                          >
                            <div className="w-full break-words line-clamp-3">
                              {field.key === 'coverUrl' &&
                              typeof rawVal === 'string' &&
                              rawVal ? (
                                <div className="flex items-center gap-2">
                                  <img
                                    src={rawVal}
                                    alt="Cover preview"
                                    className="w-8 h-11 object-cover rounded border border-outline-variant/30"
                                  />
                                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                    Has Cover Image
                                  </span>
                                </div>
                              ) : hasVal ? (
                                <span>{formatFieldDisplay(rawVal, book)}</span>
                              ) : (
                                <span className="italic text-outline">
                                  Empty
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-end">
                              {isSelected && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-primary font-semibold">
                                  <Check className="w-3 h-3" /> Selected
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-outline-variant/30 bg-surface-container-low flex items-center justify-between gap-3">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || !survivorId}
            className="gap-2"
            data-testid="confirm-duplicate-merge-btn"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitMerge className="w-4 h-4" />
            )}
            Merge {books.length} Books into 1
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getFieldValue(
  book: Book,
  heavy: Partial<BookDetails> | undefined,
  field: MergeableFieldKey,
): unknown {
  if (field === 'synopsis') {
    return (
      heavy?.synopsis ?? (book as Book & {synopsis?: string}).synopsis ?? ''
    );
  }
  if (field === 'authorBio') {
    return (
      heavy?.authorBio ?? (book as Book & {authorBio?: string}).authorBio ?? ''
    );
  }
  return book[field as keyof Book];
}

function hasMeaningfulValue(val: unknown): boolean {
  if (val === null || val === undefined) {
    return false;
  }
  if (typeof val === 'string') {
    return val.trim().length > 0;
  }
  if (typeof val === 'number') {
    return val > 0;
  }
  if (Array.isArray(val)) {
    return val.length > 0;
  }
  return Boolean(val);
}

function formatFieldDisplay(val: unknown, book: Book): string {
  if (typeof val === 'string') {
    if (
      val === book.primaryGenre &&
      book.subgenres &&
      book.subgenres.length > 0
    ) {
      return `${val} (${book.subgenres.join(', ')})`;
    }
    return val;
  }
  if (typeof val === 'number') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val.join(', ');
  }
  return String(val ?? '');
}
