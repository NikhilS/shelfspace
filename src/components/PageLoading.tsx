import React from 'react';
import {motion} from 'motion/react';
import {Book as BookIcon} from 'lucide-react';
import SidebarActions from './SidebarActions';

interface PageLoadingProps {
  title?: string;
  subtitle?: string;
}

export function PageLoading({
  title = 'Opening the vaults...',
  subtitle = 'Fetching catalog, blowing off dust, and retrieving history.',
}: PageLoadingProps) {
  return (
    <>
      <SidebarActions>
        <></>
      </SidebarActions>
      <div className="flex-grow flex flex-col items-center justify-center min-h-[80vh] w-full bg-background relative overflow-hidden">
        <div className="flex flex-col items-center justify-center p-12 max-w-sm text-center">
          <div className="relative w-16 h-16 mb-8 flex items-center justify-center">
            <motion.div
              className="absolute inset-0 border-2 border-primary/20 rounded-full"
              animate={{scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5]}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <motion.div
              className="absolute inset-2 border-2 border-primary/40 rounded-full"
              animate={{scale: [1, 1.1, 1], opacity: [0.3, 0.8, 0.3]}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 0.2,
              }}
            />
            <BookIcon className="w-6 h-6 text-primary animate-pulse relative z-10" />
          </div>
          <h2 className="font-serif text-2xl font-medium text-primary mb-2 italic tracking-tight">
            {title}
          </h2>
          <p className="font-body-md text-on-surface-variant text-sm max-w-xs leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>
    </>
  );
}
