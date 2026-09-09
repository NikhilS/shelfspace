import React, {useRef} from 'react';
import {Star, StarHalf} from 'lucide-react';
import {cn} from '@/lib/utils';

export interface StarRatingProps {
  rating: number;
  maxStars?: number;
  interactive?: boolean;
  onRatingChange?: (rating: number) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StarRating({
  rating,
  maxStars = 5,
  interactive = false,
  onRatingChange,
  size = 'sm',
  className,
}: StarRatingProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = (
    e: React.MouseEvent<HTMLDivElement>,
    starIndex: number,
  ) => {
    if (!interactive || !onRatingChange) return;

    // Get click position relative to the star
    const starElement = e.currentTarget.getBoundingClientRect();
    const clickPos = e.clientX - starElement.left;
    const isHalf = clickPos < starElement.width / 2;

    const newRating = starIndex - (isHalf ? 0.5 : 0);
    onRatingChange(newRating);
  };

  const starClasses =
    size === 'lg' ? 'w-8 h-8' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div
      className={cn('flex items-center gap-1 select-none', className)}
      ref={containerRef}
    >
      {Array.from({length: maxStars}).map((_, i) => {
        const starNum = i + 1;
        const isHalf = rating > starNum - 1 && rating < starNum;
        const isEmpty = rating <= starNum - 1;

        return (
          <div
            key={starNum}
            className={cn(
              'relative',
              interactive &&
                'cursor-pointer hover:scale-110 transition-transform',
            )}
            onClick={e => handleClick(e, starNum)}
          >
            {/* Empty base star */}
            <Star
              className={cn(
                starClasses,
                'text-outline/30',
                !isEmpty && !isHalf
                  ? 'fill-secondary text-secondary'
                  : 'fill-transparent',
                interactive && 'hover:text-secondary/50',
              )}
            />

            {/* Filled overlay (half) */}
            {isHalf && (
              <StarHalf
                className={cn(
                  starClasses,
                  'absolute top-0 left-0 fill-secondary text-secondary',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
