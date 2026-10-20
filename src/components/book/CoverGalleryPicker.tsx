import React, {useState} from 'react';
import {Images, Loader2, Check, Sparkles} from 'lucide-react';
import {trpcVanilla} from '../../lib/trpc';
import type {CoverCandidate} from '../../types';

interface CoverGalleryPickerProps {
  title: string;
  author: string;
  isbn?: string;
  activeCoverUrl?: string;
  initialCandidates?: CoverCandidate[];
  onSelectCover: (url: string) => void;
}

const TIER_LABEL: Record<
  NonNullable<CoverCandidate['resolutionTier']>,
  string
> = {
  ultra: 'Ultra-Res',
  high: 'High-Res',
  standard: 'Standard',
};

export const CoverGalleryPicker: React.FC<CoverGalleryPickerProps> = ({
  title,
  author,
  isbn,
  activeCoverUrl,
  initialCandidates = [],
  onSelectCover,
}) => {
  const [isOpen, setIsOpen] = useState(initialCandidates.length > 1);
  const [isLoading, setIsLoading] = useState(false);
  const [candidates, setCandidates] =
    useState<CoverCandidate[]>(initialCandidates);
  const [skippedProviders, setSkippedProviders] = useState<string[]>([]);
  const [respondedProviders, setRespondedProviders] = useState<string[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const canQuery = Boolean(isbn?.trim() || title?.trim());

  const handleBrowseCovers = async () => {
    if (!canQuery || isLoading) return;
    setIsOpen(true);
    setIsLoading(true);
    try {
      const res = await trpcVanilla.metadata.fetchCoverCandidates.mutate({
        isbn: isbn?.trim() || undefined,
        title: title?.trim() || undefined,
        author: author?.trim() || undefined,
      });
      setCandidates(res.candidates);
      setSkippedProviders(res.skippedProviders);
      setRespondedProviders(res.respondedProviders);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch cover candidates:', err);
      setHasFetched(true);
    } finally {
      setIsLoading(false);
    }
  };

  const visibleCandidates = candidates.filter(c => !failedUrls.has(c.url));

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleBrowseCovers}
          disabled={!canQuery || isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container text-on-surface border border-outline-variant/60 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          ) : (
            <Images className="w-3.5 h-3.5 text-primary" />
          )}
          <span>
            {hasFetched ? 'Refresh Cover Gallery' : 'Browse Alternative Covers'}
          </span>
        </button>

        {isOpen && hasFetched && !isLoading && (
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Hide Gallery
          </button>
        )}
      </div>

      {isOpen && (
        <div className="p-3 bg-surface-container-low/70 border border-outline-variant/50 rounded-xl space-y-2.5 animate-in fade-in duration-150">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-outline-variant/30 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary" />
              Federated Cover Studio
            </span>
            {hasFetched && !isLoading && (
              <span className="text-[11px] font-mono tabular-nums text-on-surface-variant">
                Found {visibleCandidates.length}{' '}
                {visibleCandidates.length === 1 ? 'cover' : 'covers'}
                {respondedProviders.length > 0
                  ? ` across ${respondedProviders.length} ${respondedProviders.length === 1 ? 'source' : 'sources'}`
                  : ''}
                {skippedProviders.length > 0
                  ? ` · ${skippedProviders.length} rate-limited skipped`
                  : ''}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-1">
              {[0, 1, 2, 3].map(idx => (
                <div key={idx} className="space-y-1.5">
                  <div className="aspect-[3/4] w-full rounded-lg bg-surface-container-high animate-pulse border border-outline-variant/40" />
                  <div className="h-2.5 w-3/4 rounded bg-surface-container-high animate-pulse" />
                </div>
              ))}
            </div>
          ) : visibleCandidates.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-1 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              {visibleCandidates.map(candidate => {
                const isSelected = activeCoverUrl === candidate.url;
                const tierText = candidate.resolutionTier
                  ? TIER_LABEL[candidate.resolutionTier]
                  : '';

                return (
                  <button
                    key={candidate.url}
                    type="button"
                    onClick={() => onSelectCover(candidate.url)}
                    className="group text-left flex flex-col focus:outline-none cursor-pointer"
                  >
                    <div
                      className={`relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-surface-container transition-transform duration-150 group-hover:scale-[1.02] ${
                        isSelected
                          ? 'ring-2 ring-primary border border-primary'
                          : 'border border-outline-variant/60 group-hover:border-outline'
                      }`}
                    >
                      <img
                        src={candidate.url}
                        alt={`${title} cover from ${candidate.source}`}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={() => {
                          setFailedUrls(prev => {
                            const next = new Set(prev);
                            next.add(candidate.url);
                            return next;
                          });
                        }}
                      />
                      <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/20 to-transparent pointer-events-none" />
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-sm">
                          <Check className="w-3 h-3 stroke-[2.5]" />
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 text-[11px] leading-tight text-on-surface-variant truncate">
                      <span className="font-medium text-on-surface">
                        {candidate.source}
                      </span>
                      {tierText ? (
                        <span className="text-on-surface-variant">
                          {' '}
                          · {tierText}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant py-2">
              No verified alternative covers found for this edition. Try adding
              an ISBN or refining the title and author.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
