export async function fetchAuthorBioFromWikipedia(
  authorName: string,
): Promise<string | null> {
  if (
    !authorName ||
    authorName.trim() === '' ||
    authorName.toLowerCase() === 'unknown'
  ) {
    return null;
  }

  try {
    const query = encodeURIComponent(authorName.trim());
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&titles=${query}&origin=*`,
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pages = data?.query?.pages;

    if (!pages) {
      return null;
    }

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') {
      return null; // Page not found
    }

    const extract = pages[pageId]?.extract;
    if (extract && extract.trim() !== '') {
      return extract.trim();
    }

    return null;
  } catch (error) {
    console.error(
      `Failed to fetch Wikipedia bio for author ${authorName}:`,
      error,
    );
    return null;
  }
}

export async function searchWikipediaForBook(
  title: string,
  author?: string,
): Promise<string | null> {
  if (!title || title.trim() === '') {
    return null;
  }

  try {
    const queryStr = author ? `${title} ${author}` : title;
    const query = encodeURIComponent(queryStr.trim());
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&utf8=&format=json&origin=*`,
    );

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const searchResults = searchData?.query?.search;

    if (!searchResults || searchResults.length === 0) return null;

    // Attempt to get the first result
    const bestTitle = searchResults[0].title;
    const extractRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(bestTitle)}&origin=*`,
    );

    if (!extractRes.ok) return null;
    const extractData = await extractRes.json();
    const pages = extractData?.query?.pages;

    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null;

    const extract = pages[pageId]?.extract;
    if (extract && extract.trim() !== '') {
      return extract.trim();
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch Wikipedia bio for book ${title}:`, error);
    return null;
  }
}
