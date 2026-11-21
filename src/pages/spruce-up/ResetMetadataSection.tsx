import React, {useMemo, useState} from 'react';
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
import {RotateCcw, CheckCircle2, Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {findEnrichmentDescriptor} from '../../constants/enrichmentDescriptors';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {useEntityCacheStore} from '../../stores/entityCacheStore';
import type {Book} from '../../types';
import type {CanonicalEnrichmentType} from '../../types/metadata';

export interface ResetMetadataSectionProps {
  libraryId: string;
  books?: Book[];
}

const RESETTABLE_METADATA_OPTIONS: ReadonlyArray<{
  id: CanonicalEnrichmentType;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'genre',
    label: 'Primary Genre & Subgenres',
    shortLabel: 'Genres',
    description:
      'Removes the standardized primary genre, subgenres, and custom genre flags across all books.',
  },
  {
    id: 'geo',
    label: 'Settings & Places',
    shortLabel: 'Settings & Places',
    description:
      'Removes extracted geographical locations and map settings across all books.',
  },
  {
    id: 'temporal',
    label: 'Historical Eras',
    shortLabel: 'Historical Eras',
    description:
      'Removes narrative time periods and historical eras across all books.',
  },
  {
    id: 'synopsis',
    label: 'Summaries & Synopses',
    shortLabel: 'Summaries',
    description: 'Removes summaries across all books.',
  },
  {
    id: 'authorBio',
    label: 'Author Biographies',
    shortLabel: 'Author Bios',
    description: 'Removes biographical author notes across all books.',
  },
  {
    id: 'series',
    label: 'Series Info',
    shortLabel: 'Series Info',
    description: 'Removes series names and volume numbers across all books.',
  },
  {
    id: 'coverImage',
    label: 'Cover Art Images',
    shortLabel: 'Cover Art',
    description:
      'Removes cover image links across all books so you can fetch fresh high-resolution covers.',
  },
  {
    id: 'embedding',
    label: 'Visual Clusters & Themes',
    shortLabel: 'Visual Clusters',
    description:
      'Removes similarity vectors and constellation map coordinates across all books.',
  },
];

function doesBookIncludeResettableDetail(
  book: Book,
  type: CanonicalEnrichmentType,
): boolean {
  if (type === 'synopsis' && Boolean(book.synopsis?.trim())) {
    return true;
  }
  if (type === 'authorBio' && Boolean(book.authorBio?.trim())) {
    return true;
  }
  const descriptor = findEnrichmentDescriptor(type);
  if (descriptor) {
    return descriptor.isPresent(book);
  }
  return false;
}

export function ResetMetadataSection({
  libraryId,
  books,
}: ResetMetadataSectionProps) {
  const utils = trpc.useUtils();
  const isOnline = useOnlineStatus();

  const [selectedType, setSelectedType] =
    useState<CanonicalEnrichmentType>('genre');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [lastResetInfo, setLastResetInfo] = useState<{
    label: string;
    count: number;
  } | null>(null);

  const currentOption =
    RESETTABLE_METADATA_OPTIONS.find(opt => opt.id === selectedType) ||
    RESETTABLE_METADATA_OPTIONS[0];

  const affectedCount = useMemo(() => {
    if (!books) {
      return undefined;
    }
    return books.filter(book =>
      doesBookIncludeResettableDetail(book, selectedType),
    ).length;
  }, [books, selectedType]);

  const isZeroAffected = affectedCount !== undefined && affectedCount === 0;
  const isTriggerDisabled = !isOnline || isResetting || isZeroAffected;
  const offlineTitle = !isOnline ? 'Unavailable while offline' : undefined;

  const handleConfirmReset = async () => {
    setIsResetting(true);
    try {
      const res = await trpcVanilla.library.resetMetadata.mutate({
        libraryId,
        metadataType: selectedType,
      });
      useEntityCacheStore
        .getState()
        .clearLibraryEnrichmentField(libraryId, selectedType);
      void utils.book.list.invalidate({libraryId});
      void utils.library.get.invalidate({libraryId});
      if (
        selectedType === 'coverImage' ||
        selectedType === 'genre' ||
        selectedType === 'series' ||
        selectedType === 'synopsis'
      ) {
        void utils.readingTracker?.getShelf?.invalidate?.();
        void utils.readingTracker?.getUnreadLibraryBooks?.invalidate?.();
      }

      toast.success(
        `Reset ${currentOption.shortLabel} across ${res.count} book${res.count === 1 ? '' : 's'}.`,
      );

      setLastResetInfo({label: currentOption.shortLabel, count: res.count});
      setIsDialogOpen(false);
    } catch (err: unknown) {
      console.error('Failed to reset metadata:', err);
      toast.error('Failed to reset book details');
    } finally {
      setIsResetting(false);
    }
  };

  const actionButtonText = `Reset ${currentOption.shortLabel}`;

  return (
    <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-xs flex flex-col">
      <div className="p-6 border-b border-outline-variant/30">
        <h3 className="font-serif text-xl font-semibold text-on-surface text-balance">
          Reset Book Details
        </h3>
        <p className="text-sm text-on-surface-variant font-sans mt-0.5 leading-relaxed max-w-[68ch]">
          Clear a specific detail—like covers, genres, series info, or
          summaries—across every book on this shelf when you want to start
          fresh.
        </p>
      </div>

      <div className="p-6 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
        <div className="flex-1 w-full">
          <label
            htmlFor="reset-metadata-select"
            className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider block mb-1.5"
          >
            Detail Category to Reset
          </label>
          <Select
            value={selectedType}
            onValueChange={val => {
              const matched = RESETTABLE_METADATA_OPTIONS.find(
                opt => opt.id === val,
              );
              if (matched) {
                setSelectedType(matched.id);
                setLastResetInfo(null);
              }
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
          {books !== undefined && affectedCount !== undefined && (
            <p
              data-testid="reset-metadata-affected-count"
              className="text-xs text-on-surface-variant font-sans tabular-nums mt-2"
            >
              {affectedCount > 0
                ? `${affectedCount} of ${books.length} ${
                    books.length === 1
                      ? 'book currently includes'
                      : 'books currently include'
                  } ${currentOption.shortLabel}`
                : `No books currently include ${currentOption.shortLabel}`}
            </p>
          )}
        </div>

        <span title={offlineTitle} className="inline-flex shrink-0">
          <Button
            id="open-reset-metadata-dialog-btn"
            variant="destructive"
            onClick={() => setIsDialogOpen(true)}
            disabled={isTriggerDisabled}
            title={offlineTitle}
            className="shrink-0 gap-2 rounded-lg whitespace-nowrap mt-2 md:mt-0"
          >
            {isResetting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            {actionButtonText}
          </Button>
        </span>
      </div>

      {lastResetInfo && (
        <div className="flex items-center gap-3 px-6 py-4 border-t border-outline-variant/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300 text-sm font-sans">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="tabular-nums">
            <span className="font-semibold">{lastResetInfo.label}</span> was
            cleared across {lastResetInfo.count}{' '}
            {lastResetInfo.count === 1 ? 'book' : 'books'}. Switch to the{' '}
            <span className="font-semibold">Missing Details</span> tab anytime
            to fill them back in.
          </div>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-semibold text-balance">
              Confirm Detail Reset
            </DialogTitle>
            <DialogDescription asChild>
              <div className="font-sans text-sm text-on-surface-variant pt-2 space-y-2">
                <p className="tabular-nums">
                  Clear{' '}
                  <strong className="text-on-surface font-semibold">
                    {currentOption.label}
                  </strong>{' '}
                  from{' '}
                  {affectedCount !== undefined && affectedCount > 0
                    ? `${affectedCount} ${affectedCount === 1 ? 'book' : 'books'}`
                    : 'matching books'}{' '}
                  in this library?
                </p>
                <p className="text-xs text-on-surface-variant">
                  This cannot be undone automatically, though you can fill these
                  details back in from the Missing Details tab afterwards.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isResetting}
              className="rounded-lg whitespace-nowrap shrink-0"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReset}
              disabled={!isOnline || isResetting}
              title={offlineTitle}
              className="gap-2 rounded-lg whitespace-nowrap shrink-0"
            >
              {isResetting && <Loader2 className="w-4 h-4 animate-spin" />}
              {actionButtonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
