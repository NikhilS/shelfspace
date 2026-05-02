import React, {useRef} from 'react';

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
            onMouseMove={undefined}
          >
            {/* Empty base star */}
            <svg
              className={`${starClasses} text-outline/30 fill-current hover:text-secondary/50`}
              viewBox="0 0 24 24"
            >
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>

            {/* Filled overlay (full or half) */}
            {!isEmpty && (
              <svg
                className={`${starClasses} absolute top-0 left-0 fill-secondary text-secondary`}
                viewBox="0 0 24 24"
                style={{
                  clipPath: isHalf ? 'inset(0 50% 0 0)' : 'none',
                }}
              >
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
