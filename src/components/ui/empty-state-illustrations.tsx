import React from 'react';
import {cn} from '@/lib/utils';

export interface SpotIllustrationProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * 1. NightstandBookIllustration
 * Open book resting on a bedside surface with a terracotta ribbon bookmark and warm reading lamp arc.
 */
export function NightstandBookIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 2. BedsideStackIllustration
 * A tactile horizontal pile of three finished books with a tucked terracotta bookmark.
 */
export function BedsideStackIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 3. BookshelfBookendsIllustration
 * Minimalist architectural shelf with upright & leaning volumes and a terracotta accent spine.
 */
export function BookshelfBookendsIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 4. ConstellationSkyIllustration
 * Delicate connected star nodes over an open page for the Constellation Map empty state.
 */
export function ConstellationSkyIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 5. ChronicleSundialIllustration
 * Meandering river bend and chronological arc for the Historical Timeline empty state.
 */
export function ChronicleSundialIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 6. CartographyCompassIllustration
 * Editorial compass rose and meridian lines for the World Map empty states.
 */
export function CartographyCompassIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 7. MagnifyingBookmarkIllustration
 * A reading loupe resting over a page for zero-match search & filter states.
 */
export function MagnifyingBookmarkIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 8. TidyShelfCheckIllustration
 * Neatly aligned book spines with a terracotta check seal for Shelf Care caught-up states.
 */
export function TidyShelfCheckIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
}

/**
 * 9. ArchivalLedgerImportIllustration
 * Open archival catalog ledger / index card tray with an incoming catalog card and terracotta ribbon accent.
 * Used on CSV Bulk Import dropzones.
 */
export function ArchivalLedgerImportIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
    <svg
      viewBox="0 0 88 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('w-20 h-16 text-on-surface', className)}
      {...props}
    >
      {/* Warm shadow ellipse */}
      <ellipse
        cx="44"
        cy="56"
        rx="30"
        ry="6"
        className="fill-primary/8 dark:fill-primary/15"
      />
      {/* Archival card tray base */}
      <rect
        x="16"
        y="34"
        width="56"
        height="19"
        rx="3"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
      />
      {/* Brass label holder on front of tray */}
      <rect
        x="34"
        y="40"
        width="20"
        height="7"
        rx="1.5"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.4"
      />
      <path
        d="M38 43.5H50"
        className="stroke-primary"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Back index card tab */}
      <path
        d="M22 34V24C22 22.8954 22.8954 22 24 22H36L39 25H64C65.1046 25 66 25.8954 66 27V34"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Incoming featured catalog card (terracotta accented) */}
      <rect
        x="27"
        y="12"
        width="34"
        height="22"
        rx="2.5"
        className="fill-surface stroke-primary"
        strokeWidth="1.5"
      />
      <rect
        x="27"
        y="12"
        width="34"
        height="5"
        rx="1.5"
        className="fill-primary/15"
      />
      {/* Ruled catalog lines on incoming card */}
      <path
        d="M32 21H52M32 25.5H46M32 30H42"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Downward archival accession arrow */}
      <path
        d="M54 20V28M54 28L51.5 25.5M54 28L56.5 25.5"
        className="stroke-primary"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 10. ShelfViewfinderIllustration
 * Monoline hardcover book spines framed inside brass/terracotta optical viewfinder corner brackets.
 * Used for CameraScanner idle, AI-plan notice, and active optical extraction states.
 */
export function ShelfViewfinderIllustration({
  className,
  scanning = false,
  ...props
}: SpotIllustrationProps & {scanning?: boolean}) {
  return (
    <svg
      viewBox="0 0 88 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('w-20 h-16 text-on-surface', className)}
      {...props}
    >
      {/* Soft warm backdrop */}
      <ellipse
        cx="44"
        cy="55"
        rx="28"
        ry="5.5"
        className="fill-primary/8 dark:fill-primary/15"
      />
      {/* Optical viewfinder corner brackets in terracotta */}
      <path
        d="M14 22V15C14 13.8954 14.8954 13 16 13H23M65 13H72C73.1046 13 74 13.8954 74 15V22M74 44V51C74 52.1046 73.1046 53 72 53H65M23 53H16C14.8954 53 14 52.1046 14 51V44"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Shelf base line inside frame */}
      <path
        d="M22 47H66"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Book spine 1 */}
      <rect
        x="26"
        y="21"
        width="9"
        height="26"
        rx="1.5"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
      />
      <path
        d="M28.5 26H32.5"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Book spine 2 (terracotta highlighted focal volume) */}
      <rect
        x="37"
        y="18"
        width="10"
        height="29"
        rx="1.5"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.5"
      />
      <path
        d="M39.5 23H44.5M39.5 41H44.5"
        className="stroke-primary"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Book spine 3 (leaning volume) */}
      <g transform="rotate(-10 50 47)">
        <rect
          x="49"
          y="22"
          width="9"
          height="25"
          rx="1.5"
          className="fill-surface stroke-current"
          strokeWidth="1.5"
        />
        <path
          d="M51.5 27H55.5"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
      {/* Optical reticle / scanning line */}
      {scanning ? (
        <line
          x1="18"
          y1="33"
          x2="70"
          y2="33"
          className="stroke-primary animate-pulse"
          strokeWidth="1.6"
          strokeDasharray="3 2.5"
          strokeLinecap="round"
        />
      ) : (
        <circle
          cx="42"
          cy="32"
          r="2"
          className="fill-primary/25 stroke-primary"
          strokeWidth="1.3"
        />
      )}
    </svg>
  );
}

/**
 * 11. ExLibrisStampIllustration
 * Archival bookplate seal with a four-point terracotta star and monoline frame.
 * Used for CuratorPickCard empty/unavailable states and corner watermark.
 */
export function ExLibrisStampIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
    <svg
      viewBox="0 0 80 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('w-16 h-14 text-on-surface', className)}
      {...props}
    >
      {/* Soft warm base glow */}
      <ellipse
        cx="40"
        cy="52"
        rx="24"
        ry="5"
        className="fill-primary/8 dark:fill-primary/15"
      />
      {/* Outer archival bookplate frame */}
      <rect
        x="20"
        y="9"
        width="40"
        height="46"
        rx="4"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
      />
      {/* Inner inset hairline border */}
      <rect
        x="24"
        y="13"
        width="32"
        height="38"
        rx="2"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.2"
      />
      {/* Central four-point compass/curator star in terracotta */}
      <path
        d="M40 19L42.6 26.4L50 29L42.6 31.6L40 39L37.4 31.6L30 29L37.4 26.4L40 19Z"
        className="fill-primary/18 stroke-primary"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Ex Libris rule lines at bottom of stamp */}
      <path
        d="M29 44H51M33 47.5H47"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 12. FallenBookendIllustration
 * A stack/row of books where one volume has gently tipped on the shelf with a terracotta bookmark.
 * Used for ErrorBoundary and Dashboard catalog error states.
 */
export function FallenBookendIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
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
        ry="5.5"
        className="fill-primary/8 dark:fill-primary/15"
      />
      {/* Upright spine 1 */}
      <rect
        x="18"
        y="18"
        width="10"
        height="32"
        rx="1.5"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
      />
      <path
        d="M20.5 24H25.5"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Upright spine 2 */}
      <rect
        x="29"
        y="21"
        width="9"
        height="29"
        rx="1.5"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
      />
      {/* Tipped / fallen volume resting diagonally */}
      <g transform="rotate(62 52 43)">
        <rect
          x="45"
          y="22"
          width="10"
          height="30"
          rx="1.5"
          className="fill-primary/15 stroke-primary"
          strokeWidth="1.5"
        />
        <path
          d="M47.5 28H52.5M47.5 45H52.5"
          className="stroke-primary"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
      {/* Slipped terracotta bookmark ribbon */}
      <path
        d="M64 44C67 44 69 46.5 68 50L71 48.5L73 51"
        className="stroke-primary"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Shelf line */}
      <path
        d="M12 50H76"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 13. ArchivalBookLoaderIllustration
 * Animated monoline open-book motif with terracotta bookmark for loading states.
 */
export function ArchivalBookLoaderIllustration({
  className,
  ...props
}: SpotIllustrationProps) {
  return (
    <svg
      viewBox="0 0 64 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('w-12 h-10 text-on-surface', className)}
      {...props}
    >
      <ellipse
        cx="32"
        cy="42"
        rx="20"
        ry="4.5"
        className="fill-primary/10 dark:fill-primary/18"
      />
      {/* Left open page */}
      <path
        d="M32 15C27 13 18 13 13 15V34C18 32 27 32 32 34V15Z"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Right open page */}
      <path
        d="M32 15C37 13 46 13 51 15V34C46 32 37 32 32 34V15Z"
        className="fill-surface stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Turning leaf in terracotta */}
      <path
        d="M32 15C35.5 11.5 43 11.5 47 13.5V31.5C43 29.5 35.5 30 32 34V15Z"
        className="fill-primary/15 stroke-primary animate-pulse"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Terracotta ribbon bookmark */}
      <path
        d="M32 15V41L35 38.5L38 41V31"
        className="fill-primary/20 stroke-primary"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Canonical Evergreen Spec Aliases (Section 6 of 01-DESIGN-SYSTEM-AND-UI.md)
 */
export const OpenBookBookmarkIllustration = NightstandBookIllustration;
export const BookStackTeaIllustration = BedsideStackIllustration;
export const CompassGlobeIllustration = CartographyCompassIllustration;
