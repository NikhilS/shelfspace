import {useState, useEffect} from 'react';
import {Book} from '../types';
import {getPickOfTheDay} from '../services/gemini';
import {searchBookByTitleAndAuthor} from '../services/bookApi';

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
      const shuffled = [...books];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const sample = shuffled.slice(0, 50);
      let pick = await getPickOfTheDay(sample);

      let attempts = 0;
      while (pick && attempts < 3) {
        const alreadyExists = books.some(
          b =>
            (b.title || '').toLowerCase() ===
              (pick!.title || '').toLowerCase() &&
            (b.author || '').toLowerCase() ===
              (pick!.author || '').toLowerCase(),
        );
        if (!alreadyExists) break;
        pick = await getPickOfTheDay(sample);
        attempts++;
      }

      if (pick) {
        let coverUrl: string | undefined = undefined;
        try {
          const results = await searchBookByTitleAndAuthor(
            pick.title,
            pick.author,
          );
          if (results && results.length > 0 && results[0].coverUrl) {
            coverUrl = results[0].coverUrl;
          }
        } catch (err) {
          console.error('Failed to get cover for pick:', err);
        }
        setPickOfTheDay({
          title: pick.title,
          author: pick.author,
          coverUrl,
          reason: pick.reason,
        });
      } else {
        setError('No recommendation found.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
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
