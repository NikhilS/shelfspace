import {useState, useEffect, useCallback, useRef} from 'react';
import {Book, BookDetailsPayload} from '../../types';
import {toast} from 'sonner';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {useAppPermissions} from '../../hooks/useAppPermissions';

export function useBookInsights(
  libraryId: string | undefined,
  book: (Book & BookDetailsPayload) | null,
  canEdit: boolean,
) {
  const {hasAiPlan} = useAppPermissions();
  const [activeInsight, setActiveInsight] = useState<
    'catchup' | 'similar' | null
  >(null);
  const [insightContent, setInsightContent] = useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [isEnrichingSynopsis, setIsEnrichingSynopsis] = useState(false);
  const [isEnrichingBio, setIsEnrichingBio] = useState(false);
  const attemptedAutoEnrichRef = useRef<Set<string>>(new Set());

  const utils = trpc.useUtils();
  const generateBookInsightsMutation =
    trpc.gemini.generateBookInsights.useMutation();

  const invalidateBookQueries = useCallback(
    async (bookId: string) => {
      if (!libraryId) return;
      await Promise.allSettled([
        utils.book.get.invalidate({libraryId, bookId}),
        utils.book.list.invalidate({libraryId}),
      ]);
    },
    [libraryId, utils.book.get, utils.book.list],
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
        const res = await trpcVanilla.enrichment.trigger.mutate({
          libraryId,
          enrichmentType: type,
          bookIds: [book.id],
        });
        await invalidateBookQueries(book.id);
        const processed = res?.processedCount ?? res?.results?.length ?? 1;
        if (processed > 0) {
          toast.success(
            type === 'synopsis'
              ? 'Synopsis updated!'
              : 'Author biography updated!',
          );
        } else {
          const label = type === 'synopsis' ? 'synopsis' : 'author biography';
          toast.info(
            hasAiPlan
              ? `No ${label} found for this title.`
              : `No ${label} found in public catalogs (AI fallback requires an active AI Plan).`,
          );
        }
      } catch (err) {
        console.error(`Manual enrichment failed for ${type}:`, err);
        toast.error(`Could not fetch ${type}. Please try again later.`);
      } finally {
        if (type === 'synopsis') {
          setIsEnrichingSynopsis(false);
        } else {
          setIsEnrichingBio(false);
        }
      }
    },
    [book, libraryId, canEdit, hasAiPlan, invalidateBookQueries],
  );

  useEffect(() => {
    if (!book || !libraryId || !canEdit) return;

    const synopsisKey = `${book.id}:synopsis`;
    const bioKey = `${book.id}:authorBio`;

    // Check if enrichment already ran or is unsupported
    const synopsisStatus = book.enrichmentStatus?.synopsis;
    const authorBioStatus = book.enrichmentStatus?.authorBio;

    const needsSynopsis =
      !attemptedAutoEnrichRef.current.has(synopsisKey) &&
      !book.bookDetailsMetadata?.hasSynopsis &&
      !book.synopsis &&
      synopsisStatus !== 'unsupported' &&
      synopsisStatus !== 'completed';

    const needsBio =
      !attemptedAutoEnrichRef.current.has(bioKey) &&
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
        attemptedAutoEnrichRef.current.add(synopsisKey);
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
        attemptedAutoEnrichRef.current.add(bioKey);
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
