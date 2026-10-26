import React, {useState, useEffect, useCallback} from 'react';
import {MonographCoverFallback} from './MonographCoverFallback';

export interface ArchivalCoverImageProps {
  src?: string | null;
  alt: string;
  author?: string;
  publishedYear?: string | null;
  variant?: 'card' | 'compact' | 'detail';
  loading?: 'eager' | 'lazy';
  draggable?: boolean;
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  showSpineHighlight?: boolean;
}

export function ArchivalCoverImage({
  src,
  alt,
  author = '',
  publishedYear,
  variant = 'card',
  loading = 'lazy',
  draggable = true,
  className = '',
  imgClassName = '',
  fallbackClassName = 'w-full h-full',
  showSpineHighlight = true,
}: ArchivalCoverImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
  }, [src]);

  const handleImgRef = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, []);

  const showImage = Boolean(src) && !hasError;

  return (
    <div
      className={`relative overflow-hidden bg-surface-container ${className}`}
    >
      {showSpineHighlight && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 via-white/20 to-transparent z-10"
          aria-hidden="true"
        />
      )}

      {showImage ? (
        <img
          ref={handleImgRef}
          src={src!}
          alt={alt}
          draggable={draggable}
          loading={loading}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          className={`w-full h-full object-cover transition-[opacity,transform] duration-200 ease-out ${
            isLoaded ? 'opacity-100 scale-100' : 'opacity-95 scale-[0.995]'
          } ${imgClassName}`}
        />
      ) : (
        <MonographCoverFallback
          title={alt}
          author={author}
          publishedYear={publishedYear}
          variant={variant}
          className={fallbackClassName}
        />
      )}
    </div>
  );
}
