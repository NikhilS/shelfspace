import React from 'react';
import {motion} from 'motion/react';
import {Book as BookIcon} from 'lucide-react';

interface BookLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function BookLoader({size = 'md', className = ''}: BookLoaderProps) {
  const sizeClasses = {
    sm: {
      container: 'w-8 h-8',
      icon: 'w-3 h-3',
      border1: 'border',
      border2: 'border',
      inset1: 'absolute inset-0',
      inset2: 'absolute inset-0.5',
    },
    md: {
      container: 'w-12 h-12',
      icon: 'w-4 h-4',
      border1: 'border-2',
      border2: 'border-2',
      inset1: 'absolute inset-0',
      inset2: 'absolute inset-1.5',
    },
    lg: {
      container: 'w-16 h-16',
      icon: 'w-6 h-6',
      border1: 'border-2',
      border2: 'border-2',
      inset1: 'absolute inset-0',
      inset2: 'absolute inset-2',
    },
  };

  const config = sizeClasses[size] || sizeClasses.md;

  return (
    <div
      className={`relative ${config.container} flex items-center justify-center ${className}`}
    >
      <motion.div
        className={`${config.inset1} ${config.border1} border-primary/20 rounded-full`}
        animate={{scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5]}}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      <motion.div
        className={`${config.inset2} ${config.border2} border-primary/40 rounded-full`}
        animate={{scale: [1, 1.1, 1], opacity: [0.3, 0.8, 0.3]}}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.2,
        }}
      />
      <BookIcon
        className={`${config.icon} text-primary animate-pulse relative z-10`}
      />
    </div>
  );
}
