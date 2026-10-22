import React, {memo} from 'react';
import {Button} from '@/components/ui/button';
import {Loader2, Sparkles} from 'lucide-react';
import Markdown from 'react-markdown';
import {useBookInsights} from './useBookInsights';
import {Book} from './useBook';
import {useAppPermissions} from '../../hooks/useAppPermissions';

interface AiInsightsPanelProps {
  libraryId: string;
  book: Book;
  canEdit: boolean;
  hasAiPlan?: boolean;
  activeInsight?: 'catchup' | 'similar' | null;
  insightContent?: string | null;
  isGeneratingInsight?: boolean;
  handleGenerateInsight?: (type: 'catchup' | 'similar') => void;
}

export const AiInsightsPanel = memo(
  ({
    libraryId,
    book,
    canEdit,
    hasAiPlan: passedHasAiPlan,
    activeInsight: passedActiveInsight,
    insightContent: passedInsightContent,
    isGeneratingInsight: passedIsGenerating,
    handleGenerateInsight: passedHandleGenerate,
  }: AiInsightsPanelProps) => {
    const {hasAiPlan: contextHasAiPlan} = useAppPermissions();
    const hasAiPlan = passedHasAiPlan ?? contextHasAiPlan;

    const internalInsights = useBookInsights(
      libraryId,
      book,
      passedHandleGenerate ? false : canEdit,
    );

    const activeInsight =
      passedActiveInsight !== undefined
        ? passedActiveInsight
        : internalInsights.activeInsight;
    const insightContent =
      passedInsightContent !== undefined
        ? passedInsightContent
        : internalInsights.insightContent;
    const isGeneratingInsight =
      passedIsGenerating !== undefined
        ? passedIsGenerating
        : internalInsights.isGeneratingInsight;
    const handleGenerateInsight =
      passedHandleGenerate || internalInsights.handleGenerateInsight;

    return (
      <section className="mt-8">
        <div className="flex flex-wrap items-center gap-2 mb-6 swiper-no-swiping">
          <Button
            variant={activeInsight === 'catchup' ? 'default' : 'outline'}
            disabled={!hasAiPlan || isGeneratingInsight}
            title={!hasAiPlan ? 'Requires AI Plan (Admin-enabled)' : undefined}
            onClick={() => hasAiPlan && handleGenerateInsight('catchup')}
          >
            Catch Me Up (Spoilers)
          </Button>
          <Button
            variant={activeInsight === 'similar' ? 'default' : 'outline'}
            disabled={!hasAiPlan || isGeneratingInsight}
            title={!hasAiPlan ? 'Requires AI Plan (Admin-enabled)' : undefined}
            onClick={() => hasAiPlan && handleGenerateInsight('similar')}
          >
            Other Books Like This
          </Button>
          {!hasAiPlan && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans font-medium bg-surface-container text-on-surface-variant border border-outline-variant/50"
              title="Requires AI Plan (Admin-enabled)"
            >
              <Sparkles className="w-3.5 h-3.5 text-on-surface-variant/70" />
              Requires AI Plan (Admin-enabled)
            </span>
          )}
        </div>

        {activeInsight && (
          <div className="bg-surface-container-lowest rounded-lg p-6 sm:p-8 architectural-shadow border border-surface-variant">
            {isGeneratingInsight ? (
              <div className="flex items-center gap-3 text-on-surface-variant">
                <Loader2 className="animate-spin" size={24} />
                <p>Putting together notes...</p>
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
