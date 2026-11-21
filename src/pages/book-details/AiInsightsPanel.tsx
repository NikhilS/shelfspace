import React, {memo} from 'react';
import {Button} from '@/components/ui/button';
import {Loader2, Sparkles} from 'lucide-react';
import Markdown from 'react-markdown';
import {useBookInsights} from './useBookInsights';
import {Book} from './useBook';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';

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
    const isOnline = useOnlineStatus();
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

    const buttonTooltip = !isOnline
      ? 'Unavailable while offline'
      : !hasAiPlan
        ? 'Requires AI Plan (Admin-enabled)'
        : undefined;

    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 swiper-no-swiping">
          <Button
            size="sm"
            variant={activeInsight === 'catchup' ? 'default' : 'outline'}
            disabled={!isOnline || !hasAiPlan || isGeneratingInsight}
            title={buttonTooltip}
            onClick={() =>
              isOnline && hasAiPlan && handleGenerateInsight('catchup')
            }
            className="gap-1.5 rounded-lg font-sans text-xs font-semibold h-9 px-3.5"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${
                activeInsight === 'catchup'
                  ? 'text-on-primary'
                  : 'text-tertiary'
              }`}
            />
            <span>Catch Me Up (Spoilers)</span>
          </Button>
          <Button
            size="sm"
            variant={activeInsight === 'similar' ? 'default' : 'outline'}
            disabled={!isOnline || !hasAiPlan || isGeneratingInsight}
            title={buttonTooltip}
            onClick={() =>
              isOnline && hasAiPlan && handleGenerateInsight('similar')
            }
            className="gap-1.5 rounded-lg font-sans text-xs font-semibold h-9 px-3.5"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${
                activeInsight === 'similar'
                  ? 'text-on-primary'
                  : 'text-tertiary'
              }`}
            />
            <span>Other Books Like This</span>
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
          <div className="bento-card p-5 sm:p-6">
            {isGeneratingInsight ? (
              <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                <Loader2 className="animate-spin text-tertiary" size={18} />
                <p>Putting together literary notes...</p>
              </div>
            ) : insightContent ? (
              <div className="markdown-body text-sm sm:text-[15px] text-on-surface/90 leading-relaxed max-w-[70ch]">
                <Markdown>{insightContent}</Markdown>
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  },
);
