import React from 'react';
import {motion} from 'motion/react';
import {cn} from '@/lib/utils';
import {ArchivalBookLoaderIllustration} from './empty-state-illustrations';

export interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  icon?: React.ReactNode;
}

export function Loader({size = 'md', className, icon}: LoaderProps) {
  const sizeClasses = {
    sm: {
      container: 'w-10 h-9',
      illustration: 'w-10 h-9',
    },
    md: {
      container: 'w-14 h-12',
      illustration: 'w-14 h-12',
    },
    lg: {
      container: 'w-20 h-16',
      illustration: 'w-20 h-16',
    },
  };

  const config = sizeClasses[size] || sizeClasses.md;

  return (
    <motion.div
      animate={{y: [0, -2, 0]}}
      transition={{
        duration: 2.2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      className={cn(
        'relative flex items-center justify-center select-none',
        config.container,
        className,
      )}
    >
      {icon ? (
        <div className="relative z-10 text-primary">{icon}</div>
      ) : (
        <ArchivalBookLoaderIllustration className={config.illustration} />
      )}
    </motion.div>
  );
}

// Named alias for domain consistency
export const BookLoader = Loader;
export type BookLoaderProps = LoaderProps;
