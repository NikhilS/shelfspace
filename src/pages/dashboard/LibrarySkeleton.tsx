import React from 'react';

export function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="bg-surface-container-low rounded-lg overflow-hidden border border-outline-variant/30 shadow-elevation-1 flex flex-col h-full animate-pulse"
        >
          <div className="h-44 w-full bg-surface-variant/40" />
          <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
            <div className="h-7 bg-surface-variant/50 rounded w-2/3 mb-6" />
            <div className="flex items-center justify-between mt-auto pt-2">
              <div className="h-4 bg-surface-variant/40 rounded w-24" />
              <div className="h-5 bg-surface-variant/30 rounded-sm w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
