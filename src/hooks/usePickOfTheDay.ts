import {useQuery} from '@tanstack/react-query';
import {Book} from '../types';
import {searchBookByTitleAndAuthor} from '../services/bookApi';
import {logger} from '../stores/debugStore';
import {trpc} from '../lib/trpc';

export function usePickOfTheDay(books: Book[], currentTab: string) {
  const getPickOfTheDayMutation = trpc.gemini.getPickOfTheDay.useMutation();

  const query = useQuery({
    queryKey: ['pickOfTheDay', books.length],
    enabled: books.length > 0 && currentTab === 'overview',
    retry: false,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
    refetchOnWindowFocus: false,
    queryFn: async () => {
      logger.info(
        `[Curator pick] Starting AI Curator recommendation engine. Library size: ${books.length} books.`,
      );
      const shuffled = [...books];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const rj = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[rj]] = [shuffled[rj], shuffled[i]];
      }
      const sample = shuffled.slice(0, 100);
      logger.info(
        `[Curator pick] Shuffled collection. Selected a diverse sample of ${sample.length} books for prompt context.`,
      );

      logger.info(
        '[Curator pick] Querying Gemini for 10 tailored, expert librarian recommendations...',
      );
      const picks = await getPickOfTheDayMutation.mutateAsync({
        books: sample.map(b => ({title: b.title, author: b.author})),
      });

      let finalPick: {title: string; author: string; reason: string} | null =
        null;

      if (picks && picks.length > 0) {
        logger.info(
          `[Curator pick] Gemini returned ${picks.length} custom recommendations. Processing duplicate checks...`,
        );

        for (let i = 0; i < picks.length; i++) {
          const candidate = picks[i];
          const cTitle = (candidate.title || '').trim();
          const cAuthor = (candidate.author || '').trim();

          logger.info(
            `[Curator pick] Evaluating Candidate #${i + 1}: "${cTitle}" by ${cAuthor}`,
          );

          const alreadyExists = books.some(
            b =>
              (b.title || '').toLowerCase() === cTitle.toLowerCase() &&
              (b.author || '').toLowerCase() === cAuthor.toLowerCase(),
          );

          if (alreadyExists) {
            logger.warn(
              `[Curator pick] Duplicate! "${cTitle}" is already in your library. Looping to next recommendation...`,
            );
          } else {
            logger.info(
              `[Curator pick] Match found! "${cTitle}" by ${cAuthor} is unique and not in your library.`,
            );
            finalPick = candidate;
            break;
          }
        }

        if (!finalPick) {
          logger.warn(
            '[Curator pick] Notice: All returned recommendations already exist in your library collection! Falling back to first recommendation as custom pick.',
          );
          finalPick = picks[0];
        }
      }

      if (finalPick) {
        let coverUrl: string | undefined = undefined;
        try {
          logger.info(
            `[Curator pick] Querying Book API to look up cover art for: "${finalPick.title}" by ${finalPick.author}...`,
          );
          const results = await searchBookByTitleAndAuthor(
            finalPick.title,
            finalPick.author,
          );

          if (results && results.length > 0 && results[0].coverUrl) {
            coverUrl = results[0].coverUrl;
            logger.info(
              `[Curator pick] Successfully resolved cover art URL: ${coverUrl}`,
            );
          } else {
            logger.info(
              `[Curator pick] No cover art found in API for: "${finalPick.title}"`,
            );
          }
        } catch (err) {
          logger.warn(
            `[Curator pick] Non-fatal error looking up cover art: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        logger.info(
          `[Curator pick] New recommendation set: "${finalPick.title}" by ${finalPick.author}. Enjoy your reading!`,
        );
        return {
          title: finalPick.title,
          author: finalPick.author,
          coverUrl,
          reason: finalPick.reason,
        };
      }

      throw new Error('No recommendation found.');
    },
  });

  return {
    pickOfTheDay: query.data || null,
    isGeneratingPick: query.isFetching,
    generateNewPick: () => query.refetch(),
    error: query.error ? query.error.message : null,
  };
}
