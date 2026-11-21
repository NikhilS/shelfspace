import React from 'react';

interface ArchivalWorldMapSvgProps {
  className?: string;
}

/**
 * Equirectangular archival vector world map (lng -180°..+180°, lat +80°..-60°).
 * Coordinate transform matches WorldMapCanvas pin projection:
 *   x = ((lng + 180) / 360) * 1000
 *   y = ((80 - lat) / 140) * 500
 */
export function ArchivalWorldMapSvg({
  className = '',
}: ArchivalWorldMapSvgProps) {
  return (
    <svg
      viewBox="0 0 1000 500"
      preserveAspectRatio="none"
      className={`pointer-events-none select-none ${className}`}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="archival-ocean-hatch"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx="12"
            cy="12"
            r="0.55"
            className="fill-on-surface/[0.08] dark:fill-on-surface/[0.1]"
          />
        </pattern>
      </defs>

      {/* Subtle archival ocean stipple */}
      <rect width="1000" height="500" fill="url(#archival-ocean-hatch)" />

      {/* 30° Longitude Meridians (-150° to +150°) */}
      <g
        className="stroke-outline-variant/45 dark:stroke-outline-variant/55"
        strokeWidth="0.65"
      >
        {[83, 167, 250, 333, 417, 583, 667, 750, 833, 917].map(x => (
          <line key={`meridian-${x}`} x1={x} y1="0" x2={x} y2="500" />
        ))}
        {/* 30° Latitude Parallels (60°N, 30°N, 30°S) */}
        {[71, 179, 393].map(y => (
          <line key={`parallel-${y}`} x1="0" y1={y} x2="1000" y2={y} />
        ))}
      </g>

      {/* Tropics of Cancer (23.5°N) & Capricorn (23.5°S) */}
      <g
        className="stroke-tertiary/25 dark:stroke-tertiary/30"
        strokeWidth="0.7"
        strokeDasharray="2 5"
      >
        <line x1="0" y1="202" x2="1000" y2="202" />
        <line x1="0" y1="370" x2="1000" y2="370" />
      </g>

      {/* Prime Meridian (0°) & Equator (0°) */}
      <g
        className="stroke-on-surface/22 dark:stroke-on-surface/26"
        strokeWidth="0.85"
        strokeDasharray="4 4"
      >
        <line x1="500" y1="0" x2="500" y2="500" />
        <line x1="0" y1="286" x2="1000" y2="286" />
      </g>

      {/* Continental Landmasses (Dual-tone Archival Parchment / Espresso + Ink Coastlines) */}
      <g
        className="fill-primary/[0.08] dark:fill-primary/[0.09] stroke-primary/35 dark:stroke-primary/40"
        strokeWidth="1.05"
        strokeLinejoin="round"
      >
        {/* North America & Central America */}
        <path d="M 39 54 L 69 32 L 128 34 L 181 36 L 235 44 L 278 40 L 306 43 L 315 65 L 272 79 L 288 94 L 344 96 L 336 114 L 322 125 L 294 139 L 286 164 L 275 196 L 266 194 L 254 182 L 236 186 L 235 206 L 256 211 L 263 232 L 281 254 L 270 256 L 245 236 L 208 214 L 189 193 L 178 172 L 161 150 L 156 114 L 134 90 L 106 74 L 83 68 L 56 68 Z" />

        {/* Caribbean & Cuba */}
        <path d="M 268 206 L 288 210 L 296 215 L 274 214 Z" />

        {/* Greenland */}
        <path d="M 353 36 L 403 9 L 448 22 L 444 38 L 412 58 L 378 71 L 362 56 Z" />

        {/* Iceland */}
        <path d="M 439 54 L 461 52 L 463 60 L 441 61 Z" />

        {/* South America */}
        <path d="M 282 254 L 305 245 L 328 250 L 364 286 L 403 307 L 396 342 L 381 368 L 356 394 L 339 411 L 324 448 L 311 482 L 298 474 L 294 446 L 303 404 L 306 350 L 275 304 L 278 282 Z" />

        {/* Great Britain & Ireland */}
        <path d="M 486 107 L 489 84 L 496 79 L 504 100 L 496 109 Z" />
        <path d="M 473 100 L 478 90 L 483 94 L 479 103 Z" />

        {/* Europe & Mainland Eurasia */}
        <path d="M 475 146 L 476 132 L 488 114 L 504 108 L 514 96 L 525 82 L 514 68 L 536 44 L 572 32 L 611 46 L 642 42 L 694 29 L 758 24 L 792 16 L 856 28 L 928 36 L 972 50 L 958 68 L 944 100 L 934 96 L 932 76 L 889 93 L 872 126 L 858 161 L 848 158 L 846 142 L 836 146 L 839 175 L 817 207 L 803 243 L 791 252 L 786 279 L 779 276 L 776 242 L 761 221 L 744 207 L 728 232 L 715 257 L 703 218 L 686 196 L 656 193 L 664 207 L 646 228 L 622 239 L 610 222 L 594 186 L 597 168 L 575 150 L 564 156 L 556 144 L 544 148 L 533 136 L 517 132 L 506 139 L 495 154 L 485 157 Z" />

        {/* Sri Lanka */}
        <path d="M 720 261 L 725 263 L 723 271 L 718 268 Z" />

        {/* Africa */}
        <path d="M 483 157 L 508 154 L 528 154 L 548 168 L 590 179 L 608 216 L 624 244 L 642 246 L 626 278 L 608 311 L 604 348 L 592 379 L 568 402 L 551 407 L 540 382 L 533 338 L 533 307 L 511 268 L 482 269 L 458 250 L 453 232 L 463 196 Z" />

        {/* Madagascar */}
        <path d="M 626 346 L 639 332 L 636 364 L 624 375 L 621 360 Z" />

        {/* Japan */}
        <path d="M 892 126 L 903 132 L 896 146 L 887 162 L 866 171 L 863 164 L 882 152 Z" />

        {/* Maritime Southeast Asia (Sumatra, Java, Borneo, Sulawesi, Philippines, New Guinea) */}
        <path d="M 767 268 L 792 302 L 785 306 L 761 274 Z" />
        <path d="M 795 309 L 821 314 L 819 319 L 793 314 Z" />
        <path d="M 806 286 L 824 268 L 832 284 L 818 297 L 805 295 Z" />
        <path d="M 836 226 L 845 242 L 847 261 L 838 258 L 833 238 Z" />
        <path d="M 872 296 L 902 302 L 917 318 L 896 320 L 874 308 Z" />

        {/* Australia & Tasmania */}
        <path d="M 819 400 L 818 372 L 839 350 L 864 329 L 880 338 L 896 325 L 914 356 L 925 382 L 917 418 L 896 420 L 883 411 L 856 400 L 834 405 Z" />
        <path d="M 902 431 L 910 431 L 908 439 L 901 438 Z" />

        {/* New Zealand */}
        <path d="M 982 418 L 991 426 L 972 454 L 964 449 Z" />
      </g>

      {/* Subtle Terracotta Coastal Accent Stipple on Major Literary Hubs */}
      <g
        className="stroke-tertiary/20 dark:stroke-tertiary/25 fill-none"
        strokeWidth="0.6"
      >
        <circle cx="500" cy="286" r="3" />
      </g>

      {/* Cartographic Graticule Labels */}
      <g className="fill-on-surface-variant/55 font-mono text-[8.5px] uppercase tracking-[0.18em]">
        <text x="14" y="281">
          Equator · 0°
        </text>
        <text x="506" y="488">
          Prime Meridian · 0°
        </text>
        <text x="14" y="198" className="fill-tertiary/55">
          23.5°N
        </text>
        <text x="14" y="366" className="fill-tertiary/55">
          23.5°S
        </text>
      </g>

      {/* Engraved Dual-Tone Compass Rose (South Pacific Cartouche) */}
      <g transform="translate(96, 412)">
        <circle
          cx="0"
          cy="0"
          r="26"
          className="fill-surface/50 stroke-outline-variant/65"
          strokeWidth="0.85"
        />
        <circle
          cx="0"
          cy="0"
          r="21"
          className="fill-none stroke-outline-variant/45"
          strokeWidth="0.65"
          strokeDasharray="2 2"
        />
        {/* Cardinal Star */}
        <polygon
          points="0,-19 4,-4 0,0 -4,-4"
          className="fill-tertiary/85 stroke-tertiary"
          strokeWidth="0.6"
        />
        <polygon
          points="0,19 4,4 0,0 -4,4"
          className="fill-on-surface/25 stroke-on-surface/55"
          strokeWidth="0.6"
        />
        <polygon
          points="19,0 4,4 0,0 4,-4"
          className="fill-on-surface/20 stroke-on-surface/50"
          strokeWidth="0.6"
        />
        <polygon
          points="-19,0 -4,4 0,0 -4,-4"
          className="fill-on-surface/20 stroke-on-surface/50"
          strokeWidth="0.6"
        />
        <circle cx="0" cy="0" r="2" className="fill-tertiary" />
        <text
          x="0"
          y="-29"
          textAnchor="middle"
          className="fill-tertiary font-mono text-[8px] font-semibold tracking-widest"
        >
          N
        </text>
      </g>
    </svg>
  );
}
