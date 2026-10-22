import React, {useState} from 'react';
import {EyeOff, Loader2, Trash2, GitMerge} from 'lucide-react';
import {Book} from '../../types';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {TidyShelfCheckIllustration} from '@/components/ui/empty-state-illustrations';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import {formatFirestoreDate} from '../../lib/date';
import {DuplicateGroupMetadata} from '../../lib/duplicateDetection';
import {
  DuplicateMergeModal,
  DuplicateMergePayload,
} from './DuplicateMergeModal';

interface DuplicateSectionProps {
  libraryId?: string;
  duplicates: Book[][];
  duplicateGroupsWithMeta?: DuplicateGroupMetadata[];
  processingIds: Set<string>;
  isCheckingDuplicates?: boolean;
  handleAllowDuplicateGroup: (group: Book[]) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  handleMergeDuplicates?: (payload: DuplicateMergePayload) => Promise<void>;
}

const formatAddedAt = (addedAt?: unknown) => formatFirestoreDate(addedAt);

export function DuplicateSection({
  libraryId = '',
  duplicates,
  duplicateGroupsWithMeta,
  processingIds,
  isCheckingDuplicates = false,
  handleAllowDuplicateGroup,
  handleDelete,
  handleMergeDuplicates,
}: DuplicateSectionProps) {
  const [mergingGroup, setMergingGroup] = useState<Book[] | null>(null);

  return (
    <section className="bg-surface-container-low border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-outline-variant/30 bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-serif font-semibold text-on-surface">
              Possible Duplicates
            </h2>
            {isCheckingDuplicates ? (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary"
                data-testid="duplicate-scanning-badge"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning in background...
              </span>
            ) : (
              <span className="text-on-surface-variant font-sans text-xs font-semibold px-2.5 py-0.5 rounded-md bg-surface-container border border-outline-variant/30">
                {duplicates.length}{' '}
                {duplicates.length === 1 ? 'group' : 'groups'} found
              </span>
            )}
          </div>
          <p className="text-sm text-on-surface-variant font-sans mt-0.5">
            Compare matching books side-by-side to combine their details, remove
            extra copies, or keep both editions.
          </p>
        </div>
      </div>

      {/* Body */}
      {isCheckingDuplicates && duplicates.length === 0 ? (
        <div
          className="p-12 text-center flex flex-col items-center justify-center gap-3 bg-surface"
          data-testid="duplicate-scanning-state"
        >
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
          <div>
            <h3 className="font-sans text-base font-bold text-on-surface">
              Checking Your Shelves for Duplicates...
            </h3>
            <p className="font-sans text-xs text-on-surface-variant mt-1 max-w-md">
              Comparing titles, authors, and ISBNs in the background while you
              browse.
            </p>
          </div>
        </div>
      ) : duplicates.length === 0 ? (
        <div className="p-12 text-center flex flex-col items-center justify-center gap-2 bg-surface">
          <TidyShelfCheckIllustration className="mb-1" />
          <h3 className="font-serif text-lg font-semibold text-on-surface">
            All Tidy—No Duplicates Found
          </h3>
          <p className="font-sans text-sm text-on-surface-variant">
            Every book in this library looks unique.
          </p>
        </div>
      ) : (
        <div className="relative bg-surface overflow-hidden">
          <div className="max-h-[540px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-container-low border-b border-outline-variant/30 text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                <tr>
                  <th className="py-3 px-5 w-[260px] sm:w-[300px]">
                    Matched Work & Confidence
                  </th>
                  <th className="py-3 px-5">Candidate Editions in Library</th>
                  <th className="py-3 px-5 w-[190px] text-right">
                    Resolution Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/25 align-top">
                {duplicates.map((group, idx) => {
                  const meta = duplicateGroupsWithMeta?.[idx];
                  const primaryBook = group[0];
                  return (
                    <tr
                      key={meta?.groupKey || idx}
                      className="hover:bg-surface-container-lowest/60 transition-colors"
                    >
                      {/* Column 1: Group Summary & Confidence */}
                      <td className="py-4 px-5">
                        <span className="sr-only">
                          Group {idx + 1}: {primaryBook.title}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <span
                            className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant font-semibold"
                            aria-hidden="true"
                          >
                            Group {idx + 1}
                          </span>
                          <span className="text-xs text-outline">•</span>
                          <span className="text-[11px] font-medium text-on-surface-variant">
                            {group.length} editions
                          </span>
                        </div>
                        <h3
                          className="font-sans text-base font-bold text-primary leading-snug line-clamp-2"
                          aria-hidden="true"
                        >
                          {primaryBook.title}
                        </h3>
                        <p className="text-xs font-medium text-on-surface-variant mt-0.5">
                          by {primaryBook.author || 'Unknown Author'}
                        </p>
                        {meta && (
                          <div className="mt-2.5">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20"
                              data-testid={`duplicate-confidence-badge-${idx}`}
                            >
                              {meta.confidence}% Match • {meta.reason}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Column 2: Compact Candidate Rows */}
                      <td className="py-4 px-5">
                        <div className="flex flex-col gap-2">
                          {group.map(b => {
                            const hasSynopsis = Boolean(
                              b.bookDetailsMetadata?.hasSynopsis ||
                              b.enrichmentStatus?.synopsis === 'completed',
                            );
                            return (
                              <div
                                key={b.id}
                                className="bg-surface-container-lowest border border-outline-variant/35 rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-outline-variant/60 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-11 rounded bg-surface-container border border-outline-variant/20 flex items-center justify-center overflow-hidden shrink-0">
                                    {b.coverUrl ? (
                                      <img
                                        src={b.coverUrl}
                                        alt=""
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <MonographCoverFallback
                                        title={b.title}
                                        author={b.author}
                                        variant="micro"
                                        className="w-full h-full border-0"
                                      />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-sans font-semibold text-xs text-on-surface truncate max-w-[220px]">
                                        {b.title}
                                      </span>
                                      <Badge variant="format" size="sm">
                                        {b.format || 'Physical'}
                                      </Badge>
                                      {b.series && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant border border-outline-variant/30 truncate max-w-[140px]">
                                          {b.series}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-on-surface-variant font-mono">
                                      {b.isbn && <span>ISBN: {b.isbn}</span>}
                                      {b.addedAt && (
                                        <span>
                                          Added: {formatAddedAt(b.addedAt)}
                                        </span>
                                      )}
                                      <span className="font-sans">
                                        Cover:{' '}
                                        <strong
                                          className={
                                            b.coverUrl
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : 'text-on-surface-variant/60 font-normal'
                                          }
                                        >
                                          {b.coverUrl ? 'Yes' : 'No'}
                                        </strong>
                                      </span>
                                      <span className="font-sans">
                                        Synopsis:{' '}
                                        <strong
                                          className={
                                            hasSynopsis
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : 'text-on-surface-variant/60 font-normal'
                                          }
                                        >
                                          {hasSynopsis ? 'Yes' : 'No'}
                                        </strong>
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(b.id)}
                                  disabled={processingIds.has(b.id)}
                                  className="h-8 px-2.5 shrink-0 flex items-center gap-1.5 bg-error/5 text-error hover:bg-error hover:text-white border border-error/15 hover:border-error text-xs font-semibold transition-colors"
                                >
                                  {processingIds.has(b.id) ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                  <span>Delete This Duplicate</span>
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      {/* Column 3: Group Resolution Actions */}
                      <td className="py-4 px-5 text-right">
                        <div className="flex flex-col gap-2 items-stretch sm:items-end">
                          {handleMergeDuplicates && (
                            <Button
                              size="sm"
                              onClick={() => setMergingGroup(group)}
                              data-testid={`open-merge-modal-btn-${idx}`}
                              className="w-full sm:w-[156px] flex items-center justify-center gap-1.5 font-bold text-xs"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                              Merge Records
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAllowDuplicateGroup(group)}
                            className="w-full sm:w-[156px] flex items-center justify-center gap-1.5 border-outline-variant/60 text-on-surface hover:bg-surface-container font-bold text-xs"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                            Mark as Unique
                            <span className="sr-only">Ignore</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 bg-surface-container-lowest border-t border-outline-variant/20 flex items-center justify-between text-xs text-on-surface-variant select-none">
            <span className="font-medium text-on-surface">
              {duplicates.length}{' '}
              {duplicates.length === 1 ? 'duplicate group' : 'duplicate groups'}{' '}
              requiring review
            </span>
            <span className="text-[11px] text-on-surface-variant/70 italic">
              Use &ldquo;Merge Records&rdquo; to combine metadata &amp; reading
              history side-by-side
            </span>
          </div>
        </div>
      )}

      {handleMergeDuplicates && (
        <DuplicateMergeModal
          libraryId={libraryId}
          group={mergingGroup}
          open={Boolean(mergingGroup)}
          onClose={() => setMergingGroup(null)}
          onConfirmMerge={handleMergeDuplicates}
        />
      )}
    </section>
  );
}
