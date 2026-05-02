export interface BookDetails {
  title: string;
  author: string;
  isbn: string;
  coverUrl: string;
  publishedDate: string;
  genres?: string[];
  series?: string;
  synopsis?: string;
  authorBio?: string;
  format?: 'physical' | 'digital';
}

interface GoogleBooksItem {
  volumeInfo: {
    title?: string;
    authors?: string[];
    industryIdentifiers?: IndustryIdentifier[];
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
    publishedDate?: string;
    categories?: string[];
    description?: string;
  };
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  first_publish_year?: number;
}

interface IndustryIdentifier {
  type: string;
  identifier: string;
}

interface GoogleBooksResponse {
  items?: GoogleBooksItem[];
}

interface OpenLibraryResponse {
  docs?: OpenLibraryDoc[];
}

function extractIsbn(identifiers?: IndustryIdentifier[]): string {
  if (!identifiers) return '';
  const isbn13 = identifiers.find(id => id.type === 'ISBN_13');
  if (isbn13) return isbn13.identifier;
  const isbn10 = identifiers.find(id => id.type === 'ISBN_10');
  if (isbn10) return isbn10.identifier;
  return '';
}

function getHighResCoverUrl(url: string | undefined): string {
  if (!url) return '';
  // Upgrade Google Books URLs to higher resolution
  let hiResUrl = url.replace('http:', 'https:');
  if (hiResUrl.includes('books.google.com/books/content')) {
    // Remove edge=curl and set zoom=3
    hiResUrl = hiResUrl
      .replace(/&edge=curl/g, '')
      .replace(/&zoom=[0-9]/g, '&zoom=3');
  }
  return hiResUrl;
}

const getGoogleBooksUrl = (query: string): string => {
  const apiKey = (process.env as unknown as {BOOKS_API_KEY?: string})
    .BOOKS_API_KEY;
  const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}`;
  return apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;
};

export async function searchBookByIsbn(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookDetails | null> {
  try {
    let response = await fetch(getGoogleBooksUrl(`isbn:${isbn}`), {signal});
    if (response.ok) {
      let data = (await response.json()) as GoogleBooksResponse;

      // Fallback to general search if isbn: prefix fails
      if (!data.items || data.items.length === 0) {
        response = await fetch(getGoogleBooksUrl(isbn), {signal});
        data = (await response.json()) as GoogleBooksResponse;
      }

      if (data.items && data.items.length > 0) {
        const bookData = data.items[0].volumeInfo;
        return {
          title: bookData.title || 'Unknown Title',
          author: bookData.authors?.join(', ') || 'Unknown Author',
          isbn: extractIsbn(bookData.industryIdentifiers) || isbn,
          coverUrl: getHighResCoverUrl(
            bookData.imageLinks?.thumbnail ||
              bookData.imageLinks?.smallThumbnail,
          ),
          publishedDate: bookData.publishedDate || '',
          genres: bookData.categories || undefined,
          synopsis: bookData.description || undefined,
        };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    // Silently fallback to OpenLibrary if Google Books fails (e.g., ad blocker)
  }

  // Fallback to OpenLibrary
  try {
    // Use isbn= parameter for exact ISBN matching
    let response = await fetch(
      `https://openlibrary.org/search.json?isbn=${isbn}&limit=1`,
      {signal},
    );
    if (response.ok) {
      let data = (await response.json()) as OpenLibraryResponse;

      // Fallback to general search if isbn= prefix fails
      if (!data.docs || data.docs.length === 0) {
        response = await fetch(
          `https://openlibrary.org/search.json?q=${isbn}&limit=1`,
          {signal},
        );
        data = (await response.json()) as OpenLibraryResponse;
      }

      if (data.docs && data.docs.length > 0) {
        const doc = data.docs[0];
        return {
          title: doc.title || 'Unknown Title',
          author: doc.author_name?.join(', ') || 'Unknown Author',
          isbn: doc.isbn?.[0] || isbn,
          coverUrl: getHighResCoverUrl(
            doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
              : undefined,
          ),
          publishedDate: doc.first_publish_year?.toString() || '',
        };
      }
    }
  } catch (_error) {
    console.error('OpenLibrary ISBN search failed:', _error);
  }

  return null;
}

export async function searchBookByTitleAndAuthor(
  title: string | null | undefined,
  author: string | null | undefined,
  signal?: AbortSignal,
): Promise<BookDetails[]> {
  if (!title && !author) return [];
  let results: BookDetails[] = [];
  try {
    const q = encodeURIComponent(
      `intitle:"${title || ''}"+inauthor:"${author || ''}"`,
    );
    const response = await fetch(getGoogleBooksUrl(`${q}&maxResults=5`), {
      signal,
    });
    if (response.ok) {
      const data = (await response.json()) as GoogleBooksResponse;
      if (data.items && data.items.length > 0) {
        results = await Promise.all(
          data.items.map(async (item: GoogleBooksItem) => {
            const bookData = item.volumeInfo;
            return {
              title: bookData.title || title || 'Unknown Title',
              author:
                bookData.authors?.join(', ') || author || 'Unknown Author',
              isbn: extractIsbn(bookData.industryIdentifiers),
              coverUrl: getHighResCoverUrl(
                bookData.imageLinks?.thumbnail ||
                  bookData.imageLinks?.smallThumbnail,
              ),
              publishedDate: bookData.publishedDate || '',
              genres: bookData.categories || undefined,
              synopsis: bookData.description || undefined,
            };
          }),
        );
      }
    }
  } catch (_error) {
    console.error('Google Books search failed:', _error);
  }
  return results;
}

export async function searchBookByTitle(
  query: string | null | undefined,
  signal?: AbortSignal,
): Promise<BookDetails[]> {
  if (!query) return [];
  let results: BookDetails[] = [];
  const normalizedQuery = query.toLowerCase().trim();

  try {
    // Try intitle: first for exact title matches
    const response = await fetch(
      getGoogleBooksUrl(`intitle:${encodeURIComponent(query)}&maxResults=10`),
      {signal},
    );
    if (response.ok) {
      const data = (await response.json()) as GoogleBooksResponse;

      if (data.items && data.items.length > 0) {
        results = await Promise.all(
          data.items.map(async (item: GoogleBooksItem) => {
            const bookData = item.volumeInfo;
            return {
              title: bookData.title || 'Unknown Title',
              author: bookData.authors?.join(', ') || 'Unknown Author',
              isbn: extractIsbn(bookData.industryIdentifiers),
              coverUrl: getHighResCoverUrl(
                bookData.imageLinks?.thumbnail ||
                  bookData.imageLinks?.smallThumbnail,
              ),
              publishedDate: bookData.publishedDate || '',
              genres: bookData.categories || undefined,
              synopsis: bookData.description || undefined,
            };
          }),
        );
      }
    }

    // If intitle: yields nothing or few results, fallback to general search
    if (results.length < 5) {
      const fallbackResponse = await fetch(
        getGoogleBooksUrl(`${encodeURIComponent(query)}&maxResults=10`),
        {signal},
      );
      if (fallbackResponse.ok) {
        const fallbackData =
          (await fallbackResponse.json()) as GoogleBooksResponse;
        if (fallbackData.items && fallbackData.items.length > 0) {
          const fallbackResults = await Promise.all(
            fallbackData.items.map(async (item: GoogleBooksItem) => {
              const bookData = item.volumeInfo;
              return {
                title: bookData.title || 'Unknown Title',
                author: bookData.authors?.join(', ') || 'Unknown Author',
                isbn: extractIsbn(bookData.industryIdentifiers),
                coverUrl: getHighResCoverUrl(
                  bookData.imageLinks?.thumbnail ||
                    bookData.imageLinks?.smallThumbnail,
                ),
                publishedDate: bookData.publishedDate || '',
                genres: bookData.categories || undefined,
                synopsis: bookData.description || undefined,
              };
            }),
          );

          // Merge and deduplicate by title+author
          const seen = new Set(results.map(r => `${r.title}-${r.author}`));
          for (const r of fallbackResults) {
            if (!seen.has(`${r.title}-${r.author}`)) {
              results.push(r);
              seen.add(`${r.title}-${r.author}`);
            }
          }
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    // Silently fallback to OpenLibrary if Google Books fails (e.g., ad blocker)
  }

  // Fallback to OpenLibrary if Google Books fails completely or returns nothing
  if (results.length === 0) {
    try {
      // Use title= parameter for better title matching
      let response = await fetch(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=10`,
      );
      if (response.ok) {
        let data = (await response.json()) as OpenLibraryResponse;

        // Fallback to general search if title= prefix fails
        if (!data.docs || data.docs.length === 0) {
          response = await fetch(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`,
          );
          data = (await response.json()) as OpenLibraryResponse;
        }

        if (data.docs && data.docs.length > 0) {
          results = await Promise.all(
            data.docs.map(async (doc: OpenLibraryDoc) => ({
              title: doc.title || 'Unknown Title',
              author: doc.author_name?.join(', ') || 'Unknown Author',
              isbn: doc.isbn?.[0] || '',
              coverUrl: getHighResCoverUrl(
                doc.cover_i
                  ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
                  : undefined,
              ),
              publishedDate: doc.first_publish_year?.toString() || '',
            })),
          );
        }
      }
    } catch (_error) {
      console.error('OpenLibrary title search failed:', _error);
    }
  }

  // Sort results to prioritize exact matches
  return results.sort((a, b) => {
    const aTitle = (a.title || '').toLowerCase();
    const bTitle = (b.title || '').toLowerCase();

    const aExact = aTitle === normalizedQuery;
    const bExact = bTitle === normalizedQuery;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aStarts = aTitle.startsWith(normalizedQuery);
    const bStarts = bTitle.startsWith(normalizedQuery);

    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    // If both start with the query, sort by length (shorter is closer to exact)
    if (aStarts && bStarts) {
      return aTitle.length - bTitle.length;
    }

    return 0;
  });
}
