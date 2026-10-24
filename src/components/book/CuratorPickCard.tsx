import React, {useState, useEffect} from 'react';
import {Sparkles, RefreshCw, Plus, Check, Loader2} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {BookLoader} from './BookLoader';
import {MonographCoverFallback} from './MonographCoverFallback';
import {ExLibrisStampIllustration} from '@/components/ui/empty-state-illustrations';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';

export interface CuratorPickItem {
  title: string;
  author: string;
  coverUrl?: string;
  reason: string;
  libraryId?: string;
  bookId?: string;
  libraryName?: string;
}

export interface CuratorPickCardProps {
  pickOfTheDay: CuratorPickItem | null;
  isGeneratingPick: boolean;
  generateNewPick: () => void;
  pickError?: string | null;
  hasAiPlan?: boolean;
  requiresAiPlan?: boolean;
  refreshTitle?: string;
  eyebrow?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onAddToWantToRead?: (pick: CuratorPickItem) => Promise<void> | void;
  isAddedToWantToRead?: boolean;
  isAddingToWantToRead?: boolean;
  onOpenBook?: (pick: CuratorPickItem) => void;
  className?: string;
}

export function CuratorPickCard({
  pickOfTheDay,
  isGeneratingPick,
  generateNewPick,
  pickError,
  hasAiPlan: passedHasAiPlan,
  requiresAiPlan = true,
  refreshTitle = 'Get another recommendation',
  eyebrow = "Curator's Recommendation",
  emptyTitle = "Curator's Pick",
  emptyDescription = 'Looking for your next great read? Let our curator suggest a standout title from this shelf.',
  onAddToWantToRead,
  isAddedToWantToRead = false,
  isAddingToWantToRead = false,
  onOpenBook,
  className = '',
}: CuratorPickCardProps) {
  const {hasAiPlan: contextHasAiPlan} = useAppPermissions();
  const isOnline = useOnlineStatus();
  const hasAiPlan = !requiresAiPlan || (passedHasAiPlan ?? contextHasAiPlan);
  const canRefresh = requiresAiPlan
    ? Boolean(hasAiPlan) && isOnline && !isGeneratingPick
    : !isGeneratingPick;
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    setCoverError(false);
  }, [pickOfTheDay?.coverUrl]);

  return (
    <div
      className={`bento-card bg-gradient-to-br from-surface-container-low/80 to-surface p-5 sm:p-6 relative overflow-hidden min-h-[160px] flex items-center ${className}`}
    >
      {pickOfTheDay && (
        <div className="absolute -top-1 -right-1 pointer-events-none opacity-25">
          <ExLibrisStampIllustration className="w-16 h-14" />
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => canRefresh && generateNewPick()}
        disabled={!canRefresh}
        className="absolute top-3 left-3 z-20 hover:bg-surface-container text-on-surface-variant hover:text-primary w-8 h-8 rounded-lg disabled:opacity-40"
        title={
          requiresAiPlan && !isOnline
            ? 'Unavailable while offline'
            : requiresAiPlan && !hasAiPlan
              ? 'Requires AI Plan (Admin-enabled)'
              : refreshTitle
        }
      >
        <RefreshCw size={15} strokeWidth={1.6} />
      </Button>
      {isGeneratingPick ? (
        <div className="w-full flex flex-col items-center justify-center gap-3 py-6">
          <BookLoader size="sm" />
          <p className="font-sans text-xs text-on-surface-variant animate-pulse">
            Curating your pick of the day...
          </p>
        </div>
      ) : pickOfTheDay ? (
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 w-full z-10 relative items-center sm:items-start pt-6 sm:pt-0">
          <div
            onClick={onOpenBook ? () => onOpenBook(pickOfTheDay) : undefined}
            className={`w-20 sm:w-24 mx-auto sm:mx-0 flex-shrink-0 mt-1 ${
              onOpenBook ? 'cursor-pointer' : ''
            }`}
          >
            {pickOfTheDay.coverUrl && !coverError ? (
              <img
                alt="Book Cover"
                className="w-full h-auto object-cover rounded-lg book-cover-shadow border border-outline-variant/50 aspect-[2/3]"
                src={pickOfTheDay.coverUrl}
                onError={() => setCoverError(true)}
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <MonographCoverFallback
                title={pickOfTheDay.title}
                author={pickOfTheDay.author}
                variant="compact"
                className="w-full aspect-[2/3] rounded-lg"
              />
            )}
          </div>
          <div className="flex flex-col justify-center flex-1 min-w-0 text-center sm:text-left break-words">
            <span className="metadata-eyebrow flex items-center justify-center sm:justify-start gap-1.5 mb-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary inline-block"
                aria-hidden="true"
              />
              {eyebrow}
            </span>
            <h3
              onClick={onOpenBook ? () => onOpenBook(pickOfTheDay) : undefined}
              className={`font-serif text-lg sm:text-xl font-semibold tracking-tight text-primary line-clamp-1 ${
                onOpenBook ? 'hover:underline cursor-pointer' : ''
              }`}
            >
              {toTitleCase(pickOfTheDay.title)}
            </h3>
            <p className="font-sans text-xs text-on-surface-variant mb-2.5">
              {toTitleCase(pickOfTheDay.author)}
              {pickOfTheDay.libraryName ? ` · ${pickOfTheDay.libraryName}` : ''}
            </p>
            <div className="pt-2 border-t border-outline-variant/50 text-left">
              <p className="font-serif text-xs sm:text-sm text-on-surface leading-relaxed italic line-clamp-3">
                &ldquo;{pickOfTheDay.reason}&rdquo;
              </p>
            </div>
            {onAddToWantToRead && (
              <div className="mt-3.5 flex items-center justify-center sm:justify-start">
                <Button
                  type="button"
                  size="sm"
                  variant={isAddedToWantToRead ? 'outline' : 'default'}
                  disabled={
                    !isOnline || isAddedToWantToRead || isAddingToWantToRead
                  }
                  title={!isOnline ? 'Unavailable while offline' : undefined}
                  onClick={() => void onAddToWantToRead(pickOfTheDay)}
                  className="h-8 px-3.5 text-xs font-sans font-semibold gap-1.5 rounded-lg disabled:opacity-50"
                >
                  {isAddingToWantToRead ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : isAddedToWantToRead ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-primary" />
                      <span>On Want-to-Read Shelf</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Want to Read</span>
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : !hasAiPlan ? (
        <div className="w-full flex flex-col items-center justify-center gap-2 py-5 text-center z-10 relative px-4">
          <ExLibrisStampIllustration className="w-14 h-12 mb-0.5" />
          <p className="font-serif text-lg font-semibold text-primary">
            {emptyTitle}
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-sm">
            {emptyDescription}
          </p>
          <span
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans font-medium bg-surface-container text-on-surface-variant border border-outline-variant/50"
            title="Requires AI Plan (Admin-enabled)"
          >
            <Sparkles className="w-3.5 h-3.5 text-on-surface-variant/70" />
            Requires AI Plan (Admin-enabled)
          </span>
        </div>
      ) : pickError ? (
        <div className="w-full flex flex-col items-center justify-center gap-2.5 py-5 text-center z-10 relative px-4">
          <ExLibrisStampIllustration className="w-14 h-12" />
          <p className="font-serif text-sm font-semibold text-primary">
            AI Curator Unavailable
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-sm">
            {pickError.includes('GEMINI_API_KEY') ||
            pickError.includes('API key') ||
            pickError.includes('key not valid')
              ? 'AI recommendations require a GEMINI_API_KEY set in server environment.'
              : `Error: ${pickError}`}
          </p>
          <Button
            onClick={() => generateNewPick()}
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            variant="outline"
            size="sm"
            className="gap-1.5 bg-surface text-xs min-h-[36px] px-3.5 rounded-lg disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </Button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center justify-center gap-2 py-5 text-center z-10 relative px-4">
          <ExLibrisStampIllustration className="w-14 h-12 mb-0.5" />
          <p className="font-serif text-lg font-semibold text-primary">
            {emptyTitle}
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-sm">
            {emptyDescription}
          </p>
          <Button
            onClick={() => generateNewPick()}
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            variant="outline"
            size="sm"
            className="mt-1 gap-2 bg-surface hover:bg-surface-container min-h-[38px] px-4 rounded-lg text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Surprise Me
          </Button>
        </div>
      )}
    </div>
  );
}
