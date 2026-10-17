import {Type} from '@google/genai';
import Papa from 'papaparse';
import {
  logger,
  generateContentWithLimiter,
  isApiKeyError,
  handleGeminiError,
} from './client';

export async function extractBooksFromImage(
  base64Image: string,
  mimeType: string,
): Promise<{title: string; author: string; isbn?: string}[]> {
  try {
    logger.info(`Starting book extraction from image (${mimeType})...`);
    if (!base64Image || base64Image === 'data:,') {
      logger.error('Invalid image data: image is empty');
      throw new Error('Invalid image data provided.');
    }
    const extractionSchema = {
      type: Type.ARRAY,
      description: 'Array of detected books on the shelf or cover',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {type: Type.STRING, description: 'Book title'},
          author: {type: Type.STRING, description: 'Author or editor name'},
          isbn: {
            type: Type.STRING,
            description: 'ISBN-10 or ISBN-13 if legible, otherwise null',
          },
        },
        required: ['title', 'author'],
      },
    };

    const prompt = `Analyze this image of physical books (such as a bookshelf, book stack, or book covers) with high optical precision.
Detect and transcribe every distinct book clearly visible in the image (both vertically shelved and horizontally stacked books).

For each book detected:
1. "title": The complete, clean title of the book. Use standard capitalization. Exclude extraneous promotional quotes, publisher logos, or price stickers.
2. "author": The primary author, co-author, or editor. Do NOT include publisher imprints (such as Penguin, Vintage, Harper, Tor, Oxford).
3. "isbn": If an ISBN-10 or ISBN-13 is legibly printed or visible as a barcode on the spine or cover, extract it as clean digits; otherwise return null.

Important Directives:
- Transcribe in natural reading order (left to right, top to bottom where possible).
- Do not invent or hallucinate titles that cannot be deciphered with confidence.`;

    const generateCall = async (model: string) => {
      return generateContentWithLimiter({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image.split(',')[1] || base64Image,
              },
            },
            {text: prompt},
          ],
        },
        config: {
          systemInstruction:
            'You are a specialized computer vision and optical recognition system for books and library collections. Your goal is to accurately transcribe book titles, author names, and visible ISBNs from shelf or cover photographs.',
          responseMimeType: 'application/json',
          responseSchema: extractionSchema,
        },
      });
    };

    const timeoutPromise = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('API_TIMEOUT')), ms),
      );

    let response;
    try {
      logger.info('Calling Gemini 3.8 Flash for book extraction...');
      response = await Promise.race([
        generateCall('gemini-3.8-flash'),
        timeoutPromise(25000),
      ]);
      logger.info('Gemini 3.8 Flash response received.');
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      const isTimeout = e instanceof Error && e.message === 'API_TIMEOUT';
      logger.warn(
        `Gemini 3.8 Flash ${isTimeout ? 'timed out' : 'failed'}, retrying with Gemini 3.1 Pro: ${e instanceof Error ? e.message : String(e)}`,
      );
      try {
        response = await Promise.race([
          generateCall('gemini-3.1-pro-preview'),
          timeoutPromise(30000),
        ]);
        logger.info('Gemini 3.1 Pro response received.');
      } catch (err: unknown) {
        if (isApiKeyError(err)) {
          throw err;
        }
        logger.warn(
          'Gemini 3.1 Pro failed, retrying with Gemini 3.8 Flash backup: ' +
            (err instanceof Error ? err.message : String(err)),
        );
        response = await Promise.race([
          generateCall('gemini-3.8-flash'),
          timeoutPromise(25000),
        ]);
        logger.info('Gemini 3.8 Flash backup response received.');
      }
    }

    let text = response.text;
    if (!text) {
      logger.warn('Gemini returned empty text response');
      return [];
    }

    logger.info(`Raw response length: ${text.length} chars`);

    text = text
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        logger.info(`Successfully parsed ${parsed.length} books from image`);
        return parsed;
      }
      logger.warn('Gemini response is not an array');
      return [];
    } catch (e: unknown) {
      logger.warn(
        `Failed to parse Gemini JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  } catch (error) {
    if (isApiKeyError(error)) {
      logger.info(
        'Book extraction is pending valid GEMINI_API_KEY configuration.',
      );
    } else {
      logger.error(
        `Fatal error in extraction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    handleGeminiError(error);
  }
}

export async function extractBooksFromCsv(csvText: string): Promise<
  {
    title: string;
    author: string;
    isbn?: string;
    format?: 'physical' | 'digital';
  }[]
> {
  try {
    const parsed = await new Promise<Papa.ParseResult<unknown>>(
      (resolve, reject) => {
        Papa.parse(csvText, {
          header: false,
          skipEmptyLines: true,
          worker: true,
          complete: results => resolve(results),
          error: (error: unknown) => reject(error),
        });
      },
    );

    const rows = parsed.data as string[][];
    if (rows.length === 0) return [];

    const sampleRows = rows.slice(0, 5);

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: `Analyze these sample rows from an uploaded book collection CSV file (parsed as an array of rows):
      
CSV Sample Rows:
${JSON.stringify(sampleRows, null, 2)}

Your task is to inspect the spreadsheet layout and map the columns:
1. Determine if row 0 is a header row (containing labels like 'Title', 'Author', 'ISBN', 'Binding', 'Format', 'Year', etc.).
2. Identify the 0-based column index for:
   - title: (required) Main title of the book. Common column names: 'Title', 'Book Title', 'Work', 'Name'.
   - author: (required) Creator or writer name. Common column names: 'Author', 'Authors', 'Creator', 'Writer', 'Author l-f'.
   - isbn: (optional) Numeric identifier. Common column names: 'ISBN', 'ISBN13', 'ISBN10', 'Barcode'. Look for 10 or 13-digit numbers.
   - format: (optional) Book binding or digital type. Common column names: 'Format', 'Binding', 'Type', 'Media'. Look for values like 'Paperback', 'Hardcover', 'Kindle', 'Ebook'.

If an optional attribute (isbn, format) is not found in any column, set its column index to null.`,
      config: {
        systemInstruction:
          'You are an intelligent data ingestion assistant specializing in book spreadsheets and library exports (such as Goodreads, StoryGraph, Calibre, LibraryThing, and custom CSV catalogs).',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          description: 'CSV column mapping configuration',
          properties: {
            hasHeaderRow: {
              type: Type.BOOLEAN,
              description: 'Whether the first row contains column headers',
            },
            columnMap: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.INTEGER,
                  description: '0-based column index of the book title',
                },
                author: {
                  type: Type.INTEGER,
                  description: '0-based column index of the author',
                },
                isbn: {
                  type: Type.INTEGER,
                  description:
                    '0-based column index of ISBN if present, otherwise null',
                },
                format: {
                  type: Type.INTEGER,
                  description:
                    '0-based column index of binding/format if present, otherwise null',
                },
              },
              required: ['title', 'author'],
            },
          },
          required: ['hasHeaderRow', 'columnMap'],
        },
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text) return [];

    let schema: {
      hasHeaderRow?: boolean;
      columnMap?: {
        title?: number;
        author?: number;
        isbn?: number | null;
        format?: number | null;
      };
    };
    try {
      schema = JSON.parse(text);
    } catch (e) {
      console.warn('Failed to parse Gemini schema response:', e);
      return [];
    }

    const {hasHeaderRow, columnMap} = schema;

    if (
      !columnMap ||
      typeof columnMap !== 'object' ||
      typeof columnMap.title !== 'number' ||
      typeof columnMap.author !== 'number'
    ) {
      return [];
    }

    const books: {
      title: string;
      author: string;
      isbn?: string;
      format?: 'physical' | 'digital';
    }[] = [];
    const startIndex = hasHeaderRow ? 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const titleIndex = columnMap.title;
      if (typeof titleIndex !== 'number' || !row[titleIndex]?.trim()) continue;

      let isbn: string | undefined = undefined;
      if (typeof columnMap.isbn === 'number') {
        const rawIsbn = row[columnMap.isbn] || '';
        const cleaned = rawIsbn.replace(/[^0-9X]/gi, '');
        if (cleaned.length >= 10) isbn = cleaned;
      }

      let format: 'physical' | 'digital' | undefined = undefined;
      if (typeof columnMap.format === 'number') {
        const fVal = (row[columnMap.format] || '').toLowerCase();
        if (fVal) {
          if (
            fVal.includes('kindle') ||
            fVal.includes('ebook') ||
            fVal.includes('digital') ||
            fVal.includes('audiobook')
          ) {
            format = 'digital';
          } else {
            format = 'physical';
          }
        }
      }

      books.push({
        title: row[titleIndex].trim(),
        author:
          typeof columnMap.author === 'number'
            ? (row[columnMap.author] || 'Unknown').trim()
            : 'Unknown',
        isbn,
        format,
      });
    }

    return books;
  } catch (error) {
    handleGeminiError(error);
  }
}
