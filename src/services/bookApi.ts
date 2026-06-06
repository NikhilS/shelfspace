import {
  toSentenceCase,
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
} from '../lib/utils';

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

const memoryCache = new Map<string, unknown>();

export function clearBookCache(): void {
  memoryCache.clear();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const keys = Object.keys(window.localStorage);
      for (const k of keys) {
        if (k.startsWith('bk_cache_')) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      // Ignore
    }
  }
}

function getCache<T>(key: string): T | null {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const item = window.localStorage.getItem(`bk_cache_${key}`);
      if (item) {
        const parsed = JSON.parse(item);
        memoryCache.set(key, parsed);
        return parsed as T;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function setCache<T>(key: string, value: T): void {
  memoryCache.set(key, value);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`bk_cache_${key}`, JSON.stringify(value));
    } catch {
      // Ignore
    }
  }
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
  const apiKey =
    typeof process !== 'undefined' && process.env
      ? process.env.BOOKS_API_KEY || process.env.VITE_BOOKS_API_KEY
      : import.meta.env.VITE_BOOKS_API_KEY;
  const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}`;
  return apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;
};

export async function searchBookByIsbn(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookDetails | null> {
  const normalizedIsbnKey = isbn.trim().toUpperCase();
  const cached = getCache<BookDetails | null>(`isbn_${normalizedIsbnKey}`);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  let googleBooksSucceeded = false;
  let result: BookDetails | null = null;

  try {
    let response = await fetch(getGoogleBooksUrl(`isbn:${isbn}`), {signal});
    if (response.status === 429) {
      console.warn(
        'Google Books API rate limit (429) on ISBN search. Proceeding to OpenLibrary...',
      );
    } else if (response.ok) {
      let data = (await response.json()) as GoogleBooksResponse;

      // Fallback to general search if isbn: prefix fails
      if (!data.items || data.items.length === 0) {
        response = await fetch(getGoogleBooksUrl(isbn), {signal});
        if (response.status === 429) {
          console.warn(
            'Google Books API rate limit (429) on general ISBN search. Proceeding to OpenLibrary...',
          );
        } else if (response.ok) {
          data = (await response.json()) as GoogleBooksResponse;
        }
      }

      if (data.items && data.items.length > 0) {
        const bookData = data.items[0].volumeInfo;
        result = {
          title: normalizeTitle(bookData.title || 'Unknown Title'),
          author: normalizeName(
            bookData.authors?.join(', ') || 'Unknown Author',
          ),
          isbn: normalizeIsbn(
            extractIsbn(bookData.industryIdentifiers) || isbn,
          ),
          coverUrl: getHighResCoverUrl(
            bookData.imageLinks?.thumbnail ||
              bookData.imageLinks?.smallThumbnail,
          ),
          publishedDate: bookData.publishedDate || '',
          genres: bookData.categories
            ? bookData.categories.map(toSentenceCase)
            : undefined,
          synopsis: normalizeText(bookData.description || undefined),
        };
        googleBooksSucceeded = true;
      }
    }
  } catch (_error) {
    console.warn(
      'Google Books ISBN search failed, proceeding to OpenLibrary fallback:',
      _error,
    );
  }

  if (googleBooksSucceeded && result) {
    setCache(`isbn_${normalizedIsbnKey}`, result);
    return result;
  }

  // Fallback to OpenLibrary
  try {
    // Use isbn= parameter for exact ISBN matching
    let response = await fetch(
      `https://openlibrary.org/search.json?isbn=${isbn}&limit=1`,
      {signal},
    );
    if (response.status === 429) {
      console.warn('OpenLibrary API rate limit (429) on ISBN search.');
    } else if (response.ok) {
      let data = (await response.json()) as OpenLibraryResponse;

      // Fallback to general search if isbn= prefix fails
      if (!data.docs || data.docs.length === 0) {
        response = await fetch(
          `https://openlibrary.org/search.json?q=${isbn}&limit=1`,
          {signal},
        );
        if (response.status === 429) {
          console.warn(
            'OpenLibrary API rate limit (429) on general ISBN search.',
          );
        } else if (response.ok) {
          data = (await response.json()) as OpenLibraryResponse;
        }
      }

      if (data.docs && data.docs.length > 0) {
        const doc = data.docs[0];
        result = {
          title: normalizeTitle(doc.title || 'Unknown Title'),
          author: normalizeName(
            doc.author_name?.join(', ') || 'Unknown Author',
          ),
          isbn: normalizeIsbn(doc.isbn?.[0] || isbn),
          coverUrl: getHighResCoverUrl(
            doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
              : undefined,
          ),
          publishedDate: doc.first_publish_year?.toString() || '',
        };
        setCache(`isbn_${normalizedIsbnKey}`, result);
        return result;
      }
    }
  } catch (_error) {
    console.warn('OpenLibrary ISBN search failed:', _error);
  }

  setCache(`isbn_${normalizedIsbnKey}`, null);
  return null;
}

export async function searchBookByTitleAndAuthor(
  title: string | null | undefined,
  author: string | null | undefined,
  signal?: AbortSignal,
): Promise<BookDetails[]> {
  if (!title && !author) return [];

  const cacheKey = `title_author_${encodeURIComponent((title || '').trim().toLowerCase())}_${encodeURIComponent((author || '').trim().toLowerCase())}`;
  const cached = getCache<BookDetails[]>(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  let results: BookDetails[] = [];
  try {
    const q = encodeURIComponent(
      `intitle:"${title || ''}"+inauthor:"${author || ''}"`,
    );
    const response = await fetch(getGoogleBooksUrl(`${q}&maxResults=5`), {
      signal,
    });
    if (response.status === 429) {
      console.warn(
        'Google Books API rate limit (429) on title & author search.',
      );
    } else if (response.ok) {
      const data = (await response.json()) as GoogleBooksResponse;
      if (data.items && data.items.length > 0) {
        results = data.items.map((item: GoogleBooksItem) => {
          const bookData = item.volumeInfo;
          return {
            title: normalizeTitle(bookData.title || title || 'Unknown Title'),
            author: normalizeName(
              bookData.authors?.join(', ') || author || 'Unknown Author',
            ),
            isbn: normalizeIsbn(extractIsbn(bookData.industryIdentifiers)),
            coverUrl: getHighResCoverUrl(
              bookData.imageLinks?.thumbnail ||
                bookData.imageLinks?.smallThumbnail,
            ),
            publishedDate: bookData.publishedDate || '',
            genres: bookData.categories
              ? bookData.categories.map(toSentenceCase)
              : undefined,
            synopsis: normalizeText(bookData.description || undefined),
          };
        });
      }
    }
  } catch (_error) {
    if ((_error as Error).name === 'AbortError') throw _error;
    console.warn('Google Books search failed:', _error);
  }

  setCache(cacheKey, results);
  return results;
}

export async function searchBookByTitle(
  query: string | null | undefined,
  signal?: AbortSignal,
): Promise<BookDetails[]> {
  if (!query) return [];
  const normalizedQuery = query.toLowerCase().trim();
  const cacheKey = `title_${encodeURIComponent(normalizedQuery)}`;
  const cached = getCache<BookDetails[]>(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  let results: BookDetails[] = [];

  try {
    const q = `intitle:${encodeURIComponent(query)}&maxResults=10`;
    const response = await fetch(getGoogleBooksUrl(q), {signal});
    if (response.status === 429) {
      console.warn('Google Books API rate limit (429) on title search.');
    } else if (response.ok) {
      const data = (await response.json()) as GoogleBooksResponse;

      if (data.items && data.items.length > 0) {
        results = data.items.map((item: GoogleBooksItem) => {
          const bookData = item.volumeInfo;
          return {
            title: normalizeTitle(bookData.title || 'Unknown Title'),
            author: normalizeName(
              bookData.authors?.join(', ') || 'Unknown Author',
            ),
            isbn: normalizeIsbn(extractIsbn(bookData.industryIdentifiers)),
            coverUrl: getHighResCoverUrl(
              bookData.imageLinks?.thumbnail ||
                bookData.imageLinks?.smallThumbnail,
            ),
            publishedDate: bookData.publishedDate || '',
            genres: bookData.categories
              ? bookData.categories.map(toSentenceCase)
              : undefined,
            synopsis: normalizeText(bookData.description || undefined),
          };
        });
      }
    }

    // If intitle: yields nothing or few results, fallback to general search
    if (results.length < 5) {
      const fallbackResponse = await fetch(
        getGoogleBooksUrl(`${encodeURIComponent(query)}&maxResults=10`),
        {signal},
      );
      if (fallbackResponse.status === 429) {
        console.warn(
          'Google Books API rate limit (429) on general fallback title search.',
        );
      } else if (fallbackResponse.ok) {
        const fallbackData =
          (await fallbackResponse.json()) as GoogleBooksResponse;
        if (fallbackData.items && fallbackData.items.length > 0) {
          const fallbackResults = fallbackData.items.map(
            (item: GoogleBooksItem) => {
              const bookData = item.volumeInfo;
              return {
                title: normalizeTitle(bookData.title || 'Unknown Title'),
                author: normalizeName(
                  bookData.authors?.join(', ') || 'Unknown Author',
                ),
                isbn: normalizeIsbn(extractIsbn(bookData.industryIdentifiers)),
                coverUrl: getHighResCoverUrl(
                  bookData.imageLinks?.thumbnail ||
                    bookData.imageLinks?.smallThumbnail,
                ),
                publishedDate: bookData.publishedDate || '',
                genres: bookData.categories
                  ? bookData.categories.map(toSentenceCase)
                  : undefined,
                synopsis: normalizeText(bookData.description || undefined),
              };
            },
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
  } catch (_error) {
    if ((_error as Error).name === 'AbortError') throw _error;
    console.warn('Google Books title search failed:', _error);
  }

  if (results.length === 0) {
    try {
      let response = await fetch(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=10`,
        {signal},
      );
      if (response.status === 429) {
        console.warn('OpenLibrary API rate limit (429) on title search.');
      } else if (response.ok) {
        let data = (await response.json()) as OpenLibraryResponse;

        if (!data.docs || data.docs.length === 0) {
          response = await fetch(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`,
            {signal},
          );
          if (response.status === 429) {
            console.warn(
              'OpenLibrary API rate limit (429) on general fallback search.',
            );
          } else if (response.ok) {
            data = (await response.json()) as OpenLibraryResponse;
          }
        }

        if (data.docs && data.docs.length > 0) {
          results = data.docs.map((doc: OpenLibraryDoc) => ({
            title: normalizeTitle(doc.title || 'Unknown Title'),
            author: normalizeName(
              doc.author_name?.join(', ') || 'Unknown Author',
            ),
            isbn: normalizeIsbn(doc.isbn?.[0] || ''),
            coverUrl: getHighResCoverUrl(
              doc.cover_i
                ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
                : undefined,
            ),
            publishedDate: doc.first_publish_year?.toString() || '',
          }));
        }
      }
    } catch (_error) {
      if ((_error as Error).name === 'AbortError') throw _error;
      console.warn('OpenLibrary title search failed:', _error);
    }
  }

  // Sort results to prioritize exact matches
  const sorted = results.sort((a, b) => {
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

  setCache(cacheKey, sorted);
  return sorted;
}
