import React from 'react';
import {Loader2, Wand2, RefreshCw, Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface SpruceUpActionBarProps {
  selectedCount: number;
  totalSelected: number;
  isOnline: boolean;
  isProcessing: boolean;
  progress: number;
  onFixMetadata: () => void;
  onForceResyncAll: () => void;
  onFixGenreAI: () => void;
  onForceGenreAI: () => void;
  onFixGenreAPI: () => void;
  onForceGenreAPI: () => void;
}

export function SpruceUpActionBar({
  selectedCount,
  isOnline,
  isProcessing,
  progress,
  onFixMetadata,
  onForceResyncAll,
  onFixGenreAI,
  onForceGenreAI,
  onFixGenreAPI,
  onForceGenreAPI,
}: SpruceUpActionBarProps) {
  if (selectedCount === 0 && !isProcessing) return null;

  return (
    <div className="sticky top-16 z-20 bg-surface/80 backdrop-blur-md border-b border-outline-variant py-4 px-6 -mx-6 mb-6 flex flex-wrap items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-bold flex items-center gap-2">
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
          {isProcessing
            ? `Processing ${progress}/${selectedCount}`
            : `${selectedCount} selected`}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onFixMetadata}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2"
          title="Fills in missing fields using Google Books/OpenLibrary"
        >
          <Wand2 className="w-4 h-4" />
          <span className="hidden sm:inline">Fix Missing Metadata</span>
          <span className="sm:hidden text-xs">Fix Metadata</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onForceResyncAll}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2"
          title="Refreshes all metadata from external APIs"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">Force Sync All</span>
          <span className="sm:hidden text-xs">Force Sync</span>
        </Button>

        <div className="h-6 w-[1px] bg-outline-variant mx-1 hidden md:block" />

        <Button
          variant="outline"
          size="sm"
          onClick={onFixGenreAPI}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2"
          title="Fills in missing genres using Google Books/OpenLibrary"
        >
          <Wand2 className="w-4 h-4" />
          <span className="hidden sm:inline">Fix Genre (API)</span>
          <span className="sm:hidden text-xs">Genre (API)</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onForceGenreAPI}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2"
          title="Refreshes genres from external APIs"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">Force Sync Genre (API)</span>
          <span className="sm:hidden text-xs">Sync Genre (API)</span>
        </Button>

        <div className="h-6 w-[1px] bg-outline-variant mx-1 hidden md:block" />

        <Button
          variant="default"
          size="sm"
          onClick={onFixGenreAI}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary-container hover:shadow-md transition-all border-none"
          title="Uses Gemini to suggest missing genres based on BISAC"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Fix Missing Genre (AI)</span>
          <span className="sm:hidden text-xs">Fix Genre (AI)</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onForceGenreAI}
          disabled={isProcessing || !isOnline}
          className="flex items-center gap-2 border-secondary/50 text-secondary hover:bg-secondary/10 hover:text-secondary"
          title="Uses Gemini to re-classify existing genres to BISAC"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Force Sync Genre (AI)</span>
          <span className="sm:hidden text-xs">Sync Genre (AI)</span>
        </Button>
      </div>
    </div>
  );
}
