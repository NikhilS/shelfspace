import React from 'react';

export function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="bg-surface-container-low rounded-lg overflow-hidden border border-transparent shadow-[0_8px_30px_rgba(26,47,75,0.02)] flex flex-col h-full animate-pulse"
        >
          <div className="h-44 w-full bg-surface-variant/50"></div>
          <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
            <div className="h-6 bg-surface-variant/50 rounded w-2/3 mb-4"></div>
            <div className="flex items-center justify-between mt-6">
              <div className="h-4 bg-surface-variant/50 rounded w-1/4"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
