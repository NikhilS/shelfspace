import {useState, useEffect} from 'react';
import {doc, setDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {fetchAuthorBioFromWikipedia} from '../../services/wikipediaApi';
import {Book, BookDetailsPayload} from '../../types';
import {toast} from 'sonner';
import {trpc} from '../../lib/trpc';

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

    // TRPC abort signals are handled per request, but we can manage a local unmount flag
    let isMounted = true;

    const generateMissingInfo = async () => {
      try {
        const updates: Partial<BookDetailsPayload> = {};

        if (needsSynopsis) {
          const synopsis = await generateBookInsightsMutation.mutateAsync({
            title: book.title,
            author: book.author,
            type: 'synopsis',
          });
          if (!isMounted) return;
          if (synopsis) updates.synopsis = synopsis;
        }

        if (needsBio && book.author && book.author !== 'Unknown Author') {
          // Try Wikipedia first
          let authorBio = await fetchAuthorBioFromWikipedia(book.author);

          if (!isMounted) return;

          // Fallback to Gemini if Wikipedia returns nothing or a disambiguation page hint
          if (!authorBio || authorBio.includes('may refer to:')) {
            authorBio = await generateBookInsightsMutation.mutateAsync({
              title: book.title,
              author: book.author,
              type: 'author_bio',
            });
          }

          if (!isMounted) return;
          if (authorBio && !authorBio.includes('may refer to:')) {
            updates.authorBio = authorBio;
          }
        }

        if (Object.keys(updates).length > 0 && isMounted) {
          try {
            await setDoc(
              doc(db, 'libraries', libraryId, 'bookDetails', book.id),
              updates,
              {merge: true},
            );
          } catch (e) {
            handleFirestoreError(
              e,
              OperationType.UPDATE,
              `libraries/${libraryId}/bookDetails/${book.id}`,
            );
          }
        }
      } catch (error: unknown) {
        if (
          !isMounted ||
          (error instanceof Error &&
            (error.name === 'AbortError' ||
              error.message.toLowerCase().includes('abort')))
        ) {
          return;
        }
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
