import type {BookRecommendationItem} from '../../../schemas/recommendation';
import type {TrackedBookItem, UnreadLibraryBookItem} from '../../../types';
import {
  normalizeRecommendationText,
  parseSeriesVolume,
  type ReaderTasteProfile,
} from './tasteProfile';

/**
 * Pillar 1: Scores and ranks unread books already in the user's accessible libraries
 * against their ReaderTasteProfile.
 */
export function scoreUnreadShelfCandidates(
  unreadBooks: UnreadLibraryBookItem[],
  shelfItems: TrackedBookItem[],
  profile: ReaderTasteProfile,
  refreshSeed = 0,
): BookRecommendationItem[] {
  const activeOrFinishedKeys = new Set<string>();
  for (const item of shelfItems) {
    if (
      item.readingStatus === 'reading' ||
      item.readingStatus === 'finished' ||
      item.readingStatus === 'abandoned'
    ) {
      activeOrFinishedKeys.add(`${item.libraryId}::${item.id}`);
      const tKey = normalizeRecommendationText(item.title);
      if (tKey) {
        activeOrFinishedKeys.add(tKey);
      }
    }
  }

  const topAuthorsNorm = new Set(
    profile.topAuthors.map(a => normalizeRecommendationText(a)),
  );
  const topGenresSet = new Set(profile.topGenres.map(g => g.toLowerCase()));
  const topSubgenresSet = new Set(
    profile.topSubgenres.map(s => s.toLowerCase()),
  );
  const activeSeriesNorm = new Map(
    profile.activeSeries.map(s => [
      normalizeRecommendationText(s.seriesName),
      s,
    ]),
  );

  const scored: Array<{item: BookRecommendationItem; score: number}> = [];
  const seenTitleKeys = new Set<string>();

  for (let i = 0; i < unreadBooks.length; i++) {
    const book = unreadBooks[i];
    const idKey = `${book.libraryId}::${book.id}`;
    const titleKey = normalizeRecommendationText(book.title);
    if (
      !titleKey ||
      activeOrFinishedKeys.has(idKey) ||
      activeOrFinishedKeys.has(titleKey) ||
      seenTitleKeys.has(titleKey)
    ) {
      continue;
    }
    seenTitleKeys.add(titleKey);

    let score = 10;
    let matchTag = book.libraryName
      ? `On Your Shelf · ${book.libraryName}`
      : 'On Your Shelf';
    const reasons: string[] = [];

    const parsedSeries = parseSeriesVolume(book.series);
    if (parsedSeries) {
      const matchedSeries = activeSeriesNorm.get(
        normalizeRecommendationText(parsedSeries.seriesName),
      );
      if (matchedSeries) {
        score += 50;
        matchTag = `Next in ${matchedSeries.seriesName} · ${book.libraryName || 'Your Shelf'}`;
        reasons.push(
          `Continues ${matchedSeries.seriesName} after "${matchedSeries.seedBookTitle}", already waiting in ${book.libraryName || 'your library'}.`,
        );
      }
    }

    const authorKey = normalizeRecommendationText(book.author);
    if (authorKey && topAuthorsNorm.has(authorKey)) {
      score += 35;
      if (reasons.length === 0) {
        matchTag = `Favorite Author · ${book.libraryName || 'Your Shelf'}`;
        reasons.push(
          `Another work by ${book.author}, one of your highest-rated authors, sitting unread in ${book.libraryName || 'your library'}.`,
        );
      }
    }

    if (
      book.primaryGenre &&
      topGenresSet.has(book.primaryGenre.toLowerCase())
    ) {
      score += 20;
      if (reasons.length === 0) {
        reasons.push(
          `Matches your affinity for ${book.primaryGenre} and is ready to read on the shelves of ${book.libraryName || 'your library'}.`,
        );
      }
    }

    if (Array.isArray(book.subgenres)) {
      for (const sub of book.subgenres) {
        if (topSubgenresSet.has(sub.toLowerCase())) {
          score += 10;
        }
      }
    }

    if (refreshSeed > 0) {
      score += ((i + refreshSeed * 7) % 13) * 1.5;
    }

    const defaultSynopsis = book.synopsis?.trim();
    const fallbackReason =
      reasons[0] ||
      (defaultSynopsis
        ? defaultSynopsis.length > 200
          ? `${defaultSynopsis.slice(0, 197).trimEnd()}...`
          : defaultSynopsis
        : `Waiting unread on the shelves of ${book.libraryName || 'your library'}.`);

    scored.push({
      score,
      item: {
        id: `shelf:${book.libraryId}:${book.id}`,
        title: book.title,
        author: book.author || 'Unknown Author',
        isbn: book.isbn,
        coverUrl: book.coverUrl,
        publishedDate: book.publishedDate,
        primaryGenre: book.primaryGenre,
        subgenres: book.subgenres,
        synopsis: book.synopsis,
        series: book.series,
        source: 'shelf',
        reason: fallbackReason,
        matchTag,
        libraryId: book.libraryId,
        libraryName: book.libraryName,
        bookId: book.id,
        readingStatus:
          book.readingStatus === 'want_to_read' ? 'want_to_read' : 'unset',
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(entry => entry.item);
}
