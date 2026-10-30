import React, {useMemo} from 'react';
import {Link} from 'react-router-dom';
import {Compass, ArrowRight} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {preloadRouteChunk} from '../../lib/routePreload';
import {partitionUnreadSwipeBooks} from '../../pages/read-swipe/readSwipeMath';
import type {Book} from '../../types';

interface ExplorePerspectivesStripProps {
  books: Book[];
  basePath: string;
  heading?: string;
  subtitle?: string;
  ariaLabel?: string;
  showReadSwipe?: boolean;
  currentUserId?: string | null;
}

export function ExplorePerspectivesStrip({
  books,
  basePath,
  heading = 'Explore The Collection',
  subtitle = 'Explore your books across history, geography, and theme',
  ariaLabel = 'Explore Collection Visualizers',
  showReadSwipe,
}: ExplorePerspectivesStripProps) {
  const temporalBooksCount = useMemo(() => {
    return books.filter(
      b =>
        b.temporalMetadata?.startYear !== undefined ||
        (b.publishedDate && b.publishedDate.length >= 4),
    ).length;
  }, [books]);

  const geoLocationsCount = useMemo(() => {
    let count = 0;
    books.forEach(b => {
      if (b.geoMetadata?.locations?.length) {
        count += b.geoMetadata.locations.length;
      }
    });
    return count;
  }, [books]);

  const genreCount = useMemo(() => {
    const genres = new Set<string>();
    books.forEach(b => {
      if (b.primaryGenre) {
        genres.add(b.primaryGenre);
      }
    });
    return genres.size;
  }, [books]);

  const normalizedBase = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath;

  const isReadSwipeVisible =
    showReadSwipe ?? normalizedBase.startsWith('/library/');

  const swipePoolStats = useMemo(() => {
    if (!isReadSwipeVisible) {
      return {readyCount: 0, recentlyCheckedCount: 0};
    }
    const {readyBooks, recentlyCheckedBooks} = partitionUnreadSwipeBooks(books);
    return {
      readyCount: readyBooks.length,
      recentlyCheckedCount: recentlyCheckedBooks.length,
    };
  }, [books, isReadSwipeVisible]);

  return (
    <section aria-label={ariaLabel}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-3.5">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-primary stroke-[1.75]" />
          <h2 className="section-heading">{heading}</h2>
          <Badge
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex font-label-caps-sm text-label-caps-sm tracking-wider uppercase text-on-surface-variant/70 bg-surface-container-high/60 border-outline-variant/20"
          >
            {isReadSwipeVisible ? '4 Perspectives' : '3 Perspectives'}
          </Badge>
        </div>
        <p className="hidden md:block font-sans text-xs text-on-surface-variant">
          {subtitle}
        </p>
      </div>

      <div
        className={
          isReadSwipeVisible
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5'
            : 'grid grid-cols-1 md:grid-cols-3 gap-3.5'
        }
      >
        {/* Option 1: Timeline */}
        <Link
          to={`${normalizedBase}/timeline`}
          onMouseEnter={() => preloadRouteChunk('timeline')}
          onFocus={() => preloadRouteChunk('timeline')}
          onTouchStart={() => preloadRouteChunk('timeline')}
          className="group relative flex flex-col justify-between p-4 rounded-xl bg-surface border border-outline-variant/40 hover:border-outline shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
        >
          {/* Visual Watermark: Monoline Ink + Terracotta Chronological Axis */}
          <svg
            className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/22 pointer-events-none group-hover:text-on-surface/35 transition-colors"
            viewBox="0 0 144 80"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <line x1="8" y1="52" x2="136" y2="52" strokeDasharray="3 3" />
            <line x1="28" y1="42" x2="28" y2="62" />
            <circle
              cx="28"
              cy="52"
              r="3"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
            <line
              x1="76"
              y1="36"
              x2="76"
              y2="66"
              className="stroke-primary/60"
            />
            <circle
              cx="76"
              cy="52"
              r="4.5"
              className="fill-primary/20 stroke-primary"
              strokeWidth="1.6"
            />
            <line x1="120" y1="42" x2="120" y2="62" />
            <circle
              cx="120"
              cy="52"
              r="3"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
            <text
              x="28"
              y="74"
              fontSize="7.5"
              textAnchor="middle"
              fill="currentColor"
              stroke="none"
              fontFamily="monospace"
            >
              1850
            </text>
            <text
              x="76"
              y="75"
              fontSize="8"
              textAnchor="middle"
              fontWeight="bold"
              className="fill-primary"
              stroke="none"
              fontFamily="monospace"
            >
              1920
            </text>
            <text
              x="120"
              y="74"
              fontSize="7.5"
              textAnchor="middle"
              fill="currentColor"
              stroke="none"
              fontFamily="monospace"
            >
              2026
            </text>
          </svg>

          <div className="relative z-10">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h3 className="font-serif text-base font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                Historical Timeline
              </h3>
              <Badge
                variant="outline"
                size="sm"
                className="font-medium text-on-surface-variant bg-surface-container border-outline-variant/40 flex-shrink-0 whitespace-nowrap"
              >
                {temporalBooksCount > 0
                  ? `${temporalBooksCount} Charted`
                  : 'Chronology'}
              </Badge>
            </div>
            <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
              Historical eras &amp; publication years
            </p>
          </div>

          <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
            <span className="group-hover:underline">Open Timeline</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Option 2: World Map */}
        <Link
          to={`${normalizedBase}/map`}
          onMouseEnter={() => preloadRouteChunk('worldMap')}
          onFocus={() => preloadRouteChunk('worldMap')}
          onTouchStart={() => preloadRouteChunk('worldMap')}
          className="group relative flex flex-col justify-between p-4 rounded-xl bg-surface border border-outline-variant/40 hover:border-outline shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
        >
          {/* Visual Watermark: Monoline Ink + Terracotta Cartographic Globe */}
          <svg
            className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/22 pointer-events-none group-hover:text-on-surface/35 transition-colors"
            viewBox="0 0 144 80"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle
              cx="108"
              cy="46"
              r="30"
              className="fill-primary/8"
              strokeDasharray="2.5 3"
            />
            <ellipse
              cx="108"
              cy="46"
              rx="30"
              ry="13"
              strokeDasharray="3 3"
              opacity="0.7"
            />
            <line
              x1="108"
              y1="16"
              x2="108"
              y2="76"
              strokeDasharray="2 2"
              opacity="0.7"
            />
            <circle
              cx="98"
              cy="40"
              r="4"
              className="fill-primary/25 stroke-primary"
              strokeWidth="1.6"
            />
            <circle
              cx="118"
              cy="50"
              r="2.5"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
            <text
              x="40"
              y="68"
              fontSize="7.5"
              fill="currentColor"
              stroke="none"
              fontFamily="monospace"
              letterSpacing="0.05em"
            >
              41°N · 2°E
            </text>
          </svg>

          <div className="relative z-10">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h3 className="font-serif text-base font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                Literary World Map
              </h3>
              <Badge
                variant="outline"
                size="sm"
                className="font-medium text-on-surface-variant bg-surface-container border-outline-variant/40 flex-shrink-0 whitespace-nowrap"
              >
                {geoLocationsCount > 0
                  ? `${geoLocationsCount} Places`
                  : 'Cartography'}
              </Badge>
            </div>
            <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
              Story settings &amp; real-world places
            </p>
          </div>

          <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
            <span className="group-hover:underline">Open World Map</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Option 3: Constellation Map */}
        <Link
          to={`${normalizedBase}/constellation`}
          onMouseEnter={() => preloadRouteChunk('constellation')}
          onFocus={() => preloadRouteChunk('constellation')}
          onTouchStart={() => preloadRouteChunk('constellation')}
          className="group relative flex flex-col justify-between p-4 rounded-xl bg-surface border border-outline-variant/40 hover:border-outline shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
        >
          {/* Visual Watermark: Monoline Ink + Terracotta Stellar Cluster */}
          <svg
            className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/22 pointer-events-none group-hover:text-on-surface/35 transition-colors"
            viewBox="0 0 144 80"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <ellipse
              cx="92"
              cy="40"
              rx="36"
              ry="18"
              strokeDasharray="2 4"
              opacity="0.55"
            />
            <line x1="48" y1="58" x2="78" y2="34" strokeDasharray="3 2" />
            <line x1="78" y1="34" x2="114" y2="48" strokeDasharray="3 2" />
            <line x1="78" y1="34" x2="96" y2="18" strokeDasharray="3 2" />
            <line x1="114" y1="48" x2="132" y2="62" strokeDasharray="3 2" />
            <circle
              cx="48"
              cy="58"
              r="2.8"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
            <circle
              cx="78"
              cy="34"
              r="4.2"
              className="fill-primary/25 stroke-primary"
              strokeWidth="1.6"
            />
            <circle
              cx="96"
              cy="18"
              r="2.5"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
            <circle
              cx="114"
              cy="48"
              r="3.5"
              className="fill-primary/20 stroke-primary"
              strokeWidth="1.5"
            />
            <circle
              cx="132"
              cy="62"
              r="2.5"
              className="fill-surface stroke-current"
              strokeWidth="1.5"
            />
          </svg>

          <div className="relative z-10">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h3 className="font-serif text-base font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                Thematic Constellations
              </h3>
              <Badge
                variant="outline"
                size="sm"
                className="font-medium text-on-surface-variant bg-surface-container border-outline-variant/40 flex-shrink-0 whitespace-nowrap"
              >
                {genreCount > 0 ? `${genreCount} Genres` : '3D Galaxy'}
              </Badge>
            </div>
            <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug tabular-nums">
              {books.length < 3
                ? `Needs 3+ books (${books.length}/3) · Connected clusters by genre & theme`
                : 'Connected clusters by genre & theme'}
            </p>
          </div>

          <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
            <span className="group-hover:underline">Open Constellations</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Option 4: Have You Read It? (Swipe Deck) */}
        {isReadSwipeVisible && (
          <Link
            to={`${normalizedBase}/swipe`}
            onMouseEnter={() => preloadRouteChunk('readSwipe')}
            onFocus={() => preloadRouteChunk('readSwipe')}
            onTouchStart={() => preloadRouteChunk('readSwipe')}
            className="group relative flex flex-col justify-between p-4 rounded-xl bg-surface border border-outline-variant/40 hover:border-outline shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
          >
            {/* Visual Watermark: Monoline Ink + Terracotta Tilted Monograph Cards & Stamp */}
            <svg
              className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/22 pointer-events-none group-hover:text-on-surface/35 transition-colors"
              viewBox="0 0 144 80"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              {/* Back card in stack */}
              <rect
                x="76"
                y="24"
                width="32"
                height="44"
                rx="3.5"
                transform="rotate(-7 92 46)"
                className="fill-surface stroke-current"
                opacity="0.65"
              />
              {/* Top card swiping right */}
              <g transform="rotate(8 106 44)">
                <rect
                  x="90"
                  y="20"
                  width="32"
                  height="44"
                  rx="3.5"
                  className="fill-primary/15 stroke-primary"
                  strokeWidth="1.6"
                />
                <line
                  x1="96"
                  y1="30"
                  x2="114"
                  y2="30"
                  className="stroke-primary/60"
                  strokeWidth="1.3"
                />
                <line
                  x1="96"
                  y1="35"
                  x2="108"
                  y2="35"
                  className="stroke-primary/45"
                  strokeWidth="1.2"
                />
                {/* Checkmark stamp */}
                <circle
                  cx="106"
                  cy="49"
                  r="7"
                  className="fill-primary/25 stroke-primary"
                  strokeWidth="1.5"
                />
                <path
                  d="M102.8 49.2L105.1 51.5L109.5 46.8"
                  className="stroke-primary"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              {/* Motion arc */}
              <path
                d="M52 54C62 46 72 44 84 45"
                strokeDasharray="2.5 2.5"
                opacity="0.65"
              />
            </svg>

            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h3 className="font-serif text-base font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                  Have You Read It?
                </h3>
                <Badge
                  variant="outline"
                  size="sm"
                  className="font-medium text-on-surface-variant bg-surface-container border-outline-variant/40 flex-shrink-0 whitespace-nowrap tabular-nums"
                >
                  {swipePoolStats.readyCount > 0
                    ? `${swipePoolStats.readyCount} Unread`
                    : swipePoolStats.recentlyCheckedCount > 0
                      ? 'Checked Recently'
                      : 'All Sorted'}
                </Badge>
              </div>
              <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
                Swipe through unread books at random
              </p>
            </div>

            <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
              <span className="group-hover:underline">Start Swiping</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
