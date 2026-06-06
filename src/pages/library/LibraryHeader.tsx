import React from 'react';
import {motion} from 'motion/react';
import {Library, Book} from '../../types';
import {toTitleCase} from '../../lib/utils';
import {CloudUpload, RefreshCw} from 'lucide-react';

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
      className={`w-full h-[280px] sm:h-[400px] relative overflow-hidden flex items-end ${!library.heroImageUrl ? 'bg-[#021a35]' : ''}`}
    >
      {library.heroImageUrl && (
        <img
          src={library.heroImageUrl}
          alt={library.name}
          className="w-full h-full object-cover absolute inset-0"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#021a35] via-[#021a35]/40 to-transparent opacity-90" />
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 sm:px-10 pb-10 sm:pb-16 text-white translate-y-4">
        <motion.div
          initial={{opacity: 0, y: 10}}
          animate={{opacity: 1, y: 0}}
          transition={{delay: 0.1, duration: 0.5}}
        >
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-headline-xl sm:text-headline-2xl font-headline-xl text-on-primary drop-shadow-md">
              {toTitleCase(library.name)}
            </h1>
            {role === 'viewer' && (
              <span className="font-label-caps text-[10px] tracking-wider uppercase bg-surface-container-high/80 text-on-surface-variant px-2 py-1 flex items-center justify-center rounded border border-outline-variant/30 backdrop-blur-sm shadow-sm inline-flex">
                Read-Only
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-[1px] h-4 bg-white/40 hidden sm:block" />
            <p className="font-label-caps text-label-caps text-white/80">
              {books.length} {books.length === 1 ? 'volume' : 'volumes'} •{' '}
              {isOwner
                ? 'Owned by you'
                : `Shared by ${toTitleCase(library.ownerName)}`}
            </p>
            {isSyncing && (
              <span className="flex items-center gap-1.5 font-label-caps text-label-caps text-secondary bg-surface/10 px-2 py-0.5 rounded-full border border-white/10 backdrop-blur-sm">
                <CloudUpload className="w-3.5 h-3.5" />
                Syncing
              </span>
            )}
            {canEdit && onRefreshHero && (
              <button
                onClick={onRefreshHero}
                disabled={isRefreshingHero}
                className="flex items-center justify-center text-white bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-2 rounded-lg border border-white/15 backdrop-blur-sm disabled:opacity-50 cursor-pointer ml-auto sm:ml-4 shadow-sm"
                title={isRefreshingHero ? 'Refreshing...' : 'Refresh Banner'}
                aria-label="Refresh Banner"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isRefreshingHero ? 'animate-spin' : ''
                  }`}
                />
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
