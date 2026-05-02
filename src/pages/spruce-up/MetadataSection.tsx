import React from 'react';
import {Loader2, Wand2} from 'lucide-react';
import {Book} from '../../types';

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
}: MetadataSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-on-surface">
          Books with Missing Metadata{' '}
          <span className="text-on-surface-variant font-normal">
            ({missingMetadata.length})
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={onForceResync}
            disabled={activeJob?.status === 'running' || fixingAll || !isOnline}
            title={!isOnline ? 'AI features require a connection' : ''}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-error bg-error/10 hover:bg-error/20 rounded-xl transition-colors disabled:opacity-50"
          >
            {activeJob?.status === 'running' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {activeJob?.status === 'running'
              ? `Processing (${activeJob.progress}/${activeJob.total})`
              : 'Force Resync All Metadata'}
          </button>
          {missingMetadata.length > 0 && (
            <button
              onClick={onFixAll}
              disabled={fixingAll || !isOnline}
              title={!isOnline ? 'AI features require a connection' : ''}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {fixingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {fixingAll
                ? `Fixing (${fixingProgress}/${missingMetadata.length})`
                : 'Fix All Missing Metadata'}
            </button>
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
                  {!b.coverUrl && <li>Missing Cover</li>}
                  {!b.synopsis && <li>Missing Synopsis</li>}
                  {!b.publishedDate && <li>Missing Published Date</li>}
                  {(!b.genres || b.genres.length === 0) && (
                    <li>Missing Genres</li>
                  )}
                </ul>
              </div>
              <button
                onClick={() => onFixMetadata(b)}
                disabled={processingIds[b.id] || !isOnline}
                title={!isOnline ? 'AI features require a connection' : ''}
                className="mt-4 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors disabled:opacity-50"
              >
                {processingIds[b.id] ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Fix Metadata
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
