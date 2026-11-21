import React, {useMemo} from 'react';
import {Link} from 'react-router-dom';
import {Compass, ArrowRight} from 'lucide-react';
import {
  getVisualizersForScope,
  type VisualizerId,
} from '../../constants/visualizerDescriptors';
import {preloadRouteChunk} from '../../lib/routePreload';
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

function VisualizerWatermark({id}: {id: VisualizerId}) {
  switch (id) {
    case 'timeline':
      return (
        <svg
          className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/20 pointer-events-none group-hover:text-on-surface/32 transition-colors"
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
            className="stroke-tertiary/70"
          />
          <circle
            cx="76"
            cy="52"
            r="4.5"
            className="fill-tertiary/25 stroke-tertiary"
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
            className="fill-tertiary"
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
      );

    case 'worldMap':
      return (
        <svg
          className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/20 pointer-events-none group-hover:text-on-surface/32 transition-colors"
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
            className="fill-tertiary/8"
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
            className="fill-tertiary/25 stroke-tertiary"
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
      );

    case 'constellation':
      return (
        <svg
          className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/20 pointer-events-none group-hover:text-on-surface/32 transition-colors"
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
            className="fill-tertiary/25 stroke-tertiary"
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
            className="fill-tertiary/22 stroke-tertiary"
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
      );

    case 'readSwipe':
      return (
        <svg
          className="absolute -right-2 -bottom-2 w-36 h-20 text-on-surface/20 pointer-events-none group-hover:text-on-surface/32 transition-colors"
          viewBox="0 0 144 80"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
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
          <g transform="rotate(8 106 44)">
            <rect
              x="90"
              y="20"
              width="32"
              height="44"
              rx="3.5"
              className="fill-tertiary/15 stroke-tertiary"
              strokeWidth="1.6"
            />
            <line
              x1="96"
              y1="30"
              x2="114"
              y2="30"
              className="stroke-tertiary/65"
              strokeWidth="1.3"
            />
            <line
              x1="96"
              y1="35"
              x2="108"
              y2="35"
              className="stroke-tertiary/45"
              strokeWidth="1.2"
            />
            <circle
              cx="106"
              cy="49"
              r="7"
              className="fill-tertiary/25 stroke-tertiary"
              strokeWidth="1.5"
            />
            <path
              d="M102.8 49.2L105.1 51.5L109.5 46.8"
              className="stroke-tertiary"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <path
            d="M52 54C62 46 72 44 84 45"
            strokeDasharray="2.5 2.5"
            opacity="0.65"
          />
        </svg>
      );
  }
}

export function ExplorePerspectivesStrip({
  books,
  basePath,
  heading = 'Explore The Collection',
  subtitle = 'Explore your books across history, geography, and theme',
  ariaLabel = 'Explore Collection Visualizers',
  showReadSwipe,
}: ExplorePerspectivesStripProps) {
  const normalizedBase = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath;

  const isLibraryScope = normalizedBase.startsWith('/library/');
  const isReadSwipeVisible = showReadSwipe ?? isLibraryScope;

  const activeVisualizers = useMemo(() => {
    const descriptors = getVisualizersForScope(
      isLibraryScope ? 'library' : 'readingRoom',
      {showReadSwipe: isReadSwipeVisible},
    );
    return descriptors.map(descriptor => ({
      descriptor,
      readiness: descriptor.computeReadiness(books),
    }));
  }, [books, isLibraryScope, isReadSwipeVisible]);

  return (
    <section aria-label={ariaLabel}>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1.5 mb-4">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-tertiary stroke-[1.75]" />
          <h2 className="section-heading">{heading}</h2>
          <span className="hidden sm:inline-flex font-mono tabular-nums text-[11px] font-medium text-on-surface-variant ml-1">
            · {activeVisualizers.length} Perspectives
          </span>
        </div>
        <p className="hidden md:block font-sans text-xs text-on-surface-variant">
          {subtitle}
        </p>
      </div>

      <div
        className={
          activeVisualizers.length >= 4
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
            : 'grid grid-cols-1 md:grid-cols-3 gap-4'
        }
      >
        {activeVisualizers.map(({descriptor, readiness}) => (
          <Link
            key={descriptor.id}
            to={`${normalizedBase}${descriptor.routeSuffix}`}
            onMouseEnter={() => preloadRouteChunk(descriptor.preloadKey)}
            onFocus={() => preloadRouteChunk(descriptor.preloadKey)}
            onTouchStart={() => preloadRouteChunk(descriptor.preloadKey)}
            className="group relative flex flex-col justify-between p-4 sm:p-5 bento-card-interactive overflow-hidden"
          >
            <VisualizerWatermark id={descriptor.id} />

            <div className="relative z-10">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h3 className="font-serif text-base sm:text-lg font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                  {descriptor.title}
                </h3>
                <span
                  className={`font-mono text-[11px] font-medium text-on-surface-variant flex-shrink-0 whitespace-nowrap${descriptor.tabularBadge ? ' tabular-nums' : ''}`}
                >
                  {readiness.badgeLabel}
                </span>
              </div>
              <p
                className={`font-sans text-xs text-on-surface-variant line-clamp-1 leading-relaxed${descriptor.tabularSubtitle ? ' tabular-nums' : ''}`}
              >
                {readiness.subtitleText}
              </p>
            </div>

            <div className="relative z-10 mt-3.5 pt-2.5 border-t border-outline-variant/45 flex items-center justify-between text-xs font-sans font-semibold text-primary">
              <span className="group-hover:underline">
                {descriptor.ctaLabel}
              </span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
