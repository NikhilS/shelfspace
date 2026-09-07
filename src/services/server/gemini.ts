import {GoogleGenAI, Type} from '@google/genai';
import Papa from 'papaparse';
import {toSentenceCase} from '../../lib/utils';
import {geminiLimiter} from './limiters';

const logger = {
  info: (msg: string) => {
    console.info(msg);
  },
  warn: (msg: string) => {
    console.warn(msg);
  },
  error: (msg: string) => {
    console.error(msg);
  },
};

export function isApiKeyError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('GEMINI_API_KEY') ||
    msg.includes('key not valid') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('INVALID_ARGUMENT') ||
    msg.includes('API key')
  );
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'AI features require a valid GEMINI_API_KEY. Please set this in the Settings > Secrets menu.',
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Centrally rate-limited wrapper for generateContent.
 * All backend code calling Gemini models should use this to ensure we don't
 * breach global AI quotas.
 */
export async function generateContentWithLimiter(
  options: Parameters<GoogleGenAI['models']['generateContent']>[0],
) {
  const ai = getGeminiClient();
  return geminiLimiter.schedule(() => ai.models.generateContent(options));
}

export function handleGeminiError(error: unknown): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (isApiKeyError(error)) {
    console.info('Gemini API key is invalid or not set.');
    throw error;
  }
  console.error('Error calling Gemini:', error);
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as {status?: number}).status
      : undefined;
  if (
    status === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('RESOURCE_EXHAUSTED') ||
    errorMessage.includes('quota')
  ) {
    throw new Error(
      'The AI service has exceeded its quota limit. Please try again later.',
    );
  }
  throw new Error(
    'Failed to communicate with the AI service. Please try again.',
  );
}

export async function generateClusterNames(
  clusters: {id: number; books: {title: string; author?: string}[]}[],
): Promise<Record<number, string>> {
  try {
    const prompt = `I have clustered a reader's library into thematic constellations based on semantic embeddings.
For each cluster below, analyze the titles and authors to identify the shared literary genre, aesthetic, or philosophical theme.
Provide a captivating, evocative, and concise name for each cluster (1 to 3 words max).
Avoid generic names like "Books" or "Novels". Favor distinctive descriptors (e.g., "Cosmic Dread", "Golden Age Sleuths", "Magical Realism", "Stoic Philosophy", "Cyberpunk Dystopia").

Clusters:
${clusters
  .map(
    c =>
      `ID ${c.id}:\n${c.books
        .slice(0, 15)
        .map(
          b =>
            `- ${b.title || 'Unknown Title'} ${b.author ? `by ${b.author}` : ''}`,
        )
        .join('\n')}`,
  )
  .join('\n\n')}
`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an expert literary curator and bibliographer specializing in thematic classification and curated reading collections.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'List of named clusters',
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.INTEGER,
                description: 'The exact cluster ID provided in the input',
              },
              name: {
                type: Type.STRING,
                description: 'Concise thematic name (1 to 3 words max)',
              },
            },
            required: ['id', 'name'],
          },
        },
        temperature: 0.4,
      },
    });

    const text = response.text
      ? response.text
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim()
      : '[]';
    const parsed = JSON.parse(text);

    const result: Record<number, string> = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item.id === 'number' && typeof item.name === 'string') {
          result[item.id] = item.name.trim();
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        const numericMatch = key.match(/\d+/);
        if (numericMatch) {
          result[parseInt(numericMatch[0], 10)] = String(parsed[key]).trim();
        }
      }
    }

    return result;
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Cluster name generation is pending valid GEMINI_API_KEY configuration.',
      );
    } else {
      console.error('Failed to generate cluster names:', err);
    }
    return {};
  }
}

export async function generateBookEmbeddings(
  texts: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<number[][]> {
  try {
    if (!texts || texts.length === 0) return [];
    const embeddings: number[][] = new Array(texts.length).fill([]);

    const BATCH_SIZE = 10;
    let completedCount = 0;
    const ai = getGeminiClient();
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + BATCH_SIZE);
      const batchPromises = batchTexts.map(async (text, index) => {
        let embedResponse;
        try {
          embedResponse = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: text,
          });
        } catch (err: unknown) {
          console.warn('Failed to embed text: ', err);
        }

        if (
          embedResponse &&
          embedResponse.embeddings &&
          embedResponse.embeddings.length > 0
        ) {
          embeddings[i + index] = embedResponse.embeddings[0].values || [];
        }
      });

      await Promise.all(batchPromises);
      completedCount += batchTexts.length;
      if (onProgress) {
        onProgress(completedCount, texts.length);
      }
    }

    return embeddings;
  } catch (error) {
    handleGeminiError(error);
  }
}

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

    let schema;
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
        isbn: isbn,
        format: format,
      });
    }

    return books;
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function generateLibraryRecommendations(
  libraryBooks: {title: string; author: string}[],
): Promise<string> {
  try {
    const limitedBooks = libraryBooks.slice(0, 100);
    const bookList = limitedBooks
      .map(b => `"${b.title}" by ${b.author}`)
      .join('\n');
    const prompt = `Here is a catalog of books from a reader's personal library:

${bookList}

Based on this reader's interests, recurring genres, narrative styles, pacing, and philosophical themes, recommend 5 captivating new books to expand their horizons.

CRITICAL DIRECTIVES:
1. STRICTLY DO NOT recommend any book that is already listed in the reader's library above.
2. Recommend exceptional, distinctive titles (a thoughtful blend of acclaimed literary works, modern masterworks, and hidden gems).
3. For each book, use this clear markdown format:
   ## [Book Title] by [Author]
   **Why It Fits Your Library**: 2-3 sentences explaining the exact thematic, stylistic, or intellectual resonance with specific books in their collection.
   **Key Themes**: 3-4 comma-separated tags (e.g., *Speculative Fiction, Found Family, Moral Ambiguity*).`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an erudite, insightful literary curator and librarian who recommends books with nuance, depth, and precision.',
        temperature: 0.6,
      },
    });

    return (
      response.text ||
      "I'm sorry, I couldn't generate recommendations at the moment."
    );
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function generateBookInsights(
  title: string,
  author: string,
  type: 'summary' | 'catchup' | 'similar' | 'author_bio' | 'synopsis',
  signal?: AbortSignal,
): Promise<string> {
  let prompt = '';
  switch (type) {
    case 'summary':
    case 'synopsis':
      prompt = `Provide a compelling, spoiler-free literary summary of "${title}" by ${author}.
Focus on the core premise, central conflict, primary themes, setting, and narrative tone.
Conclude with what kind of reader would find this work most rewarding. Keep it to 2-3 engaging, well-crafted paragraphs. Format with clean markdown (use ## for subheadings if appropriate).`;
      break;
    case 'author_bio':
      prompt = `Provide an authoritative biographical profile of ${author}, focusing on their literary career, artistic philosophy, major themes across their bibliography, and critical recognition or awards.
Highlight the context surrounding "${title}". Keep it to 1-2 focused, elegant paragraphs without introductory or conversational filler.`;
      break;
    case 'catchup':
      prompt = `Provide a comprehensive, spoiler-inclusive narrative refresher of "${title}" by ${author} for a reader preparing for a sequel or reread.
Structure chronologically into:
- **Setup & Inciting Incident**
- **Key Plot Developments & Character Arcs**
- **Major Plot Twists & Revelations**
- **Climax & Ending Resolution**
Detail all major twists, deaths, alliances, and the exact ending. Use concise markdown with bullet points for readability.`;
      break;
    case 'similar':
      prompt = `Recommend 3 to 5 books with strong thematic, stylistic, or emotional kinship to "${title}" by ${author}.
For each recommendation, format with:
## [Book Title] by [Author]
**Why It Resonates**: 2-3 sentences detailing the specific points of connection (e.g., world-building, psychological depth, narrative voice, or moral dilemmas).`;
      break;
  }

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await generateContentWithLimiter({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction:
            'You are an insightful literary scholar, critic, and expert librarian who provides rich, accurate, and compelling book analyses.',
          temperature: type === 'catchup' ? 0.3 : 0.5,
        },
      });

      return (
        response.text ||
        "I'm sorry, I couldn't generate insights for this book at the moment."
      );
    } catch (error: unknown) {
      if (signal?.aborted) throw new Error('Aborted');
      const errObj = error as Record<string, unknown>;
      const is500 =
        errObj?.status === 500 ||
        String(error).includes('500') ||
        (errObj?.message && String(errObj.message).includes('500'));
      if (is500 && retries > 1) {
        retries--;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      handleGeminiError(error);
    }
  }
  return "I'm sorry, I couldn't generate insights for this book at the moment.";
}

export async function generateLibraryHeroImage(
  libraryName: string,
): Promise<string | null> {
  try {
    const response = await generateContentWithLimiter({
      model: 'gemini-3.1-flash-image',
      contents: {
        parts: [
          {
            text: `Breathtaking cozy watercolor and gouache storybook illustration of an enchanting personal library sanctuary named '${libraryName}'. Sunlit reading nook with arched wooden mullioned windows, warm golden sunbeams streaming across towering shelves overflowing with beautifully bound books, potted houseplants, a comfortable leather armchair, soft atmospheric lighting and floating dust motes. Peaceful Studio Ghibli inspired aesthetic. Masterpiece digital art, vibrant warm palette. Strictly no text, no letters, no words, no alphabet characters anywhere in the artwork.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '1K',
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    if (isApiKeyError(error)) {
      console.info(
        'Library hero image generation is pending valid GEMINI_API_KEY configuration.',
      );
      throw error;
    } else {
      console.error('Error generating library hero image:', error);
      return null;
    }
  }
}

export async function getPickOfTheDay(
  books: {title: string; author: string}[],
): Promise<{title: string; author: string; reason: string}[] | null> {
  try {
    if (!books || books.length === 0) return null;
    const shuffled = [...books];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sampleBooks = shuffled.slice(0, 100);
    const bookList = sampleBooks
      .map(
        (b, i) =>
          `${i + 1}. "${b.title || 'Unknown Title'}" by ${b.author || 'Unknown Author'}`,
      )
      .join('\n');
    const prompt = `Here is a sample of books from a reader's personal library:

${bookList}

Based on the underlying themes, literary voices, and conceptual styles across these titles, recommend 10 non-obvious, deeply rewarding books that this reader would love.
Think like an expert library curator discovering unexpected gems and profound thematic bridges.

CRITICAL RULES:
1. The recommended books MUST NOT be in the reader's current list above.
2. Provide exactly 10 distinct recommendations.
3. For each book, explain in 1-2 insightful sentences WHY it is a superb recommendation, highlighting the surprising or complementary connection to their taste.`;

    const pickOfTheDaySchema = {
      type: Type.ARRAY,
      description: 'List of 10 curated book recommendations',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {type: Type.STRING, description: 'Book title'},
          author: {type: Type.STRING, description: 'Book author'},
          reason: {
            type: Type.STRING,
            description: '1-2 sentence curated rationale',
          },
        },
        required: ['title', 'author', 'reason'],
      },
    };

    let response;
    try {
      response = await generateContentWithLimiter({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a distinguished literary curator and reader advisory expert who recommends surprising, high-resonance literature.',
          responseMimeType: 'application/json',
          responseSchema: pickOfTheDaySchema,
          temperature: 0.7,
        },
      });
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      console.warn('Fallback to Gemini 3.1 Pro for pick of the day:', e);
      try {
        response = await generateContentWithLimiter({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            systemInstruction:
              'You are a distinguished literary curator and reader advisory expert who recommends surprising, high-resonance literature.',
            responseMimeType: 'application/json',
            responseSchema: pickOfTheDaySchema,
            temperature: 0.7,
          },
        });
      } catch (err: unknown) {
        if (isApiKeyError(err)) {
          throw err;
        }
        console.warn('Fallback retry with Gemini 3.8 Flash model:', err);
        response = await generateContentWithLimiter({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: pickOfTheDaySchema,
          },
        });
      }
    }

    let text = response.text;
    if (!text) return null;
    try {
      text = text
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter(p => p.title && p.author && p.reason) as {
          title: string;
          author: string;
          reason: string;
        }[];
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.title &&
        parsed.author &&
        parsed.reason
      ) {
        return [parsed] as {title: string; author: string; reason: string}[];
      }
      return null;
    } catch {
      return null;
    }
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Pick of the day is pending valid GEMINI_API_KEY configuration.',
      );
    } else {
      console.error('Pick of the day error:', err);
    }
    return null;
  }
}

export async function classifyBooks(
  batch: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<{id: string; genres: string[]}[]> {
  try {
    if (!batch || batch.length === 0) return [];
    const booksPromptData = batch.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      context: b.synopsis ? b.synopsis.substring(0, 300) : '',
    }));

    const prompt = `Classify the following batch of ${batch.length} books into the most appropriate official BISAC (Book Industry Standards and Communications) Subject Headings.
Use only established, standard BISAC categories (e.g., "FICTION / Mystery & Detective / General", "BIOGRAPHY & AUTOBIOGRAPHY / Historical", "SCIENCE FICTION / Hard Science Fiction").

Directives:
1. Provide 1 to 3 relevant BISAC categories for each book.
2. Format hierarchical levels cleanly separated by ' / '.
3. Preserve the exact provided unique book "id" for each classification.

Books to classify:
${JSON.stringify(booksPromptData, null, 2)}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an expert library cataloger and bibliographer specializing in official BISAC Subject Headings.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'Classified books with BISAC genres',
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.STRING,
                description: 'The exact input ID of the book',
              },
              genres: {
                type: Type.ARRAY,
                items: {type: Type.STRING},
                description: '1 to 3 official BISAC categories',
              },
            },
            required: ['id', 'genres'],
          },
        },
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((item: {id: string; genres?: string[]}) => ({
          id: item.id,
          genres: Array.isArray(item.genres)
            ? item.genres.map((g: string) => toSentenceCase(g))
            : [],
        })) as {id: string; genres: string[]}[];
      }
      return [];
    } catch (e) {
      if (isApiKeyError(e)) {
        console.info(
          'Book classification parse check completed (key pending).',
        );
      } else {
        console.error('Failed to parse Gemini classification response:', e);
      }
      return [];
    }
  } catch (error) {
    if (isApiKeyError(error)) {
      console.info(
        'Book classification is pending valid GEMINI_API_KEY configuration.',
      );
      throw error;
    }
    handleGeminiError(error);
  }
}

export interface ExtractedGeoLocation {
  name: string;
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;
}

export interface ExtractedGeoResponse {
  isNonEarth: boolean;
  locations: ExtractedGeoLocation[];
}

export interface BatchExtractedGeoBookResult {
  id: string;
  isNonEarth: boolean;
  locations: ExtractedGeoLocation[];
}

export interface BatchExtractedGeoResponse {
  enrichment: BatchExtractedGeoBookResult[];
}

export async function batchGeminiOperation<T>(
  books: {id: string; title: string; author: string; synopsis?: string}[],
  prompt: string,
  schema: unknown,
  systemInstruction?: string,
): Promise<T | null> {
  try {
    const fullPrompt = `${prompt}\n\nBooks to analyze:\n${JSON.stringify(
      books.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        synopsis: b.synopsis || '',
      })),
      null,
      2,
    )}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: fullPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (!text) return null;

    try {
      return JSON.parse(text) as T;
    } catch {
      const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(cleaned) as T;
    }
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Batch extraction is pending valid GEMINI_API_KEY configuration.',
      );
      return null;
    }
    handleGeminiError(err);
  }
}

export async function extractBookGeoMetadataBatch(
  books: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<BatchExtractedGeoResponse | null> {
  const batchSchema = {
    type: Type.OBJECT,
    properties: {
      enrichment: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.STRING,
              description: 'The exact ID of the book provided in the input.',
            },
            isNonEarth: {
              type: Type.BOOLEAN,
              description:
                'Set to true ONLY if the entire work is sci-fi set in space/fictional planets, high fantasy set in completely fictional realms, or is a textbook, academic guide, or abstract literature with no logical earthly setting.',
            },
            locations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description:
                      "Fully-qualified geographical name. Must include specific city, province/state, and country name combined to guarantee precise geocoding (e.g., 'Kyoto, Japan' instead of 'Kyoto', 'Delhi, India' instead of 'Delhi', 'Gettysburg, PA, USA' instead of 'Gettysburg').",
                  },
                  adminLevel: {
                    type: Type.STRING,
                    enum: ['city', 'state', 'country', 'region'],
                    description: 'Granularity type of setting.',
                  },
                  rationale: {
                    type: Type.STRING,
                    description:
                      'A short context sentence (15 words max) describing why this spatial setting is vital to the story.',
                  },
                },
                required: ['name', 'adminLevel', 'rationale'],
              },
              description:
                'At most 5 key geographical regions, cities, states, or countries central to the narrative, plot, setting, or historical backdrop. Return empty list if isNonEarth is true.',
            },
          },
          required: ['id', 'isNonEarth', 'locations'],
        },
        description:
          'A list of geocoded settings for each of the books provided.',
      },
    },
    required: ['enrichment'],
  };

  const prompt = `Analyze details of the provided list of books and determine the exact real-world geographical settings on Earth for each book.

Directives:
1. For each book, identify up to 5 critical locations (cities, states/provinces, regions, or countries) where the primary narrative or historical actions occur.
2. Every location "name" must be fully-qualified and globally unambiguous (e.g., "Kyoto, Japan", "Oxford, Oxfordshire, United Kingdom", "Concord, MA, USA").
3. Set "adminLevel" to "city", "state", "country", or "region".
4. For each location, provide a concise rationale (15 words max) explaining its narrative or historical significance.
5. If a book is set entirely in a fictional realm (e.g., Middle-earth, Westeros, Narnia), outer space / sci-fi alien worlds, or is an abstract academic/mathematical work without an earthly setting, set "isNonEarth" to true and return an empty locations array.
6. Map each parsed book specifically to the exact "id" provided in the input.`;

  return batchGeminiOperation<BatchExtractedGeoResponse>(
    books,
    prompt,
    batchSchema,
    'You are an authoritative literary geographer with deep knowledge of world literature, non-fiction contexts, and global historical geography.',
  );
}

export interface TemporalBookResult {
  id: string;
  isNonHistorical: boolean;
  startYear?: number;
  endYear?: number;
  eraName?: string;
  rationale?: string;
}

export interface BatchTemporalResponse {
  enrichment: TemporalBookResult[];
}

export async function extractBookTemporalMetadataBatch(
  books: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<BatchTemporalResponse | null> {
  const batchSchema = {
    type: Type.OBJECT,
    properties: {
      enrichment: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.STRING,
              description: 'The exact ID of the book provided in the input.',
            },
            isNonHistorical: {
              type: Type.BOOLEAN,
              description:
                'Set to true if the book is sci-fi/fantasy with entirely fictional settings, abstract technical/mathematical manuals, modern theoretical guidelines with no real-world earth timeline.',
            },
            startYear: {
              type: Type.INTEGER,
              description:
                'Approximate start year of the events or plot. Use negative values for BC/BCE (e.g. -44). Leave blank or omit if isNonHistorical is true.',
            },
            endYear: {
              type: Type.INTEGER,
              description:
                'Approximate end year of the events. Gap between start and end year must not exceed 100 years. Leave blank or omit if isNonHistorical is true.',
            },
            eraName: {
              type: Type.STRING,
              description:
                'Cohesive name label for this historical era (e.g., "Middle Ages", "Renaissance", "World War II", "Victorian Era", "Late Roman Republic"). 2-5 words max. Leave blank or omit if isNonHistorical is true.',
            },
            rationale: {
              type: Type.STRING,
              description:
                'Max 15 words explaining why this temporal context is critical to the story. Leave blank or omit if isNonHistorical is true.',
            },
          },
          required: ['id', 'isNonHistorical'],
        },
        description:
          'A list of temporal metadata for each of the books provided.',
      },
    },
    required: ['enrichment'],
  };

  const prompt = `Analyze the provided list of books and determine the chronological historical setting and era for each book on Earth.

Directives:
1. Identify if the book possesses a real-world Earth timeline or historical backdrop.
2. If the book is set in an entirely fictional realm (fantasy), far-future or deep-space setting (sci-fi), or is an abstract technical manual with no real-world time setting, mark "isNonHistorical: true" and omit startYear, endYear, eraName, and rationale.
3. For books with real Earth timelines:
   - "startYear": Integer representing the approximate starting year of the core events (use negative values for BCE/BC, e.g. -44).
   - "endYear": Integer representing the approximate ending year. The span between startYear and endYear must NOT exceed 100 years. For sweeping histories, isolate the definitive period.
   - "eraName": Concise historical era name (e.g., "Late Antiquity", "Italian Renaissance", "Victorian Era", "Cold War Era", "Jazz Age").
   - "rationale": Concise explanation (15 words max) of the temporal context.
4. Years MUST be between -10000 and 2100.
5. Map each book specifically to its unique input "id".`;

  const result = await batchGeminiOperation<BatchTemporalResponse>(
    books,
    prompt,
    batchSchema,
    'You are an academic bibliophile historian with encyclopedic knowledge of world history, literary chronology, and historical eras.',
  );

  if (result?.enrichment) {
    result.enrichment.forEach(item => {
      if (
        !item.isNonHistorical &&
        item.startYear !== undefined &&
        item.endYear === undefined
      ) {
        item.endYear = item.startYear;
      }
    });
  }

  return result;
}
