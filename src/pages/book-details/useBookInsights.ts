import {useState, useEffect} from 'react';
import {Book, BookDetailsPayload} from '../../types';
import {toast} from 'sonner';
import {trpc, trpcVanilla} from '../../lib/trpc';

export function useBookInsights(
  libraryId: string | undefined,
  book: (Book & BookDetailsPayload) | null,
  canEdit: boolean,
) {
  const [activeInsight, setActiveInsight] = useState<
    'catchup' | 'similar' | null
  >(null);
  const [insightContent, setInsightContent] = useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  const generateBookInsightsMutation =
    trpc.gemini.generateBookInsights.useMutation();

  useEffect(() => {
    if (!book || !libraryId || !canEdit) return;

    const needsSynopsis = !book.synopsis;
    const needsBio = !book.authorBio;

    if (!needsSynopsis && !needsBio) return;

    let isMounted = true;

    const generateMissingInfo = async () => {
      try {
        if (needsSynopsis) {
          await trpcVanilla.enrichment.trigger.mutate({
            libraryId,
            enrichmentType: 'synopsis',
            bookIds: [book.id],
          });
        }

        if (needsBio && book.author && book.author !== 'Unknown Author') {
          await trpcVanilla.enrichment.trigger.mutate({
            libraryId,
            enrichmentType: 'authorBio',
            bookIds: [book.id],
          });
        }
      } catch (error: unknown) {
        if (!isMounted) return;
        console.error('Failed to auto-generate missing book info:', error);
      }
    };

    const timeoutId = setTimeout(generateMissingInfo, 1500);

    return () => {
      clearTimeout(timeoutId);
      isMounted = false;
    };
  }, [
    book?.id,
    book?.title,
    book?.author,
    book?.isbn,
    book?.synopsis,
    book?.authorBio,
    libraryId,
    canEdit,
  ]);

  const handleGenerateInsight = async (type: 'catchup' | 'similar') => {
    if (!book) return;

    setActiveInsight(type);
    setIsGeneratingInsight(true);
    setInsightContent(null);

    try {
      const content = await generateBookInsightsMutation.mutateAsync({
        title: book.title,
        author: book.author,
        type: type,
      });
      setInsightContent(content);
    } catch {
      toast.error('Failed to generate insights. Please try again.');
      setActiveInsight(null);
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  return {
    activeInsight,
    insightContent,
    isGeneratingInsight,
    setActiveInsight,
    handleGenerateInsight,
  };
}
