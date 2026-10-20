import React from 'react';
import {Sparkles, RefreshCw, Plus, Check, Loader2} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {BookLoader} from './BookLoader';

export interface CuratorPickItem {
  title: string;
  author: string;
  coverUrl?: string;
  reason: string;
}

export interface CuratorPickCardProps {
  pickOfTheDay: CuratorPickItem | null;
  isGeneratingPick: boolean;
  generateNewPick: () => void;
  pickError?: string | null;
  eyebrow?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onAddToWantToRead?: (pick: CuratorPickItem) => Promise<void> | void;
  isAddedToWantToRead?: boolean;
  isAddingToWantToRead?: boolean;
  className?: string;
}

export const CuratorPickCard: React.FC<CuratorPickCardProps> = ({
  pickOfTheDay,
  isGeneratingPick,
  generateNewPick,
  pickError,
  eyebrow = "Curator's Recommendation",
  emptyTitle = "Curator's Pick",
  emptyDescription = 'Looking for something to read next? Let our AI curator pick a volume from your shelf.',
  onAddToWantToRead,
  isAddedToWantToRead = false,
  isAddingToWantToRead = false,
  className = '',
}) => {
  return (
    <div
      className={`bento-card bg-gradient-to-br from-surface-container-low/80 to-surface p-5 sm:p-6 relative overflow-hidden min-h-[160px] flex items-center ${className}`}
    >
      <div className="absolute top-4 right-4 text-primary/20 pointer-events-none">
        <Sparkles size={22} />
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => generateNewPick()}
        className="absolute top-3 left-3 z-20 hover:bg-surface-container text-on-surface-variant hover:text-primary w-8 h-8 rounded-lg"
        title="Get another recommendation"
      >
        <RefreshCw size={15} />
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
          <div className="w-20 sm:w-24 mx-auto sm:mx-0 flex-shrink-0 mt-1">
            {pickOfTheDay.coverUrl ? (
              <img
                alt="Book Cover"
                className="w-full h-auto object-cover rounded-lg book-cover-shadow border border-outline-variant/50 aspect-[2/3]"
                src={pickOfTheDay.coverUrl}
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-28 bg-surface-container rounded-lg book-cover-shadow border border-outline-variant/50 flex items-center justify-center p-2 text-center font-serif text-xs font-semibold text-on-surface-variant">
                {pickOfTheDay.title}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center flex-1 min-w-0 text-center sm:text-left break-words">
            <span className="metadata-eyebrow flex items-center justify-center sm:justify-start gap-1 mb-1">
              <Sparkles size={13} className="text-tertiary" />
              {eyebrow}
            </span>
            <h3 className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-primary line-clamp-1">
              {toTitleCase(pickOfTheDay.title)}
            </h3>
            <p className="font-sans text-xs text-on-surface-variant mb-2.5">
              {toTitleCase(pickOfTheDay.author)}
            </p>
            <div className="pt-2 border-t border-outline-variant/50 text-left">
              <p className="font-serif text-xs sm:text-sm text-on-surface leading-relaxed italic">
                &ldquo;{pickOfTheDay.reason}&rdquo;
              </p>
            </div>
            {onAddToWantToRead && (
              <div className="mt-3.5 flex items-center justify-center sm:justify-start">
                <Button
                  type="button"
                  size="sm"
                  variant={isAddedToWantToRead ? 'outline' : 'default'}
                  disabled={isAddedToWantToRead || isAddingToWantToRead}
                  onClick={() => void onAddToWantToRead(pickOfTheDay)}
                  className="h-8 px-3.5 text-xs font-sans font-semibold gap-1.5 rounded-lg"
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
      ) : pickError ? (
        <div className="w-full flex flex-col items-center justify-center gap-3 py-6 text-center z-10 relative px-4">
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
            variant="outline"
            size="sm"
            className="gap-1.5 bg-surface text-xs min-h-[36px] px-3.5 rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </Button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center justify-center gap-2.5 py-6 text-center z-10 relative px-4">
          <p className="font-serif text-lg font-semibold text-primary">
            {emptyTitle}
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-sm">
            {emptyDescription}
          </p>
          <Button
            onClick={() => generateNewPick()}
            variant="outline"
            size="sm"
            className="gap-2 bg-surface hover:bg-surface-container min-h-[38px] px-4 rounded-lg text-xs font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Surprise Me
          </Button>
        </div>
      )}
    </div>
  );
};
