import React, {useState, useMemo, useEffect} from 'react';
import {Search, X, Plus} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {MagnifyingBookmarkIllustration} from '@/components/ui/empty-state-illustrations';
import {ReadingShelfCard} from './ReadingShelfCard';
import type {ShelfFilterTab} from './useReadingShelf';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
  ReadingShelfSummary,
} from '../../server/services/readingTracker';

interface ReadingListsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: TrackedBookItem[];
  counts: ReadingShelfSummary['counts'];
  initialTab?: ShelfFilterTab;
  initialGenre?: string | null;
  onStatusChange: (
    libraryId: string,
    bookId: string,
    status: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
  onOpenTrackBook: () => void;
}

const SHELF_TABS: Array<{id: ShelfFilterTab; label: string}> = [
  {id: 'all', label: 'All Tracked'},
  {id: 'reading', label: 'Currently Reading'},
  {id: 'want_to_read', label: 'Want to Read'},
  {id: 'finished', label: 'Books I’ve Read'},
  {id: 'abandoned', label: 'Abandoned'},
];

export function ReadingListsDialog({
  isOpen,
  onClose,
  allItems,
  counts,
  initialTab = 'all',
  initialGenre = null,
  onStatusChange,
  onOpenTrackBook,
}: ReadingListsDialogProps) {
  const [activeTab, setActiveTab] = useState<ShelfFilterTab>(initialTab);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(
    initialGenre,
  );
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSelectedGenre(initialGenre);
      setSearchQuery('');
    }
  }, [isOpen, initialTab, initialGenre]);

  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      if (activeTab !== 'all' && item.readingStatus !== activeTab) {
        return false;
      }
      if (selectedGenre && item.primaryGenre !== selectedGenre) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const authorMatch = (item.author || '').toLowerCase().includes(q);
        const genreMatch = (item.primaryGenre || '').toLowerCase().includes(q);
        if (!titleMatch && !authorMatch && !genreMatch) {
          return false;
        }
      }
      return true;
    });
  }, [allItems, activeTab, selectedGenre, searchQuery]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="font-serif text-2xl text-on-surface">
                Your Reading Lists
              </DialogTitle>
              <DialogDescription className="font-sans text-sm text-on-surface-variant">
                Browse and manage all tracked books across your personal shelves
                and libraries.
              </DialogDescription>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose();
                onOpenTrackBook();
              }}
              className="gap-1.5 self-start sm:self-auto shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Track a Book</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Controls Bar: Shelf Tabs + Search + Genre Filter */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Reading list shelves"
              className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/50 overflow-x-auto"
            >
              {SHELF_TABS.map(tab => {
                const isActive = activeTab === tab.id;
                const count = counts[tab.id] ?? 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-1.5 text-xs font-sans font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-surface text-on-surface shadow-2xs border border-outline-variant/60'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="font-mono tabular-nums text-[11px] text-on-surface-variant">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full md:w-60 shrink-0">
              <Search className="w-3.5 h-3.5 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter by title or author..."
                className="pl-8 h-9 text-xs bg-surface-container-low"
              />
            </div>
          </div>

          {selectedGenre && (
            <div className="flex items-center gap-2">
              <span className="metadata-eyebrow">Filtered by Genre:</span>
              <Badge
                variant="outline"
                className="gap-1.5 pl-2.5 pr-1.5 py-0.5 text-xs font-medium bg-surface-container"
              >
                <span>{selectedGenre}</span>
                <button
                  type="button"
                  onClick={() => setSelectedGenre(null)}
                  className="hover:text-primary cursor-pointer"
                  aria-label="Clear genre filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            </div>
          )}
        </div>

        {/* Scrollable Shelf Grid */}
        <div className="flex-1 overflow-y-auto pr-1 pt-2 min-h-[280px]">
          {filteredItems.length === 0 ? (
            <div className="py-16 text-center bg-surface-container-low rounded-xl border border-outline-variant/40">
              <MagnifyingBookmarkIllustration className="mx-auto mb-2.5" />
              <p className="font-serif text-base font-semibold text-on-surface">
                No Matching Books
              </p>
              <p className="font-sans text-xs text-on-surface-variant mt-1">
                Try another shelf tab or clear your search to see more books.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
              {filteredItems.map(item => (
                <ReadingShelfCard
                  key={`${item.libraryId}-${item.id}`}
                  item={item}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
