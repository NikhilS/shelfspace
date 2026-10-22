import React from 'react';
import {cn} from '@/lib/utils';

export interface SpotIllustrationProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * 1. NightstandBookIllustration
 * Open book resting on a bedside surface with a terracotta ribbon bookmark and warm reading lamp arc.
 */
export const NightstandBookIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 80 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-16 h-14 text-on-surface', className)}
    {...props}
  >
    {/* Subtle warm glow backdrop */}
    <ellipse
      cx="40"
      cy="46"
      rx="28"
      ry="8"
      className="fill-primary/8 dark:fill-primary/15"
    />
    {/* Bedside table surface line */}
    <path
      d="M10 48H70"
      stroke="currentColor"
      strokeOpacity="0.28"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Left open page */}
    <path
      d="M40 22C34 19.5 23 19.5 17 22V43C23 40.5 34 40.5 40 43V22Z"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Right open page */}
    <path
      d="M40 22C46 19.5 57 19.5 63 22V43C57 40.5 46 40.5 40 43V22Z"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Lower book board edges */}
    <path
      d="M15 44.5C22 42.2 33 42.2 40 44.8C47 42.2 58 42.2 65 44.5"
      stroke="currentColor"
      strokeOpacity="0.55"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Fine text lines on left page */}
    <path
      d="M22 27.5H34M22 31.5H35M22 35.5H31"
      stroke="currentColor"
      strokeOpacity="0.35"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    {/* Fine text lines on right page */}
    <path
      d="M46 27.5H58M46 31.5H56"
      stroke="currentColor"
      strokeOpacity="0.35"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    {/* Terracotta ribbon bookmark */}
    <path
      d="M40 22V52L43.5 49L47 52V37"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 2. BedsideStackIllustration
 * A tactile horizontal pile of three finished books with a tucked terracotta bookmark.
 */
export const BedsideStackIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 80 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-16 h-14 text-on-surface', className)}
    {...props}
  >
    <ellipse
      cx="40"
      cy="51"
      rx="28"
      ry="6"
      className="fill-primary/8 dark:fill-primary/15"
    />
    {/* Bottom book */}
    <rect
      x="16"
      y="40"
      width="48"
      height="9"
      rx="2.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M21 44.5H59"
      stroke="currentColor"
      strokeOpacity="0.3"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    {/* Middle book (slightly offset, terracotta tinted spine) */}
    <rect
      x="19"
      y="30"
      width="44"
      height="9"
      rx="2.5"
      className="fill-primary/12 stroke-primary"
      strokeWidth="1.5"
    />
    <path d="M25 30V39" className="stroke-primary" strokeWidth="1.4" />
    {/* Top book (slightly tilted/offset) */}
    <rect
      x="17"
      y="20"
      width="44"
      height="9"
      rx="2.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M22 24.5H55"
      stroke="currentColor"
      strokeOpacity="0.3"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    {/* Terracotta ribbon tail hanging from top book */}
    <path
      d="M50 20V14L53 16L56 14V20"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 3. BookshelfBookendsIllustration
 * Minimalist architectural shelf with upright & leaning volumes and a terracotta accent spine.
 */
export const BookshelfBookendsIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 88 68"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-20 h-16 text-on-surface', className)}
    {...props}
  >
    <ellipse
      cx="44"
      cy="54"
      rx="32"
      ry="6"
      className="fill-primary/8 dark:fill-primary/15"
    />
    {/* Left architectural bookend */}
    <path
      d="M16 50V34C16 30.6863 18.6863 28 22 28H24V50"
      className="fill-primary/12 stroke-primary"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Spine 1 (tall upright) */}
    <rect
      x="24"
      y="16"
      width="10"
      height="34"
      rx="1.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M26.5 22H31.5M26.5 44H31.5"
      stroke="currentColor"
      strokeOpacity="0.4"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    {/* Spine 2 (medium upright) */}
    <rect
      x="34"
      y="21"
      width="9"
      height="29"
      rx="1.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M36.5 26H40.5"
      className="stroke-primary"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Spine 3 (leaning volume with terracotta cover) */}
    <g transform="rotate(-14 46 50)">
      <rect
        x="45"
        y="19"
        width="10"
        height="31"
        rx="1.5"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.5"
      />
      <path
        d="M47.5 25H52.5M47.5 43H52.5"
        className="stroke-primary"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </g>
    {/* Shelfledge */}
    <path
      d="M10 50H78"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M16 53.5H72"
      stroke="currentColor"
      strokeOpacity="0.28"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * 4. ConstellationSkyIllustration
 * Delicate connected star nodes over an open page for the Constellation Map empty state.
 */
export const ConstellationSkyIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 88 68"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-20 h-16 text-on-surface', className)}
    {...props}
  >
    {/* Subtle orbital arc */}
    <path
      d="M14 46C22 22 66 22 74 46"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.3"
      strokeDasharray="3 3"
      strokeLinecap="round"
    />
    {/* Constellation connecting lines */}
    <path
      d="M24 38L38 22L54 28L66 16M38 22L44 42L54 28"
      stroke="currentColor"
      strokeOpacity="0.45"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Star nodes */}
    <circle
      cx="24"
      cy="38"
      r="3"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <circle
      cx="38"
      cy="22"
      r="3.8"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.6"
    />
    <circle
      cx="54"
      cy="28"
      r="3.2"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <circle
      cx="66"
      cy="16"
      r="2.8"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.5"
    />
    <circle
      cx="44"
      cy="42"
      r="2.8"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    {/* Open book silhouette at base */}
    <path
      d="M44 52C38 49.8 29 49.8 23 52V58C29 55.8 38 55.8 44 58C50 55.8 59 55.8 65 58V52C59 49.8 50 49.8 44 52Z"
      className="fill-surface stroke-current"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 5. ChronicleSundialIllustration
 * Meandering river bend and chronological arc for the Historical Timeline empty state.
 */
export const ChronicleSundialIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 88 68"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-20 h-16 text-on-surface', className)}
    {...props}
  >
    {/* Sundial / meridian arc */}
    <path
      d="M18 44C18 27.4315 30.536 14 46 14C61.464 14 74 27.4315 74 44"
      stroke="currentColor"
      strokeOpacity="0.28"
      strokeWidth="1.4"
      strokeDasharray="2.5 3"
      strokeLinecap="round"
    />
    {/* Meandering river path */}
    <path
      d="M46 16C34 22 56 30 42 38C28 46 58 50 44 58"
      className="stroke-primary"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M51 18C39 24 61 32 47 40C33 48 63 52 49 58"
      stroke="currentColor"
      strokeOpacity="0.35"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    {/* Epoch milestone markers along the bend */}
    <circle
      cx="43"
      cy="22"
      r="2.8"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <circle
      cx="44"
      cy="37"
      r="3.5"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.6"
    />
    <circle
      cx="45"
      cy="51"
      r="2.8"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * 6. CartographyCompassIllustration
 * Editorial compass rose and meridian lines for the World Map empty states.
 */
export const CartographyCompassIllustration: React.FC<
  SpotIllustrationProps
> = ({className, ...props}) => (
  <svg
    viewBox="0 0 80 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-16 h-14 text-on-surface', className)}
    {...props}
  >
    {/* Outer compass ring */}
    <circle
      cx="40"
      cy="32"
      r="21"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    {/* Inner latitude/longitude arcs */}
    <ellipse
      cx="40"
      cy="32"
      rx="10"
      ry="21"
      stroke="currentColor"
      strokeOpacity="0.22"
      strokeWidth="1.2"
    />
    <path
      d="M19 32H61"
      stroke="currentColor"
      strokeOpacity="0.22"
      strokeWidth="1.2"
    />
    {/* Compass needle diamond */}
    <path
      d="M40 15L44.5 32L40 49L35.5 32L40 15Z"
      className="fill-primary/15 stroke-primary"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle
      cx="40"
      cy="32"
      r="2.5"
      className="fill-surface stroke-primary"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * 7. MagnifyingBookmarkIllustration
 * A reading loupe resting over a page for zero-match search & filter states.
 */
export const MagnifyingBookmarkIllustration: React.FC<
  SpotIllustrationProps
> = ({className, ...props}) => (
  <svg
    viewBox="0 0 80 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-16 h-14 text-on-surface', className)}
    {...props}
  >
    {/* Page sheet */}
    <rect
      x="18"
      y="10"
      width="34"
      height="44"
      rx="3"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M24 20H44M24 26H40M24 32H36"
      stroke="currentColor"
      strokeOpacity="0.32"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    {/* Bookmark ribbon at top of page */}
    <path
      d="M41 10V20L44 17.5L47 20V10"
      className="fill-primary/20 stroke-primary"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    {/* Magnifying loupe */}
    <circle
      cx="48"
      cy="38"
      r="11"
      className="fill-surface stroke-primary"
      strokeWidth="1.6"
    />
    <circle cx="48" cy="38" r="7.5" className="fill-primary/10" />
    <path
      d="M56 46L63 53"
      className="stroke-primary"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * 8. TidyShelfCheckIllustration
 * Neatly aligned book spines with a terracotta check seal for Shelf Care caught-up states.
 */
export const TidyShelfCheckIllustration: React.FC<SpotIllustrationProps> = ({
  className,
  ...props
}) => (
  <svg
    viewBox="0 0 80 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn('w-16 h-14 text-on-surface', className)}
    {...props}
  >
    {/* Aligned spines */}
    <rect
      x="18"
      y="16"
      width="9"
      height="32"
      rx="1.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <rect
      x="29"
      y="19"
      width="9"
      height="29"
      rx="1.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <rect
      x="40"
      y="15"
      width="10"
      height="33"
      rx="1.5"
      className="fill-surface stroke-current"
      strokeWidth="1.5"
    />
    <path
      d="M13 48H62"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Warm check badge */}
    <circle
      cx="54"
      cy="38"
      r="10"
      className="fill-surface stroke-primary"
      strokeWidth="1.6"
    />
    <circle cx="54" cy="38" r="7.5" className="fill-primary/12" />
    <path
      d="M50.2 38.2L52.8 40.8L58 35.5"
      className="stroke-primary"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
