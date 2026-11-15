import {Decisions, ThinkingLevel, Type} from '@google/genai';
import Papa from 'papaparse';
import type {
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
  DecisionScoreAnswer,
} from '../../../schemas/decisions';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {
  decideWithLimiter,
  geminiDecisionProvider,
  generateContentWithLimiter,
  handleGeminiError,
  isApiKeyError,
  logger,
} from './client';

export class BookshelfPrescreenError extends Error {
  readonly primaryIssue: string;

  constructor(message: string, primaryIssue: string) {
    super(message);
    this.name = 'BookshelfPrescreenError';
    this.primaryIssue = primaryIssue;
  }
}

export interface BookshelfPhotoPrescreenResult {
  allowExtraction: boolean;
  hasBooksProbability: number;
  legibilityScore: number;
  primaryIssue: string;
  userMessage?: string;
}

const BOOKSHELF_LEGIBILITY_RUBRIC: string[] = [
  '0: Completely unreadable — severe motion blur, extreme darkness, glare, or spines too tiny to read any title.',
  '1: Barely legible — most titles are obscured or blurred beyond reliable transcription.',
  '2: Moderately legible — several book titles and authors can be transcribed accurately.',
  '3: Crisp and clear — book spines or covers are sharp, well-lit, and readily legible.',
];

const BOOKSHELF_ISSUE_CRITERIA: Record<string, string> = {
  none: 'Photo clearly shows legible books',
  no_books_visible:
    'No physical books, book spines, or book covers appear in the frame',
  too_blurry_or_glare:
    'Severe motion blur, out-of-focus lens, or strong specular glare obscures spine text',
  too_dark_or_distant:
    'Lighting is too dim or camera is too far away to read spine lettering',
};

const ISSUE_USER_MESSAGES: Record<string, string> = {
  no_books_visible:
    'No books were detected in this photo. Frame a bookshelf, stack, or book cover and try again.',
  too_blurry_or_glare:
    'This shelf photo is too blurry or has strong glare over the spines. Hold steady in even light and retake.',
  too_dark_or_distant:
    'Book spines are too dim or far away to read clearly. Move closer with brighter lighting and try again.',
};

export async function prescreenBookshelfImage(
  base64Image: string,
  mimeType: string,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<BookshelfPhotoPrescreenResult> {
  const rawData = base64Image.includes(',')
    ? base64Image.split(',')[1] || ''
    : base64Image;

  if (!rawData.trim()) {
    return {
      allowExtraction: false,
      hasBooksProbability: 0,
      legibilityScore: 0,
      primaryIssue: 'no_books_visible',
      userMessage: ISSUE_USER_MESSAGES.no_books_visible,
    };
  }

  const questions: Record<string, Decisions.Question> = {
    has_books: {
      type: 'noul',
      instructions:
        'Does this photograph visibly contain one or more physical books, book spines, or book covers?',
      criteria: {
        true_description:
          'At least one physical book cover, book stack, or shelved book spine is visible.',
        false_description:
          'No books are visible (blank wall, floor, person, pet, screen, or unrelated object).',
      },
    },
    legibility: {
      type: 'score',
      instructions:
        'Rate the optical legibility of the book titles/spines in this photograph for OCR transcription.',
      criteria: BOOKSHELF_LEGIBILITY_RUBRIC,
    },
    primary_issue: {
      type: 'choice',
      instructions:
        'Identify the primary optical quality status or issue in this bookshelf photograph.',
      criteria: BOOKSHELF_ISSUE_CRITERIA,
    },
  };

  const answers = await decideWithLimiter(
    {
      input: [
        {
          type: 'image',
          data: rawData,
          mime_type: mimeType || 'image/jpeg',
        },
        {
          type: 'text',
          text: 'Inspect this bookshelf or book cover photograph before optical spine transcription.',
        },
      ],
      questions,
      operation: 'gemini.prescreenBookshelfImage',
    },
    {
      priority: options?.priority ?? 'INTERACTIVE',
      signal: options?.signal,
    },
  );

  const hasBooksAns = answers.has_books as DecisionNoulAnswer | undefined;
  const legibilityAns = answers.legibility as DecisionScoreAnswer | undefined;
  const issueAns = answers.primary_issue as DecisionChoiceAnswer | undefined;

  if (!hasBooksAns && !legibilityAns) {
    return {
      allowExtraction: true,
      hasBooksProbability: 1,
      legibilityScore: 3,
      primaryIssue: 'none',
    };
  }

  const hasBooksProbability =
    hasBooksAns?.type === 'noul' ? hasBooksAns.noul : 1;
  const legibilityScore =
    legibilityAns?.type === 'score' ? legibilityAns.score : 3;
  const primaryIssue = issueAns?.type === 'choice' ? issueAns.choice : 'none';

  if (hasBooksProbability < 0.25) {
    return {
      allowExtraction: false,
      hasBooksProbability,
      legibilityScore,
      primaryIssue: 'no_books_visible',
      userMessage: ISSUE_USER_MESSAGES.no_books_visible,
    };
  }

  if (legibilityScore < 1.0) {
    const resolvedIssue =
      primaryIssue in ISSUE_USER_MESSAGES
        ? primaryIssue
        : 'too_blurry_or_glare';
    return {
      allowExtraction: false,
      hasBooksProbability,
      legibilityScore,
      primaryIssue: resolvedIssue,
      userMessage: ISSUE_USER_MESSAGES[resolvedIssue],
    };
  }

  return {
    allowExtraction: true,
    hasBooksProbability,
    legibilityScore,
    primaryIssue,
  };
}

export async function extractBooksFromImage(
  base64Image: string,
  mimeType: string,
): Promise<Array<{title: string; author: string; isbn?: string}>> {
  try {
    logger.info(`Starting book extraction from image (${mimeType})...`);
    if (!base64Image || base64Image === 'data:,') {
      logger.error('Invalid image data: image is empty');
      throw new Error('Invalid image data provided.');
    }

    if (geminiDecisionProvider.isAvailable()) {
      try {
        const prescreen = await prescreenBookshelfImage(base64Image, mimeType, {
          priority: 'INTERACTIVE',
        });
        if (!prescreen.allowExtraction && prescreen.userMessage) {
          throw new BookshelfPrescreenError(
            prescreen.userMessage,
            prescreen.primaryIssue,
          );
        }
      } catch (prescreenErr) {
        if (prescreenErr instanceof BookshelfPrescreenError) {
          throw prescreenErr;
        }
        logger.warn(
          `Bookshelf pre-screening skipped due to non-fatal error: ${prescreenErr instanceof Error ? prescreenErr.message : String(prescreenErr)}`,
        );
      }
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

    const prompt = `Analyze this photograph of physical books (bookshelf, stack, or covers) with high optical precision.
Detect and transcribe every distinct book clearly legible in the image (both vertically shelved spines and horizontally stacked volumes).

For each book detected:
1. "title": Complete, clean title of the book in standard title case. Exclude promotional blurbs ("New York Times Bestseller"), price stickers, or publisher logos.
2. "author": Primary author, co-author, or volume editor. Ignore foreword/introduction/translator credits and never use publisher imprints (e.g., Penguin, Vintage, Harper, Tor, Oxford) as the author.
3. "isbn": If an ISBN-10 or ISBN-13 is legibly printed on the spine or cover barcode, extract it as clean digits; otherwise return null.

Important Directives:
- Scan systematically in reading order (left to right, top to bottom).
- Deduplicate identical spine reads unless multiple physical copies or distinct volume numbers are clearly visible.
- Never guess or hallucinate titles from unreadable or heavily blurred spines.`;

    const generateCall = async (
      model: string,
      thinkingLevel: ThinkingLevel = ThinkingLevel.LOW,
    ) => {
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
          temperature: 0.1,
          thinkingConfig: {
            thinkingLevel,
          },
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
        generateCall('gemini-3.8-flash', ThinkingLevel.LOW),
        timeoutPromise(25000),
      ]);
      logger.info('Gemini 3.8 Flash response received.');
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      const isTimeout = e instanceof Error && e.message === 'API_TIMEOUT';
      logger.warn(
        `Gemini 3.8 Flash ${isTimeout ? 'timed out' : 'failed'}, retrying with medium thinking: ${e instanceof Error ? e.message : String(e)}`,
      );
      response = await Promise.race([
        generateCall('gemini-3.8-flash', ThinkingLevel.MEDIUM),
        timeoutPromise(30000),
      ]);
      logger.info('Gemini 3.8 Flash retry response received.');
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
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const extracted = (parsed as unknown[])
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object',
          )
          .map(item => ({
            title: typeof item.title === 'string' ? item.title : '',
            author: typeof item.author === 'string' ? item.author : '',
            ...(typeof item.isbn === 'string' && item.isbn
              ? {isbn: item.isbn}
              : {}),
          }));
        logger.info(`Successfully parsed ${extracted.length} books from image`);
        return extracted;
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
    if (error instanceof BookshelfPrescreenError) {
      throw error;
    }
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

interface CsvColumnSchema {
  hasHeaderRow: boolean;
  columnMap: {
    title: number;
    author: number;
    isbn: number | null;
    format: number | null;
  };
}

/**
 * Deterministic zero-token CSV header detector for standard exports
 * (Goodreads, StoryGraph, Calibre, LibraryThing, and book(ish) CSVs).
 */
export function tryDeterministicCsvColumnMap(
  headerRow: string[],
): CsvColumnSchema | null {
  if (!headerRow || headerRow.length < 2) {
    return null;
  }

  const normalized = headerRow.map(cell =>
    (cell || '')
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/[\s_-]+/g, ' '),
  );

  const titleAliases = new Set([
    'title',
    'book title',
    'book',
    'work',
    'book name',
  ]);
  const authorAliases = new Set([
    'author',
    'authors',
    'primary author',
    'author l f',
    'creator',
    'writer',
  ]);
  const isbn13Aliases = new Set(['isbn13', 'isbn 13']);
  const isbnAliases = new Set(['isbn', 'isbn10', 'isbn 10', 'barcode', 'ean']);
  const formatAliases = new Set([
    'format',
    'binding',
    'book format',
    'media',
    'edition format',
  ]);

  let titleIdx = -1;
  let authorIdx = -1;
  let isbnIdx: number | null = null;
  let formatIdx: number | null = null;

  normalized.forEach((col, idx) => {
    if (titleIdx === -1 && titleAliases.has(col)) {
      titleIdx = idx;
    } else if (authorIdx === -1 && authorAliases.has(col)) {
      authorIdx = idx;
    } else if (isbn13Aliases.has(col)) {
      isbnIdx = idx;
    } else if (isbnIdx === null && isbnAliases.has(col)) {
      isbnIdx = idx;
    } else if (formatIdx === null && formatAliases.has(col)) {
      formatIdx = idx;
    }
  });

  if (titleIdx !== -1 && authorIdx !== -1 && titleIdx !== authorIdx) {
    return {
      hasHeaderRow: true,
      columnMap: {
        title: titleIdx,
        author: authorIdx,
        isbn: isbnIdx,
        format: formatIdx,
      },
    };
  }

  return null;
}

export async function extractBooksFromCsv(
  csvText: string,
  options?: {allowAiFallback?: boolean},
): Promise<
  Array<{
    title: string;
    author: string;
    isbn?: string;
    format?: 'physical' | 'digital';
  }>
> {
  try {
    const parsed = await new Promise<Papa.ParseResult<unknown>>(
      (resolve, reject) => {
        Papa.parse(csvText, {
          header: false,
          skipEmptyLines: true,
          complete: results => resolve(results),
          error: (error: unknown) =>
            reject(error instanceof Error ? error : new Error(String(error))),
        });
      },
    );

    const rows = parsed.data as string[][];
    if (rows.length === 0) {
      return [];
    }

    // 1. Try zero-token deterministic header mapping first
    let resolvedSchema: CsvColumnSchema | null = tryDeterministicCsvColumnMap(
      rows[0],
    );

    // 2. Fall back to lightweight Gemini 3.1 Flash Lite column inference only when headers are non-standard
    if (!resolvedSchema) {
      if (options?.allowAiFallback === false) {
        return [];
      }

      const sampleRows = rows.slice(0, 5);
      const response = await generateContentWithLimiter({
        model: 'gemini-3.1-flash-lite',
        contents: `Analyze these sample rows from an uploaded book collection CSV file (parsed as an array of rows):

CSV Sample Rows:
${JSON.stringify(sampleRows)}

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
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
        },
      });

      const text = response.text;
      if (!text) {
        return [];
      }

      try {
        const parsedSchema = JSON.parse(text) as {
          hasHeaderRow?: boolean;
          columnMap?: {
            title?: number;
            author?: number;
            isbn?: number | null;
            format?: number | null;
          };
        };
        if (
          parsedSchema.columnMap &&
          typeof parsedSchema.columnMap.title === 'number' &&
          typeof parsedSchema.columnMap.author === 'number'
        ) {
          resolvedSchema = {
            hasHeaderRow: Boolean(parsedSchema.hasHeaderRow),
            columnMap: {
              title: parsedSchema.columnMap.title,
              author: parsedSchema.columnMap.author,
              isbn:
                typeof parsedSchema.columnMap.isbn === 'number'
                  ? parsedSchema.columnMap.isbn
                  : null,
              format:
                typeof parsedSchema.columnMap.format === 'number'
                  ? parsedSchema.columnMap.format
                  : null,
            },
          };
        }
      } catch (e) {
        console.warn('Failed to parse Gemini schema response:', e);
        return [];
      }
    }

    if (!resolvedSchema) {
      return [];
    }

    const {hasHeaderRow, columnMap} = resolvedSchema;
    const books: Array<{
      title: string;
      author: string;
      isbn?: string;
      format?: 'physical' | 'digital';
    }> = [];
    const startIndex = hasHeaderRow ? 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) {
        continue;
      }

      const titleIndex = columnMap.title;
      if (typeof titleIndex !== 'number' || !row[titleIndex]?.trim()) {
        continue;
      }

      let isbn: string | undefined = undefined;
      if (typeof columnMap.isbn === 'number') {
        const rawIsbn = row[columnMap.isbn] || '';
        const cleaned = rawIsbn.replace(/[^0-9X]/gi, '');
        if (cleaned.length >= 10) {
          isbn = cleaned;
        }
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
