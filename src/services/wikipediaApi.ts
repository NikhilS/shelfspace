async function fetchSingleAuthorWiki(
  name: string,
  signal?: AbortSignal,
  timeoutMs = 8000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let combinedSignal = controller.signal;
  if (signal) {
    if (
      typeof AbortSignal !== 'undefined' &&
      'any' in AbortSignal &&
      typeof AbortSignal.any === 'function'
    ) {
      combinedSignal = AbortSignal.any([signal, controller.signal]);
    } else {
      signal.addEventListener('abort', () => controller.abort());
    }
  }

  try {
    const query = encodeURIComponent(name);
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&titles=${query}&origin=*`,
      {signal: combinedSignal},
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null; // Page not found

    const extract = pages[pageId]?.extract;
    if (
      extract &&
      typeof extract === 'string' &&
      extract.trim() !== '' &&
      !extract.toLowerCase().includes('may refer to:')
    ) {
      return extract.trim();
    }

    return null;
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') {
      console.warn(`Failed to fetch Wikipedia bio for author ${name}:`, error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function sanitizeAuthorName(rawAuthor: string): string[] {
  if (
    !rawAuthor ||
    rawAuthor.trim() === '' ||
    rawAuthor.toLowerCase() === 'unknown' ||
    rawAuthor.toLowerCase() === 'unknown author' ||
    rawAuthor.toLowerCase() === 'anonymous' ||
    rawAuthor.toLowerCase() === 'n/a'
  ) {
    return [];
  }

  // Remove role prefixes like "Edited by", "Translated by", "Written by", "Illustrated by"
  const cleaned = rawAuthor
    .replace(/^(edited|translated|written|illustrated|compiled)\s+by\s+/i, '')
    .replace(/\s*\([^)]*\)/g, '') // remove parentheticals like (Author) or (Editor)
    .trim();

  if (!cleaned) return [];

  const candidates: string[] = [cleaned];

  // If there are multiple authors separated by commas, ampersands, or 'and', try the first author as fallback
  const splitAuthors = cleaned
    .split(/,|\/|\s+&\s+|\s+and\s+/i)
    .map(a => a.trim())
    .filter(a => a.length > 1 && a.toLowerCase() !== 'unknown');

  if (splitAuthors.length > 1 && splitAuthors[0] !== cleaned) {
    candidates.push(splitAuthors[0]);
  }

  return Array.from(new Set(candidates));
}

export async function fetchAuthorBioFromWikipedia(
  authorName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const candidates = sanitizeAuthorName(authorName);
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    try {
      const bio = await fetchSingleAuthorWiki(candidate, signal);
      if (bio) {
        return bio;
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}
