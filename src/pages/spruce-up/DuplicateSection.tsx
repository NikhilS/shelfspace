import React from 'react';
import {EyeOff, Loader2, Trash2} from 'lucide-react';
import {Book} from '../../types';
import {Button} from '@/components/ui/button';

interface DuplicateSectionProps {
  duplicates: Book[][];
  processingIds: Record<string, boolean>;
  handleAllowDuplicateGroup: (group: Book[]) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export function DuplicateSection({
  duplicates,
  processingIds,
  handleAllowDuplicateGroup,
  handleDelete,
}: DuplicateSectionProps) {
  return (
    <section>
      <h2 className="text-xl font-bold text-on-surface mb-4">
        Potentially Duplicate Books{' '}
        <span className="text-on-surface-variant font-normal">
          ({duplicates.length})
        </span>
      </h2>
      {duplicates.length === 0 ? (
        <p className="text-on-surface-variant">
          No duplicates found. Looking good!
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {duplicates.map((group, idx) => (
            <div
              key={idx}
              className="bg-surface-container border border-outline-variant rounded-xl p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <h3 className="font-medium text-lg">
                  Group {idx + 1}: {group[0].title}
                </h3>
                <Button
                  variant="ghost"
                  onClick={() => handleAllowDuplicateGroup(group)}
                  className="flex items-center justify-center gap-1.5 w-full sm:w-auto"
                >
                  <EyeOff className="w-4 h-4" />
                  Ignore
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.map(b => (
                  <div
                    key={b.id}
                    className="bg-surface border border-outline-variant/50 p-4 rounded-lg flex flex-col justify-between"
                  >
                    <div>
                      <p className="font-bold">{b.title}</p>
                      <p className="text-sm text-on-surface-variant">
                        {b.author}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-primary-container text-on-primary-container uppercase tracking-wider">
                          {b.format || 'Physical'}
                        </span>
                      </div>
                      {b.isbn && (
                        <p className="text-xs text-on-surface-variant mt-2">
                          ISBN: {b.isbn}
                        </p>
                      )}
                      <p className="text-xs text-on-surface-variant mt-1 text-opacity-80 truncate">
                        Cover: {b.coverUrl ? 'Yes' : 'No'} | Synopsis:{' '}
                        {b.synopsis ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => handleDelete(b.id)}
                      disabled={processingIds[b.id]}
                      className="mt-4 flex items-center justify-center gap-2 w-full"
                    >
                      {processingIds[b.id] ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Delete This Duplicate
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
