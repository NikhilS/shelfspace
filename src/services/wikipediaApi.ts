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
