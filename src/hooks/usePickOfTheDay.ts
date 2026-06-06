import {useState, useEffect} from 'react';
import {Book} from '../types';
import {getPickOfTheDay} from '../services/gemini';
import {searchBookByTitleAndAuthor} from '../services/bookApi';
import {logger} from '../contexts/DebugContext';

export function usePickOfTheDay(books: Book[], currentTab: string) {
  const [pickOfTheDay, setPickOfTheDay] = useState<{
    title: string;
    author: string;
    coverUrl?: string;
    reason: string;
  } | null>(null);
  const [isGeneratingPick, setIsGeneratingPick] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateNewPick = async (isManualClick = false) => {
    if (books.length === 0 || (isGeneratingPick && !isManualClick)) return;
    setIsGeneratingPick(true);
    setError(null);
    try {
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
      const picks = await getPickOfTheDay(sample);

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
        setPickOfTheDay({
          title: finalPick.title,
          author: finalPick.author,
          coverUrl,
          reason: finalPick.reason,
        });
        logger.info(
          `[Curator pick] New recommendation set: "${finalPick.title}" by ${finalPick.author}. Enjoy your reading!`,
        );
      } else {
        setError('No recommendation found.');
        logger.error(
          '[Curator pick] Gemini returned an empty or invalid pick.',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      logger.error(`[Curator pick] Call failed with error: ${msg}`);
      console.warn('Pick of the day generation failed:', msg);
    } finally {
      setIsGeneratingPick(false);
      setHasAttempted(true);
    }
  };

  useEffect(() => {
    if (
      books.length > 0 &&
      !pickOfTheDay &&
      !isGeneratingPick &&
      !hasAttempted &&
      currentTab === 'overview'
    ) {
      void generateNewPick(false);
    }
  }, [books.length, currentTab, pickOfTheDay, isGeneratingPick, hasAttempted]);

  // Reset attempt state if library becomes empty or when user changes tab, or we can just let books trigger it
  useEffect(() => {
    if (books.length === 0) {
      setHasAttempted(false);
      setError(null);
      setPickOfTheDay(null);
    }
  }, [books.length]);

  return {
    pickOfTheDay,
    isGeneratingPick,
    generateNewPick: () => generateNewPick(true),
    error,
  };
}
