import {useState, useEffect} from 'react';
import {doc, setDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
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
        const updates: Partial<BookDetailsPayload> = {};
        const bookData = {
          id: book.id,
          title: book.title, // required
          author: book.author, // required
          isbn: book.isbn,
          synopsis: book.synopsis,
          description: (book as unknown as Record<string, unknown>)
            .description as string | undefined,
        };

        if (needsSynopsis) {
          const res = await trpcVanilla.metadata.bulkFetch.mutate({
            libraryId,
            providerKey: 'synopsis',
            books: [bookData],
          });
          if (!isMounted) return;
          if (res.status === 'success' && res.results.length > 0) {
            const resultData = res.results[0] as {
              id: string;
              synopsis?: string;
            };
            if (resultData.synopsis) {
              updates.synopsis = resultData.synopsis;
            }
          }
        }

        if (needsBio && book.author && book.author !== 'Unknown Author') {
          const res = await trpcVanilla.metadata.bulkFetch.mutate({
            libraryId,
            providerKey: 'authorBio',
            books: [bookData],
          });
          if (!isMounted) return;
          if (res.status === 'success' && res.results.length > 0) {
            const resultData = res.results[0] as {
              id: string;
              authorBio?: string;
            };
            if (resultData.authorBio) {
              updates.authorBio = resultData.authorBio;
            }
          }
        }

        if (Object.keys(updates).length > 0 && isMounted) {
          try {
            await setDoc(
              doc(db, 'libraries', libraryId, 'bookDetails', book.id),
              updates,
              {merge: true},
            );
            if (updates.synopsis) {
              await setDoc(
                doc(db, 'libraries', libraryId, 'books', book.id),
                {synopsis: updates.synopsis},
                {merge: true},
              );
            }
          } catch (e) {
            console.warn('Could not persist auto-generated book info to Firestore:', e);
          }
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
