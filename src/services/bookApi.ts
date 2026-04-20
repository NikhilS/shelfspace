export interface BookDetails {
  title: string;
  author: string;
  isbn: string;
  coverUrl: string;
  publishedDate: string;
  genre?: string;
  series?: string;
  description?: string;
}

function extractIsbn(identifiers: any[]): string {
  if (!identifiers) return '';
  const isbn13 = identifiers.find((id: any) => id.type === 'ISBN_13');
  if (isbn13) return isbn13.identifier;
  const isbn10 = identifiers.find((id: any) => id.type === 'ISBN_10');
  if (isbn10) return isbn10.identifier;
  return '';
}

export async function searchBookByIsbn(isbn: string): Promise<BookDetails | null> {
  try {
    let response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (response.ok) {
      let data = await response.json();
      
      // Fallback to general search if isbn: prefix fails
      if (!data.items || data.items.length === 0) {
        response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${isbn}`);
        data = await response.json();
      }

      if (data.items && data.items.length > 0) {
        const bookData = data.items[0].volumeInfo;
        return {
          title: bookData.title || 'Unknown Title',
          author: bookData.authors?.join(', ') || 'Unknown Author',
          isbn: extractIsbn(bookData.industryIdentifiers) || isbn,
          coverUrl: bookData.imageLinks?.thumbnail?.replace('http:', 'https:') || bookData.imageLinks?.smallThumbnail?.replace('http:', 'https:') || '',
          publishedDate: bookData.publishedDate || ''
        };
      }
    }
  } catch (error) {
    // Silently fallback to OpenLibrary if Google Books fails (e.g., ad blocker)
  }

  // Fallback to OpenLibrary
  try {
    // Use isbn= parameter for exact ISBN matching
    let response = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&limit=1`);
    if (response.ok) {
      let data = await response.json();
      
      // Fallback to general search if isbn= prefix fails
      if (!data.docs || data.docs.length === 0) {
        response = await fetch(`https://openlibrary.org/search.json?q=${isbn}&limit=1`);
        data = await response.json();
      }

      if (data.docs && data.docs.length > 0) {
        const doc = data.docs[0];
        return {
          title: doc.title || 'Unknown Title',
          author: doc.author_name?.join(', ') || 'Unknown Author',
          isbn: doc.isbn?.[0] || isbn,
          coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
          publishedDate: doc.first_publish_year?.toString() || ''
        };
      }
    }
  } catch (error) {
    console.error("OpenLibrary ISBN search failed:", error);
  }

  return null;
}

export async function searchBookByTitleAndAuthor(title: string, author: string): Promise<BookDetails[]> {
  let results: BookDetails[] = [];
  try {
    const q = encodeURIComponent(`intitle:"${title}"+inauthor:"${author}"`);
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5`);
    if (response.ok) {
      const data = await response.json();
      if (data.items && data.items.length > 0) {
        results = data.items.map((item: any) => {
          const bookData = item.volumeInfo;
          return {
            title: bookData.title || title,
            author: bookData.authors?.join(', ') || author,
            isbn: extractIsbn(bookData.industryIdentifiers),
            coverUrl: bookData.imageLinks?.thumbnail?.replace('http:', 'https:') || bookData.imageLinks?.smallThumbnail?.replace('http:', 'https:') || '',
            publishedDate: bookData.publishedDate || '',
            genre: bookData.categories?.[0] || undefined
          };
        });
      }
    }
  } catch (error) {
    console.error("Google Books search failed:", error);
  }
  return results;
}

export async function searchBookByTitle(query: string): Promise<BookDetails[]> {
  let results: BookDetails[] = [];
  const normalizedQuery = query.toLowerCase().trim();

  try {
    // Try intitle: first for exact title matches
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(query)}&maxResults=10`);
    if (response.ok) {
      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        results = data.items.map((item: any) => {
          const bookData = item.volumeInfo;
          return {
            title: bookData.title || 'Unknown Title',
            author: bookData.authors?.join(', ') || 'Unknown Author',
            isbn: extractIsbn(bookData.industryIdentifiers),
            coverUrl: bookData.imageLinks?.thumbnail?.replace('http:', 'https:') || bookData.imageLinks?.smallThumbnail?.replace('http:', 'https:') || '',
            publishedDate: bookData.publishedDate || ''
          };
        });
      }
    }
    
    // If intitle: yields nothing or few results, fallback to general search
    if (results.length < 5) {
      const fallbackResponse = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`);
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        if (fallbackData.items && fallbackData.items.length > 0) {
          const fallbackResults = fallbackData.items.map((item: any) => {
            const bookData = item.volumeInfo;
            return {
              title: bookData.title || 'Unknown Title',
              author: bookData.authors?.join(', ') || 'Unknown Author',
              isbn: extractIsbn(bookData.industryIdentifiers),
              coverUrl: bookData.imageLinks?.thumbnail?.replace('http:', 'https:') || bookData.imageLinks?.smallThumbnail?.replace('http:', 'https:') || '',
              publishedDate: bookData.publishedDate || ''
            };
          });
          
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
  } catch (error) {
    // Silently fallback to OpenLibrary if Google Books fails (e.g., ad blocker)
  }

  // Fallback to OpenLibrary if Google Books fails completely or returns nothing
  if (results.length === 0) {
    try {
      // Use title= parameter for better title matching
      let response = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=10`);
      if (response.ok) {
        let data = await response.json();
        
        // Fallback to general search if title= prefix fails
        if (!data.docs || data.docs.length === 0) {
          response = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`);
          data = await response.json();
        }

        if (data.docs && data.docs.length > 0) {
          results = data.docs.map((doc: any) => ({
            title: doc.title || 'Unknown Title',
            author: doc.author_name?.join(', ') || 'Unknown Author',
            isbn: doc.isbn?.[0] || '',
            coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
            publishedDate: doc.first_publish_year?.toString() || ''
          }));
        }
      }
    } catch (error) {
      console.error("OpenLibrary title search failed:", error);
    }
  }

  // Sort results to prioritize exact matches
  return results.sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    
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
