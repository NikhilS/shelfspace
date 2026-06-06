import React from 'react';
import {EyeOff, Loader2, Trash2, Layers} from 'lucide-react';
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
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/30 pb-3">
        <Layers className="w-5 h-5 text-secondary flex-shrink-0" />
        <h2 className="text-xl font-serif font-bold text-on-surface">
          Potentially Duplicate Books{' '}
          <span className="text-on-surface-variant font-sans text-sm font-normal tracking-wide ml-2">
            ({duplicates.length} groups found)
          </span>
        </h2>
      </div>

      {duplicates.length === 0 ? (
        <div className="text-center py-10 px-4 bg-surface-container/30 border border-outline-variant/20 rounded-xl">
          <p className="text-sm font-medium text-on-surface-variant/70 italic font-sans">
            No duplicate records detected. Your catalogs are clean and
            well-kept.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {duplicates.map((group, idx) => (
            <div
              key={idx}
              className="bg-[#faf7f0] border border-outline-variant/50 rounded-2xl p-6 shadow-[0_8px_30px_rgba(26,47,75,0.02)] border-l-4 border-l-secondary transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-3 border-b border-outline-variant/30">
                <div className="min-w-0">
                  <span className="sr-only">
                    Group {idx + 1}: {group[0].title}
                  </span>
                  <span
                    className="font-sans text-[10px] uppercase font-bold tracking-widest text-secondary block mb-1"
                    aria-hidden="true"
                  >
                    Group {idx + 1} • Duplicate Check
                  </span>
                  <h3
                    className="font-serif text-lg font-bold text-primary truncate leading-tight"
                    aria-hidden="true"
                  >
                    {group[0].title}
                  </h3>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleAllowDuplicateGroup(group)}
                  className="flex items-center justify-center gap-1.5 w-full sm:w-auto border-secondary/20 text-secondary hover:bg-[#ebd9bd]/10 hover:text-secondary font-bold text-xs"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Mark as Unique
                  <span className="sr-only">Ignore</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {group.map(b => (
                  <div
                    key={b.id}
                    className="bg-surface border border-outline-variant/40 hover:border-outline-variant/70 p-5 rounded-xl flex flex-col justify-between hover:shadow-[0_4px_20px_-4px_rgba(2,26,53,0.06)] transition-all duration-300"
                  >
                    <div>
                      <h4 className="font-serif font-semi-bold text-primary leading-tight text-base mb-1">
                        {b.title}
                      </h4>
                      <p className="text-xs font-semibold font-sans text-on-surface-variant mb-4">
                        by {b.author || 'Unknown Author'}
                      </p>

                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex px-2 py-0.5 rounded-sm text-[9px] font-bold bg-[#f3efe4] text-secondary uppercase tracking-widest border border-outline-variant/20">
                          {b.format || 'Physical'}
                        </span>
                      </div>

                      {b.isbn && (
                        <p className="text-[11px] font-mono text-on-surface-variant font-medium mt-2 bg-surface-container/50 px-2 py-1 rounded">
                          ISBN: {b.isbn}
                        </p>
                      )}

                      <div className="text-[11px] text-on-surface-variant/80 mt-3 font-sans space-y-1">
                        <div className="flex justify-between">
                          <span>Cover Art:</span>
                          <span
                            className={
                              b.coverUrl
                                ? 'text-success font-semibold'
                                : 'text-on-surface-variant/40'
                            }
                          >
                            {b.coverUrl ? 'Present' : 'None'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Synopsis:</span>
                          <span
                            className={
                              b.synopsis
                                ? 'text-success font-semibold'
                                : 'text-on-surface-variant/40'
                            }
                          >
                            {b.synopsis ? 'Present' : 'None'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(b.id)}
                      disabled={processingIds[b.id]}
                      className="mt-5 flex items-center justify-center gap-2 w-full bg-error/5 text-error hover:bg-error hover:text-white border border-error/10 hover:border-error text-xs font-bold transition-all duration-200"
                    >
                      {processingIds[b.id] ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
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
