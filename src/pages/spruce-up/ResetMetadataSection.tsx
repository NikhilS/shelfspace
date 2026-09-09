import React, {useState, useMemo} from 'react';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Sparkles,
  Database,
} from 'lucide-react';
import {toast} from 'sonner';
import {collection, doc, getDocs, deleteField} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {ClientBulkWriter} from '../../lib/clientBulkWriter';
import {Book} from '../../types';
import {
  sanitizeBookStorage,
  hasHeavyLeaks,
} from '../../services/db/sanitizeStorage';

interface ResetMetadataSectionProps {
  libraryId: string;
  books?: Book[];
}

const RESETTABLE_METADATA_OPTIONS = [
  {
    id: 'genre',
    label: 'Primary Genre & Subgenres (Current Taxonomy)',
    shortLabel: 'Taxonomy Genres',
    description:
      'Removes the standardized primary genre, subgenres, and custom flags across all books.',
    isLegacy: false,
  },
  {
    id: 'geo',
    label: 'Settings & Places (Geo Metadata)',
    shortLabel: 'Settings & Places',
    description:
      'Removes extracted geographical locations and map settings from all books.',
    isLegacy: false,
  },
  {
    id: 'temporal',
    label: 'Historical Eras (Temporal Metadata)',
    shortLabel: 'Historical Eras',
    description:
      'Removes extracted narrative time periods and historical eras from all books.',
    isLegacy: false,
  },
  {
    id: 'synopsis',
    label: 'Summaries & Synopses',
    shortLabel: 'Summaries',
    description: 'Removes synopses and descriptions from all books.',
    isLegacy: false,
  },
  {
    id: 'authorBio',
    label: 'Author Biographies',
    shortLabel: 'Author Bios',
    description: 'Removes biographical author notes from all books.',
    isLegacy: false,
  },
  {
    id: 'embedding',
    label: 'Embeddings & Visual Clusters',
    shortLabel: 'Embeddings',
    description:
      'Removes vector embeddings and cluster projection coordinates from all books.',
    isLegacy: false,
  },
];

function buildDeletePayload(
  book: Record<string, unknown>,
  metadataType: string,
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  const enrichmentStatus = book.enrichmentStatus as
    Record<string, unknown> | undefined;

  if (metadataType === 'genre' || metadataType === 'primaryGenre') {
    if (book.primaryGenre !== undefined) payload.primaryGenre = deleteField();
    if (book.subgenres !== undefined) payload.subgenres = deleteField();
    if (book.isCustomPrimary !== undefined) {
      payload.isCustomPrimary = deleteField();
    }
    if (enrichmentStatus?.genre !== undefined) {
      payload['enrichmentStatus.genre'] = deleteField();
    }
  } else if (metadataType === 'geo') {
    if (book.geoMetadata !== undefined) payload.geoMetadata = deleteField();
    if (enrichmentStatus?.geo !== undefined) {
      payload['enrichmentStatus.geo'] = deleteField();
    }
  } else if (metadataType === 'temporal') {
    if (book.temporalMetadata !== undefined) {
      payload.temporalMetadata = deleteField();
    }
    if (enrichmentStatus?.temporal !== undefined) {
      payload['enrichmentStatus.temporal'] = deleteField();
    }
  } else if (metadataType === 'synopsis') {
    if (book.bookDetailsMetadata?.hasSynopsis) {
      payload['bookDetailsMetadata.hasSynopsis'] = false;
    }
    if ((book as Record<string, unknown>).synopsis !== undefined) {
      payload.synopsis = deleteField();
    }
    if (enrichmentStatus?.synopsis !== undefined) {
      payload['enrichmentStatus.synopsis'] = deleteField();
    }
  } else if (metadataType === 'authorBio') {
    if (book.bookDetailsMetadata?.hasAuthorBio) {
      payload['bookDetailsMetadata.hasAuthorBio'] = false;
    }
    if ((book as Record<string, unknown>).authorBio !== undefined) {
      payload.authorBio = deleteField();
    }
    if (enrichmentStatus?.authorBio !== undefined) {
      payload['enrichmentStatus.authorBio'] = deleteField();
    }
  } else if (metadataType === 'embedding') {
    if ((book as Record<string, unknown>).embedding !== undefined) {
      payload.embedding = deleteField();
    }
    if ((book as Record<string, unknown>).clusterCoordinates !== undefined) {
      payload.clusterCoordinates = deleteField();
    }
    if (book.bookDetailsMetadata?.hasEmbedding) {
      payload['bookDetailsMetadata.hasEmbedding'] = false;
    }
    if (book.bookDetailsMetadata?.hasClusterCoordinates) {
      payload['bookDetailsMetadata.hasClusterCoordinates'] = false;
    }
    if (enrichmentStatus?.embedding !== undefined) {
      payload['enrichmentStatus.embedding'] = deleteField();
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function ResetMetadataSection({
  libraryId,
  books,
}: ResetMetadataSectionProps) {
  const [selectedType, setSelectedType] = useState<string>('genre');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [lastResetInfo, setLastResetInfo] = useState<{
    label: string;
    count: number;
  } | null>(null);

  // Storage Sanitization State
  const [isSanitizeDialogOpen, setIsSanitizeDialogOpen] = useState(false);
  const [isSanitizing, setIsSanitizing] = useState(false);
  const [sanitizeProgress, setSanitizeProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [lastSanitizeResult, setLastSanitizeResult] = useState<{
    scanned: number;
    sanitized: number;
    purged: number;
  } | null>(null);

  const booksWithLeaks = useMemo(() => {
    const leaks = (books || []).filter(hasHeavyLeaks);
    return leaks;
  }, [books]);

  const isPending = isResetting || isSanitizing;

  const currentOption =
    RESETTABLE_METADATA_OPTIONS.find(opt => opt.id === selectedType) ||
    RESETTABLE_METADATA_OPTIONS[0];

  const handleConfirmSanitize = async () => {
    setIsSanitizing(true);
    try {
      const res = await sanitizeBookStorage(libraryId, books, progress => {
        setSanitizeProgress(progress);
      });
      setLastSanitizeResult({
        scanned: res.scannedCount,
        sanitized: res.sanitizedCount,
        purged: res.purgedFieldsCount,
      });
      toast.success(
        `Sanitized ${res.sanitizedCount} books. Relocated heavy payloads to bookDetails and purged leaked root fields.`,
      );
      setIsSanitizeDialogOpen(false);
    } catch (err: unknown) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `libraries/${libraryId}/books`,
      );
    } finally {
      setIsSanitizing(false);
      setSanitizeProgress(null);
    }
  };

  const handleConfirmReset = async () => {
    setIsResetting(true);
    try {
      let booksToInspect = books && books.length > 0 ? books : [];
      if (booksToInspect.length === 0) {
        const booksSnap = await getDocs(
          collection(db, 'libraries', libraryId, 'books'),
        );
        booksToInspect = booksSnap.docs.map(
          d => ({...d.data(), id: d.id}) as Book,
        );
      }

      const writer = new ClientBulkWriter(db, 100);
      let count = 0;

      for (const book of booksToInspect) {
        const payload = buildDeletePayload(book, selectedType);
        if (payload) {
          const bookRef = doc(db, 'libraries', libraryId, 'books', book.id);
          writer.update(bookRef, payload);

          if (
            selectedType === 'synopsis' ||
            selectedType === 'authorBio' ||
            selectedType === 'embedding'
          ) {
            const detailRef = doc(
              db,
              'libraries',
              libraryId,
              'bookDetails',
              book.id,
            );
            const detailPayload: Record<string, unknown> = {};
            if (selectedType === 'synopsis') {
              detailPayload.synopsis = deleteField();
            }
            if (selectedType === 'authorBio') {
              detailPayload.authorBio = deleteField();
            }
            if (selectedType === 'embedding') {
              detailPayload.embedding = deleteField();
              detailPayload.clusterCoordinates = deleteField();
            }
            if (Object.keys(detailPayload).length > 0) {
              writer.set(detailRef, detailPayload, {merge: true});
            }
          }

          count++;
        }
      }

      await writer.close();

      toast.success(
        `Successfully reset ${currentOption.shortLabel} across ${count} book${count === 1 ? '' : 's'}.`,
      );

      setLastResetInfo({label: currentOption.shortLabel, count});
      setIsDialogOpen(false);
    } catch (err: unknown) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `libraries/${libraryId}/books`,
      );
    } finally {
      setIsResetting(false);
    }
  };

  const actionButtonText = `Reset ${currentOption.shortLabel}`;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Storage Hardening & Payload Sanitization Card */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="p-6 border-b border-outline-variant/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold text-on-surface">
                Hardened Storage Sanitization
              </h3>
              <p className="text-sm text-on-surface-variant font-sans">
                Audit and purge heavy data leaks (synopses, embeddings, bios)
                from primary book documents to drastically reduce listener
                bandwidth.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {booksWithLeaks.length > 0 ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-on-surface">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 font-sans text-sm">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">
                    {booksWithLeaks.length === 1
                      ? '1 book contains heavy payload leaks'
                      : `${booksWithLeaks.length} books contain heavy payload leaks`}
                  </p>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Root documents still hold full synopses or embedding
                    vectors. Purging them relocates payloads to the isolated{' '}
                    <code className="font-mono font-body-xs text-body-xs px-1 py-0.5 rounded bg-surface-container">
                      bookDetails
                    </code>{' '}
                    collection and sets lightweight{' '}
                    <code className="font-mono font-body-xs text-body-xs px-1 py-0.5 rounded bg-surface-container">
                      bookDetailsMetadata
                    </code>{' '}
                    flags.
                  </p>
                </div>
              </div>

              <Button
                id="open-sanitize-dialog-btn"
                variant="default"
                onClick={() => setIsSanitizeDialogOpen(true)}
                disabled={isPending}
                className="flex-shrink-0 gap-2 bg-amber-600 hover:bg-amber-700 text-white font-sans text-xs sm:text-sm"
              >
                {isSanitizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Purge Heavy Data Leaks ({booksWithLeaks.length})
              </Button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-on-surface">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <div className="font-sans text-sm">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Persistence Layer Fully Hardened
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    All {books?.length || 0} books are strictly partitioned. No
                    heavy text or embedding vectors detected in primary book
                    documents.
                  </p>
                </div>
              </div>

              <Button
                id="manual-rescan-sanitize-btn"
                variant="outline"
                size="sm"
                onClick={() => setIsSanitizeDialogOpen(true)}
                disabled={isPending}
                className="flex-shrink-0 text-xs gap-1.5"
              >
                {isSanitizing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                Verify & Re-sanitize
              </Button>
            </div>
          )}

          {sanitizeProgress && (
            <div className="space-y-1.5 font-sans text-xs text-on-surface-variant">
              <div className="flex justify-between">
                <span>Sanitizing storage...</span>
                <span>
                  {sanitizeProgress.completed} / {sanitizeProgress.total}
                </span>
              </div>
              <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: `${Math.round(
                      (sanitizeProgress.completed /
                        Math.max(1, sanitizeProgress.total)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {lastSanitizeResult && (
            <div className="p-3.5 rounded-xl bg-surface border border-outline-variant/20 font-sans text-xs text-on-surface-variant flex items-center justify-between">
              <span>
                Last purge: Sanitized {lastSanitizeResult.sanitized} books and
                purged {lastSanitizeResult.purged} leaked root fields.
              </span>
              <span className="font-body-xs text-body-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Up to date
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Reset Metadata Category Card */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="p-6 border-b border-outline-variant/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center text-error">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif text-xl font-bold text-on-surface">
                  Reset Metadata & Purge Obsolete Fields
                </h3>
                <p className="text-sm text-on-surface-variant font-sans">
                  Remove all metadata of a given kind across every book in this
                  library to start over or clear outdated data.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 justify-between bg-surface p-4 rounded-xl border border-outline-variant/20">
            <div className="flex-1">
              <label
                htmlFor="reset-metadata-select"
                className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider block mb-1.5"
              >
                Metadata Category to Reset
              </label>
              <Select
                value={selectedType}
                onValueChange={val => {
                  setSelectedType(val);
                  setLastResetInfo(null);
                }}
              >
                <SelectTrigger
                  id="reset-metadata-select"
                  className="w-full max-w-md bg-surface-container text-sm border-outline-variant/50 rounded-lg px-3 py-2 text-on-surface h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESETTABLE_METADATA_OPTIONS.map(opt => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-on-surface-variant/80 mt-2 font-sans leading-relaxed max-w-xl">
                {currentOption.description}
              </p>
            </div>

            <Button
              id="open-reset-metadata-dialog-btn"
              variant="destructive"
              onClick={() => setIsDialogOpen(true)}
              disabled={isPending}
              className="flex-shrink-0 gap-2 mt-2 md:mt-0"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {actionButtonText}
            </Button>
          </div>

          {lastResetInfo && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-sm font-sans">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <span className="font-semibold">{lastResetInfo.label}</span> was
                successfully reset across {lastResetInfo.count} books. You can
                now re-enrich your collection using the Complete Book Details
                table above.
              </div>
            </div>
          )}
        </div>

        {/* Reset Category Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="w-12 h-12 rounded-full bg-error/10 text-error flex items-center justify-center mb-3">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <DialogTitle className="font-serif text-xl">
                Confirm Metadata Reset
              </DialogTitle>
              <DialogDescription asChild>
                <div className="font-sans text-sm text-on-surface-variant pt-2 space-y-2">
                  <p>
                    Are you sure you want to permanently delete{' '}
                    <strong className="text-on-surface font-semibold">
                      {currentOption.label}
                    </strong>{' '}
                    from every book in this library?
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    This action cannot be undone automatically, but you can
                    always re-enrich your books afterwards.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0 mt-4">
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmReset}
                disabled={isPending}
                className="gap-2"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {actionButtonText}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Storage Sanitization Dialog */}
        <Dialog
          open={isSanitizeDialogOpen}
          onOpenChange={setIsSanitizeDialogOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Database className="w-6 h-6" />
              </div>
              <DialogTitle className="font-serif text-xl">
                Purge Heavy Data Leaks
              </DialogTitle>
              <DialogDescription asChild>
                <div className="font-sans text-sm text-on-surface-variant pt-2 space-y-2">
                  <p>
                    This routine will scan all books in your library and safely
                    migrate any synopses, author biographies, embeddings, and
                    cluster coordinates to the dedicated{' '}
                    <code className="font-mono text-xs px-1 py-0.5 rounded bg-surface-container">
                      bookDetails
                    </code>{' '}
                    collection.
                  </p>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Once migrated, the heavy fields are purged from the primary
                    document, leaving only lightweight{' '}
                    <code className="font-mono text-xs px-1 py-0.5 rounded bg-surface-container">
                      bookDetailsMetadata
                    </code>{' '}
                    flags. No book descriptions or embeddings are lost.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0 mt-4">
              <Button
                variant="outline"
                onClick={() => setIsSanitizeDialogOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleConfirmSanitize}
                disabled={isPending}
                className="gap-2 bg-primary text-on-primary"
              >
                {isSanitizing && <Loader2 className="w-4 h-4 animate-spin" />}
                Purge & Hard-Fence Now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
