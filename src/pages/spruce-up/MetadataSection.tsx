import React from 'react';
import {Loader2, Wand2} from 'lucide-react';
import {Book} from '../../types';
import {Button} from '@/components/ui/button';

interface MetadataSectionProps {
  missingMetadata: Book[];
  fixingAll: boolean;
  fixingProgress: number;
  activeJob: {
    status: 'running' | 'completed' | 'failed' | 'none';
    progress: number;
    total: number;
  } | null;
  processingIds: Record<string, boolean>;
  isOnline: boolean;
  onFixAll: () => Promise<void>;
  onForceResync: () => void;
  onFixMetadata: (book: Book) => Promise<void>;
  emptyCoverUrls?: Set<string>;
}

export function MetadataSection({
  missingMetadata,
  fixingAll,
  fixingProgress,
  activeJob,
  processingIds,
  isOnline,
  onFixAll,
  onForceResync,
  onFixMetadata,
  emptyCoverUrls = new Set(),
}: MetadataSectionProps) {
  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-bold text-on-surface">
          Books with Missing Metadata{' '}
          <span className="text-on-surface-variant font-normal">
            ({missingMetadata.length})
          </span>
        </h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={onForceResync}
            disabled={activeJob?.status === 'running' || fixingAll || !isOnline}
            title={!isOnline ? 'AI features require a connection' : ''}
            className="flex items-center gap-2 text-error hover:text-error hover:bg-error/10"
          >
            {activeJob?.status === 'running' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {activeJob?.status === 'running'
              ? `Processing (${activeJob.progress}/${activeJob.total})`
              : 'Force Resync All Metadata'}
          </Button>
          {missingMetadata.length > 0 && (
            <Button
              onClick={onFixAll}
              disabled={fixingAll || !isOnline}
              title={!isOnline ? 'AI features require a connection' : ''}
              className="flex items-center gap-2"
            >
              {fixingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {fixingAll
                ? `Fixing (${fixingProgress}/${missingMetadata.length})`
                : 'Fix All Missing Metadata'}
            </Button>
          )}
        </div>
      </div>
      {missingMetadata.length === 0 ? (
        <p className="text-on-surface-variant">
          All books have complete metadata. Wow!
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {missingMetadata.map(b => (
            <div
              key={b.id}
              className="bg-surface-container border border-outline-variant rounded-xl p-4 flex flex-col justify-between"
            >
              <div>
                <p className="font-bold">{b.title}</p>
                <p className="text-sm text-on-surface-variant font-medium">
                  {b.author}
                </p>
                <ul className="text-xs text-error mt-2 list-disc list-inside">
                  {(!b.coverUrl || emptyCoverUrls.has(b.coverUrl)) && (
                    <li>Missing Cover</li>
                  )}
                  {!b.synopsis && <li>Missing Synopsis</li>}
                  {!b.publishedDate && <li>Missing Published Date</li>}
                  {(!b.genres || b.genres.length === 0) && (
                    <li>Missing Genres</li>
                  )}
                </ul>
              </div>
              <Button
                variant="outline"
                onClick={() => onFixMetadata(b)}
                disabled={processingIds[b.id] || !isOnline}
                title={!isOnline ? 'AI features require a connection' : ''}
                className="mt-4 flex items-center justify-center gap-2 w-full"
              >
                {processingIds[b.id] ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Fix Metadata
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
