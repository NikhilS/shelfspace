import React, {useRef} from 'react';
import {Star, StarHalf} from 'lucide-react';

interface StarRatingProps {
  rating: number;
  maxStars?: number;
  interactive?: boolean;
  onRatingChange?: (rating: number) => void;
  size?: 'sm' | 'lg';
}

export function StarRating({
  rating,
  maxStars = 5,
  interactive = false,
  onRatingChange,
  size = 'sm',
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

  const starClasses = size === 'sm' ? 'w-4 h-4' : 'w-8 h-8';

  return (
    <div className="flex items-center gap-1" ref={containerRef}>
      {Array.from({length: maxStars}).map((_, i) => {
        const starNum = i + 1;
        const isHalf = rating > starNum - 1 && rating < starNum;
        const isEmpty = rating <= starNum - 1;

        return (
          <div
            key={starNum}
            className={`relative ${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
            onClick={e => handleClick(e, starNum)}
          >
            {/* Empty base star */}
            <Star
              className={`${starClasses} text-outline/30 ${!isEmpty && !isHalf ? 'fill-secondary text-secondary' : 'fill-transparent'} hover:text-secondary/50`}
            />

            {/* Filled overlay (half) */}
            {isHalf && (
              <StarHalf
                className={`${starClasses} absolute top-0 left-0 fill-secondary text-secondary`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
