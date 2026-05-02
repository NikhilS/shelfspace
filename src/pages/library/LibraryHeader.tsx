import React from 'react';
import {motion} from 'motion/react';
import {Library, Book} from '../../types';
import {toTitleCase} from '../../lib/utils';

interface LibraryHeaderProps {
  library: Library;
  books: Book[];
  isOwner: boolean;
}

export const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  library,
  books,
  isOwner,
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
          <h1 className="text-[48px] sm:text-[72px] font-serif font-medium tracking-[-0.03em] drop-shadow-md mb-2 leading-[0.95]">
            {toTitleCase(library.name)}
          </h1>
          <div className="flex items-center gap-3">
            <div className="w-[1px] h-4 bg-white/40" />
            <p className="text-[12px] sm:text-[14px] font-mono font-medium tracking-[0.15em] uppercase text-white/80">
              {books.length} {books.length === 1 ? 'volume' : 'volumes'} •{' '}
              {isOwner
                ? 'Owned by you'
                : `Shared by ${toTitleCase(library.ownerName)}`}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
