import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {logger} from '../stores/debugStore';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useAppPermissions} from './useAppPermissions';

export interface PickSeedBook {
  title: string;
  author: string;
  primaryGenre?: string | null;
  subgenres?: string[];
}

function getLocalDateBucket(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function usePickOfTheDay(
  books: PickSeedBook[],
  currentTabOrEnabled: string | boolean = 'overview',
  scopeKey: string = 'library',
) {
  const {hasAiPlan} = useAppPermissions();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const localDateBucket = getLocalDateBucket();
  const getPickOfTheDayMutation = trpc.gemini.getPickOfTheDay.useMutation();

  const isEnabled =
    typeof currentTabOrEnabled === 'boolean'
      ? currentTabOrEnabled
      : currentTabOrEnabled === 'overview';

  const query = useQuery({
    queryKey: ['pickOfTheDay', scopeKey, localDateBucket, refreshEpoch],
    enabled: books.length > 0 && isEnabled && hasAiPlan,
    retry: false,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
    refetchOnWindowFocus: false,
    queryFn: async () => {
      logger.info(
        `[Curator pick] Starting AI Curator recommendation engine (${scopeKey}). Seed size: ${books.length} books.`,
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
        books: sample.map(b => ({
          title: b.title,
          author: b.author,
          primaryGenre: b.primaryGenre || undefined,
          subgenres: b.subgenres,
        })),
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
              `[Curator pick] Duplicate! "${cTitle}" is already in your collection. Looping to next recommendation...`,
            );
          } else {
            logger.info(
              `[Curator pick] Match found! "${cTitle}" by ${cAuthor} is unique and not in your collection.`,
            );
            finalPick = candidate;
            break;
          }
        }

        if (!finalPick) {
          logger.warn(
            '[Curator pick] Notice: All returned recommendations already exist in your collection! Falling back to first recommendation as custom pick.',
          );
          finalPick = picks[0];
        }
      }

      if (finalPick) {
        let coverUrl: string | undefined = undefined;
        try {
          logger.info(
            `[Curator pick] Querying federated catalog to look up cover art for: "${finalPick.title}" by ${finalPick.author}...`,
          );
          const result =
            await trpcVanilla.metadata.searchByTitleAndAuthor.mutate({
              title: finalPick.title,
              author: finalPick.author,
              priority: 'INTERACTIVE',
            });

          if (result && result.coverUrl) {
            coverUrl = result.coverUrl;
            logger.info(
              `[Curator pick] Successfully resolved cover art URL: ${coverUrl}`,
            );
          } else {
            logger.info(
              `[Curator pick] No cover art found in catalog for: "${finalPick.title}"`,
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
    generateNewPick: () => {
      setRefreshEpoch(prev => prev + 1);
    },
    error: query.error ? query.error.message : null,
  };
}
