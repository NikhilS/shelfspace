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

  const generateNewPick = async () => {
    if (books.length === 0 || isGeneratingPick) return;
    setIsGeneratingPick(true);
    try {
      const sample = [...books].sort(() => Math.random() - 0.5).slice(0, 50);
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
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingPick(false);
    }
  };

  useEffect(() => {
    if (
      books.length > 0 &&
      !pickOfTheDay &&
      !isGeneratingPick &&
      currentTab === 'overview'
    ) {
      void generateNewPick();
    }
  }, [books, currentTab, pickOfTheDay, isGeneratingPick]);

  return {pickOfTheDay, isGeneratingPick, generateNewPick};
}
