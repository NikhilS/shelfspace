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
      className={`w-full min-h-[110px] sm:min-h-[180px] md:min-h-[220px] relative overflow-hidden flex flex-col justify-between transition-all duration-300 border-b border-outline-variant/50 ${
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />

      {/* Top Bar: Back to All Libraries Navigation */}
      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-label-caps-sm text-label-caps-sm sm:text-xs font-sans font-medium text-white/95 hover:text-white bg-black/40 hover:bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg transition-all border border-white/15 shadow-xs"
        >
          <ArrowLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>All Libraries</span>
        </Link>
      </div>

      {/* Bottom Title & Curatorial Metadata */}
      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-3 sm:pb-5 md:pb-6 text-white mt-auto">
        <motion.div
          initial={{opacity: 0, y: 6}}
          animate={{opacity: 1, y: 0}}
          transition={{delay: 0.05, duration: 0.25}}
        >
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1 sm:mb-2 max-w-full">
            <h1
              className="font-serif text-2xl sm:text-4xl font-semibold tracking-tight text-white drop-shadow-sm line-clamp-1 sm:line-clamp-2 break-words leading-tight"
              title={library.name}
            >
              {toTitleCase(library.name)}
            </h1>
            {role === 'viewer' && (
              <Badge
                variant="outline"
                size="sm"
                className="bg-white/15 text-white border-white/25 backdrop-blur-sm shadow-2xs"
              >
                Read-Only
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <p className="font-mono tabular-nums text-label-caps-sm sm:text-label-caps uppercase tracking-wider text-white/90">
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
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5 text-white bg-white/15 border-white/25 backdrop-blur-sm font-label-caps"
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
                className="flex items-center justify-center text-white bg-white/15 hover:bg-white/25 active:bg-white/30 hover:text-white transition-colors w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/20 backdrop-blur-sm disabled:opacity-50 ml-auto sm:ml-4 shadow-xs"
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
