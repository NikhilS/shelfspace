import React, {useMemo} from 'react';

export interface GenreBreakdownBookItem {
  primaryGenre?: string | null;
}

export interface GenreBreakdownCardProps {
  books: GenreBreakdownBookItem[];
  eyebrow?: string;
  headerRight?: React.ReactNode;
  emptyMessage?: string;
  maxCategories?: number;
  onSelectGenre?: (genre: string) => void;
  className?: string;
}

export const GenreBreakdownCard: React.FC<GenreBreakdownCardProps> = ({
  books,
  eyebrow = 'Top Categories',
  headerRight,
  emptyMessage = 'No categories categorized yet.',
  maxCategories = 6,
  onSelectGenre,
  className = '',
}) => {
  const topCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    books.forEach(b => {
      if (b.primaryGenre) {
        counts[b.primaryGenre] = (counts[b.primaryGenre] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCategories)
      .map(([name, value]) => ({name, value}));
  }, [books, maxCategories]);

  return (
    <div
      className={`bento-card p-5 sm:p-6 flex flex-col min-w-0 h-full ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="metadata-eyebrow">{eyebrow}</p>
        {headerRight && (
          <span className="font-mono tabular-nums text-[11px] text-on-surface-variant">
            {headerRight}
          </span>
        )}
      </div>

      <div className="w-full flex-grow flex flex-col min-h-[160px]">
        {topCategories.length > 0 ? (
          <div className="flex flex-col gap-3 justify-center h-full pt-1">
            {topCategories.map(category => {
              const maxCount = Math.max(...topCategories.map(c => c.value));
              const widthPercent = Math.max(
                4,
                (category.value / maxCount) * 100,
              );

              return (
                <div
                  key={category.name}
                  className={`group flex flex-col gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md p-1 -m-1 ${
                    onSelectGenre ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onSelectGenre?.(category.name)}
                  role={onSelectGenre ? 'button' : undefined}
                  tabIndex={onSelectGenre ? 0 : undefined}
                  onKeyDown={e => {
                    if (onSelectGenre && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectGenre(category.name);
                    }
                  }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-sans font-semibold text-primary group-hover:text-primary transition-colors truncate pr-2">
                      {category.name || 'Uncategorized'}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-on-surface-variant group-hover:text-primary transition-colors uppercase tracking-wider flex-shrink-0 text-[11px]">
                      {category.value} {category.value === 1 ? 'vol' : 'vols'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/65 group-hover:bg-primary transition-colors duration-300"
                      style={{width: `${widthPercent}%`}}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center py-6 text-center">
            <p className="font-sans text-xs text-on-surface-variant italic">
              {emptyMessage}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
