import React from 'react';
import {Link} from 'react-router-dom';
import {motion} from 'motion/react';
import {Library, Book} from '../../types';
import {toTitleCase} from '../../lib/utils';
import {CloudUpload, RefreshCw, ArrowLeft} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';

interface LibraryHeaderProps {
  library: Library;
  books: Book[];
  isOwner: boolean;
  isSyncing?: boolean;
  role?: 'owner' | 'editor' | 'viewer' | null;
  canEdit?: boolean;
  isRefreshingHero?: boolean;
  onRefreshHero?: () => void;
}

export const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  library,
  books,
  isOwner,
  isSyncing = false,
  role,
  canEdit = false,
  isRefreshingHero = false,
  onRefreshHero,
}) => {
  return (
    <div
      className={`w-full min-h-[110px] sm:min-h-[180px] md:min-h-[220px] relative overflow-hidden flex flex-col justify-between transition-all duration-300 ${
        !library.heroImageUrl ? 'bg-primary' : ''
      }`}
    >
      {library.heroImageUrl && (
        <img
          src={library.heroImageUrl}
          alt={library.name}
          className="w-full h-full object-cover absolute inset-0"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/60 to-primary/30 opacity-95" />

      {/* Top Bar: Back to All Libraries Navigation */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pt-2.5 sm:pt-3.5">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-label-caps-sm text-label-caps-sm sm:text-xs font-sans font-medium text-white/90 hover:text-white bg-black/35 hover:bg-black/50 backdrop-blur-md px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border border-white/15 shadow-xs"
        >
          <ArrowLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>All Libraries</span>
        </Link>
      </div>

      {/* Bottom Title & Metadata */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pb-2 sm:pb-4 md:pb-5 text-white mt-auto">
        <motion.div
          initial={{opacity: 0, y: 8}}
          animate={{opacity: 1, y: 0}}
          transition={{delay: 0.1, duration: 0.3}}
        >
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mb-0.5 sm:mb-1.5 max-w-full">
            <h1
              className="font-headline-lg sm:font-headline-xl text-headline-lg sm:text-headline-xl text-on-primary drop-shadow-md line-clamp-1 sm:line-clamp-2 break-words leading-tight"
              title={library.name}
            >
              {toTitleCase(library.name)}
            </h1>
            {role === 'viewer' && (
              <Badge
                variant="outline"
                size="sm"
                className="bg-surface-container-high/80 text-on-surface-variant backdrop-blur-sm shadow-sm"
              >
                Read-Only
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <p className="font-label-caps text-label-caps-sm sm:text-label-caps text-white/90">
              {books.length > 0 || library.bookCount === undefined
                ? `${books.length} ${books.length === 1 ? 'volume' : 'volumes'}`
                : `${library.bookCount} ${library.bookCount === 1 ? 'volume' : 'volumes'}`}
              {' • '}
              {isOwner
                ? 'Owned by you'
                : `Shared by ${toTitleCase(library.ownerName)}`}
            </p>
            {isSyncing && (
              <Badge
                variant="secondary"
                size="sm"
                className="flex items-center gap-1.5 text-secondary bg-surface/10 border-white/10 backdrop-blur-sm font-label-caps"
              >
                <CloudUpload className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                Syncing
              </Badge>
            )}
            {canEdit && onRefreshHero && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRefreshHero}
                disabled={isRefreshingHero}
                className="flex items-center justify-center text-white bg-white/15 hover:bg-white/25 active:bg-white/30 hover:text-white transition-colors w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/20 backdrop-blur-sm disabled:opacity-50 ml-auto sm:ml-4 shadow-sm"
                title={isRefreshingHero ? 'Refreshing...' : 'Refresh Banner'}
                aria-label="Refresh Banner"
              >
                <RefreshCw
                  className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${
                    isRefreshingHero ? 'animate-spin' : ''
                  }`}
                />
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
