import React from 'react';
import {Link} from 'react-router-dom';
import {Book} from 'lucide-react';
import {motion} from 'motion/react';
import {Library} from '../../types';
import {toTitleCase} from '../../lib/utils';
import {useAuth} from '../../stores/authStore';

interface LibraryCardProps {
  lib: Library;
  index: number;
}

export function LibraryCard({lib, index}: LibraryCardProps) {
  const {user} = useAuth();

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{
        duration: 0.4,
        delay: index * 0.05,
        ease: 'easeOut',
      }}
      className="h-full"
    >
      <Link to={`/library/${lib.id}`} className="block h-full group">
        <div className="bg-surface-container-low rounded-lg overflow-hidden border border-transparent shadow-elevation-3 hover:shadow-elevation-3 hover:border-outline-variant/30 transition-all duration-300 flex flex-col h-full cursor-pointer">
          <div className="h-44 w-full overflow-hidden bg-surface-variant relative">
            {lib.heroImageUrl ? (
              <img
                alt={lib.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                src={lib.heroImageUrl}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surface-container">
                <Book className="w-12 h-12 text-on-surface-variant opacity-70 group-hover:scale-110 transition-transform duration-500" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/10 to-transparent mix-blend-multiply opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
            <div className="flex items-start justify-between">
              <h3 className="font-headline-md text-headline-md text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                {toTitleCase(lib.name)}
              </h3>
            </div>

            <div className="flex items-center justify-between mt-6">
              <div className="flex items-center gap-2 text-on-surface-variant flex-shrink-0">
                <Book className="w-4 h-4" />
                <span className="font-label-caps text-label-caps uppercase tracking-wider">
                  {lib.bookCount || 0} Volumes
                </span>
              </div>

              {lib.ownerId !== user?.uid && (
                <div className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant px-2 py-1 bg-surface-container rounded-sm border border-outline-variant/50 truncate max-w-[120px]">
                  By {toTitleCase(lib.ownerName)}
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
