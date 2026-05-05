import {useState, useEffect} from 'react';
import {doc, setDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {generateBookInsights} from '../../services/gemini';
import {fetchAuthorBioFromWikipedia} from '../../services/wikipediaApi';
import {Book, BookDetailsPayload} from '../../types';
import {toast} from 'sonner';

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

  useEffect(() => {
    if (!book || !libraryId || !canEdit) return;

    const needsSynopsis = !book.synopsis;
    const needsBio = !book.authorBio;

    if (!needsSynopsis && !needsBio) return;

    const abortController = new AbortController();

    const generateMissingInfo = async () => {
      try {
        const updates: Partial<BookDetailsPayload> = {};

        if (needsSynopsis) {
          const synopsis = await generateBookInsights(
            book.title,
            book.author,
            'synopsis',
            abortController.signal,
          );
          if (abortController.signal.aborted) return;
          if (synopsis) updates.synopsis = synopsis;
        }

        if (needsBio && book.author && book.author !== 'Unknown Author') {
          // Try Wikipedia first
          let authorBio = await fetchAuthorBioFromWikipedia(book.author);

          if (abortController.signal.aborted) return;

          // Fallback to Gemini if Wikipedia returns nothing or a disambiguation page hint
          if (!authorBio || authorBio.includes('may refer to:')) {
            authorBio = await generateBookInsights(
              book.title,
              book.author,
              'author_bio',
              abortController.signal,
            );
          }

          if (abortController.signal.aborted) return;
          if (authorBio && !authorBio.includes('may refer to:')) {
            updates.authorBio = authorBio;
          }
        }

        if (
          Object.keys(updates).length > 0 &&
          !abortController.signal.aborted
        ) {
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
        if (error instanceof Error && error.message !== 'Aborted') {
          console.error('Failed to auto-generate missing book info:', error);
        }
      }
    };

    const timeoutId = setTimeout(generateMissingInfo, 1500);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
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
      const content = await generateBookInsights(book.title, book.author, type);
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
