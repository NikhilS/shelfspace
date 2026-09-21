import {useState, useEffect, useCallback} from 'react';
import {useQueryClient} from '@tanstack/react-query';
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
  const [isEnrichingSynopsis, setIsEnrichingSynopsis] = useState(false);
  const [isEnrichingBio, setIsEnrichingBio] = useState(false);

  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const generateBookInsightsMutation =
    trpc.gemini.generateBookInsights.useMutation();

  const invalidateBookQueries = useCallback(
    async (bookId: string) => {
      if (!libraryId) return;
      await Promise.allSettled([
        utils.book.get.invalidate({libraryId, bookId}),
        utils.book.list.invalidate({libraryId}),
        queryClient.invalidateQueries({
          queryKey: ['bookBase', libraryId, bookId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['bookDetails', libraryId, bookId],
        }),
      ]);
    },
    [libraryId, utils.book.get, utils.book.list, queryClient],
  );

  const triggerManualEnrichment = useCallback(
    async (type: 'synopsis' | 'authorBio') => {
      if (!book || !libraryId || !canEdit) return;

      if (type === 'synopsis') {
        setIsEnrichingSynopsis(true);
      } else {
        setIsEnrichingBio(true);
      }

      try {
        await trpcVanilla.enrichment.trigger.mutate({
          libraryId,
          enrichmentType: type,
          bookIds: [book.id],
        });
        await invalidateBookQueries(book.id);
        toast.success(
          type === 'synopsis'
            ? 'Synopsis updated!'
            : 'Author biography updated!',
        );
      } catch (err) {
        console.error(`Manual enrichment failed for ${type}:`, err);
        toast.error(`Could not generate ${type}. Please try again later.`);
      } finally {
        if (type === 'synopsis') {
          setIsEnrichingSynopsis(false);
        } else {
          setIsEnrichingBio(false);
        }
      }
    },
    [book, libraryId, canEdit, invalidateBookQueries],
  );

  useEffect(() => {
    if (!book || !libraryId || !canEdit) return;

    // Check if enrichment already ran or is unsupported
    const synopsisStatus = book.enrichmentStatus?.synopsis;
    const authorBioStatus = book.enrichmentStatus?.authorBio;

    const needsSynopsis =
      !book.bookDetailsMetadata?.hasSynopsis &&
      !book.synopsis &&
      synopsisStatus !== 'unsupported' &&
      synopsisStatus !== 'completed';

    const needsBio =
      !book.bookDetailsMetadata?.hasAuthorBio &&
      !book.authorBio &&
      book.author &&
      book.author !== 'Unknown Author' &&
      authorBioStatus !== 'unsupported' &&
      authorBioStatus !== 'completed';

    if (!needsSynopsis && !needsBio) return;

    let isMounted = true;

    const runAutoEnrichment = async () => {
      if (needsSynopsis) {
        if (isMounted) setIsEnrichingSynopsis(true);
        try {
          await trpcVanilla.enrichment.trigger.mutate({
            libraryId,
            enrichmentType: 'synopsis',
            bookIds: [book.id],
          });
        } catch (error) {
          console.warn('Auto-generate synopsis encountered an issue:', error);
        } finally {
          if (isMounted) {
            setIsEnrichingSynopsis(false);
            await invalidateBookQueries(book.id);
          }
        }
      }

      if (needsBio && isMounted) {
        setIsEnrichingBio(true);
        try {
          await trpcVanilla.enrichment.trigger.mutate({
            libraryId,
            enrichmentType: 'authorBio',
            bookIds: [book.id],
          });
        } catch (error) {
          console.warn('Auto-generate authorBio encountered an issue:', error);
        } finally {
          if (isMounted) {
            setIsEnrichingBio(false);
            await invalidateBookQueries(book.id);
          }
        }
      }
    };

    const timerId = setTimeout(runAutoEnrichment, 1200);

    return () => {
      clearTimeout(timerId);
      isMounted = false;
    };
  }, [
    book?.id,
    book?.title,
    book?.author,
    book?.isbn,
    book?.synopsis,
    book?.authorBio,
    book?.enrichmentStatus?.synopsis,
    book?.enrichmentStatus?.authorBio,
    book?.bookDetailsMetadata?.hasSynopsis,
    book?.bookDetailsMetadata?.hasAuthorBio,
    libraryId,
    canEdit,
    invalidateBookQueries,
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
    isEnrichingSynopsis,
    isEnrichingBio,
    triggerManualEnrichment,
    setActiveInsight,
    handleGenerateInsight,
  };
}
