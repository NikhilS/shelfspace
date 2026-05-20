import React, {memo} from 'react';
import {Button} from '@/components/ui/button';
import {Loader2} from 'lucide-react';
import Markdown from 'react-markdown';
import {useBookInsights} from './useBookInsights';
import {Book} from './useBook';

interface AiInsightsPanelProps {
  libraryId: string;
  book: Book;
  canEdit: boolean;
}

export const AiInsightsPanel = memo(
  ({libraryId, book, canEdit}: AiInsightsPanelProps) => {
    const {
      activeInsight,
      insightContent,
      isGeneratingInsight,
      handleGenerateInsight,
    } = useBookInsights(libraryId, book, canEdit);

    return (
      <section className="mt-8">
        <div className="flex flex-wrap gap-2 mb-6">
          <Button
            variant={activeInsight === 'catchup' ? 'default' : 'outline'}
            onClick={() => handleGenerateInsight('catchup')}
          >
            Catch Me Up (Spoilers)
          </Button>
          <Button
            variant={activeInsight === 'similar' ? 'default' : 'outline'}
            onClick={() => handleGenerateInsight('similar')}
          >
            Other Books Like This
          </Button>
        </div>

        {activeInsight && (
          <div className="bg-surface-container-lowest rounded-lg p-6 sm:p-8 architectural-shadow border border-surface-variant">
            {isGeneratingInsight ? (
              <div className="flex items-center gap-3 text-on-surface-variant">
                <Loader2 className="animate-spin" size={24} />
                <p>Consulting the AI...</p>
              </div>
            ) : insightContent ? (
              <div className="markdown-body">
                <Markdown>{insightContent}</Markdown>
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  },
);
