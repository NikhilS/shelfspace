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
    const prompt = `I have clustered a library of books into thematic constellations. For each cluster, I will provide a list of books. 
Your task is to provide a short, captivating, and thematic name for each cluster (1 to 3 words max). 

Respond ONLY with a valid JSON object.
Use the exact integer ID as the string key. 
Example Output:
{
  "0": "Sci-Fi Epics",
  "1": "High Fantasy"
}

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
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const text = response.text
      ? response.text
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim()
      : '{}';
    const rawResult = JSON.parse(text);

    const result: Record<number, string> = {};
    for (const key of Object.keys(rawResult)) {
      const numericMatch = key.match(/\d+/);
      if (numericMatch) {
        result[parseInt(numericMatch[0], 10)] = rawResult[key];
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
      items: {
        type: Type.OBJECT,
        properties: {
          title: {type: Type.STRING},
          author: {type: Type.STRING},
          isbn: {
            type: Type.STRING,
            description: 'ISBN if visible, otherwise null',
          },
        },
        required: ['title', 'author'],
      },
    };

    const prompt =
      "Extract a list of all the books visible on this bookshelf. Return ONLY a JSON array of objects. Each object has a 'title' string, an 'author' string, and an 'isbn' string (if visible on the spine or back cover, otherwise null).";

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
      logger.info('Calling Gemini 3.1 Pro for book extraction...');
      response = await Promise.race([
        generateCall('gemini-3.1-pro-preview'),
        timeoutPromise(30000),
      ]);
      logger.info('Gemini 3.1 Pro response received.');
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      const isTimeout = e instanceof Error && e.message === 'API_TIMEOUT';
      logger.warn(
        `Gemini 3.1 Pro ${isTimeout ? 'timed out' : 'failed'}, retrying with flash: ${e instanceof Error ? e.message : String(e)}`,
      );
      try {
        response = await Promise.race([
          generateCall('gemini-3.5-flash'),
          timeoutPromise(20000),
        ]);
        logger.info('Gemini 3.5 Flash response received.');
      } catch (err: unknown) {
        if (isApiKeyError(err)) {
          throw err;
        }
        logger.warn(
          'Gemini 3.5 Flash failed, falling back to Gemini 3.5 Flash backup: ' +
            (err instanceof Error ? err.message : String(err)),
        );
        response = await Promise.race([
          generateCall('gemini-3.5-flash'),
          timeoutPromise(20000),
        ]);
        logger.info('Gemini 3.5 Flash backup response received.');
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

    const sampleRows = rows.slice(0, 3);

    const response = await generateContentWithLimiter({
      model: 'gemini-3.5-flash',
      contents: `You are a data mapping assistant. I am providing you with the first few rows of a CSV file parsed as JSON arrays.
      
      CSV Sample Rows:
      ${JSON.stringify(sampleRows, null, 2)}
      
      Your task is to analyze these rows and determine the structure of the CSV:
      1. Does the first row appear to be a header row?
      2. What are the 0-based column indices for the following book attributes?
         - title (required. name of the book, usually the most prominent text)
         - author (required. author or creator of the book)
         - isbn (optional. prefer ISBN13 if multiple exist)
         - format (optional. binding, format - e.g.. 'physical', 'digital', 'paperback', 'kindle')

      If an optional attribute is not present in any column, set its index to null.
      
      Return ONLY a JSON object exactly matching this schema, without markdown formatting:
      {
        "hasHeaderRow": boolean,
        "columnMap": {
          "title": number | null,
          "author": number | null,
          "isbn": number | null,
          "format": number | null
        }
      }`,
      config: {
        responseMimeType: 'application/json',
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
    const prompt = `Act as an expert librarian. Here is a list of books in my library:
    
${bookList}

Based on this reading history, please recommend 5 new books that I might enjoy. 
For each recommendation, provide the Title, Author, and a brief 2-3 sentence explanation of WHY it is a good fit based on my existing library. 
Format the response with simple markdown (use ## for the book titles).`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
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
      prompt = `Act as an expert librarian and literary critic. Provide a compelling, spoiler-free summary of the book "${title}" by ${author}. 
        Focus on the premise, the main themes, the setting, and the general tone of the book. 
        Why might someone want to read this? Keep it concise (around 2-3 paragraphs) and engaging. Format with simple markdown (use ## for headings if needed).`;
      break;
    case 'author_bio':
      prompt = `Act as an expert librarian. Provide a concise biographical summary of the author ${author}, who wrote "${title}". 
        Focus on their career, notable works, writing style, and any major awards. Keep it to 1-2 paragraphs. Format with simple markdown if needed, but do not use headings.`;
      break;
    case 'catchup':
      prompt = `I am currently reading or have previously read "${title}" by ${author} but I need a refresher. 
        Provide a comprehensive plot summary INCLUDING ALL MAJOR SPOILERS, twists, and the ending. 
        Break it down by major plot points or acts. This is for someone who wants to know exactly what happens without reading it, or needs to remember the details before reading a sequel. Format with simple markdown (use ## for headings, bullet points for key events).`;
      break;
    case 'similar':
      prompt = `I enjoyed reading "${title}" by ${author}. As an expert librarian, recommend 3-5 other books that I might like. 
        For each recommendation, provide the Title, Author, and a brief 1-2 sentence explanation of WHY it is similar to "${title}" (e.g., similar themes, writing style, setting, or character dynamics). Format with simple markdown (use ## for the book titles).`;
      break;
  }

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await generateContentWithLimiter({
        model:
          type === 'catchup'
            ? 'gemini-3.5-flash'
            : retries > 1
              ? 'gemini-3.1-pro-preview'
              : 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction: 'You are an expert librarian.',
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
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Beautiful and stunning watercolor anime-style library-themed hero banner for a book collection named '${libraryName}'. Cozy Ghibli-inspired aesthetic, warm glowing sunbeams filtering through giant wooden windows, towering bookshelves filled with colorful adventure and fantasy books, soft whimsical light dust motes, magical and comforting atmosphere, masterpiece scene art style, strictly no text or characters of alphabet on the image.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '16:9',
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
    const prompt = `Act as an expert librarian. Here is a sample of books from my library:

${bookList}

Based on the themes, genres, and styles of these books, please recommend 10 non-obvious, deeply engaging new books that I would enjoy reading. 
Think like an expert librarian who suggests gems that are highly relevant but not necessarily mainstream or obvious.

CRITICAL RULES:
1. The books you recommend MUST NOT be in the list above.
2. Provide exactly 10 distinct recommendations.

Explain in 1-2 sentences WHY each specific book is a great recommendation based on my current library and interests, highlighting the unexpected or complementary connections.

Return ONLY a JSON array of 10 objects. Do not include markdown formatting like \`\`\`json. Each object in the array MUST have:
- title (the book title)
- author (the book author)
- reason (your 1-2 sentence explanation)`;

    let response;
    try {
      response = await generateContentWithLimiter({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      console.warn('Fallback to pro model due to error in pick of the day:', e);
      try {
        response = await generateContentWithLimiter({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });
      } catch (err: unknown) {
        if (isApiKeyError(err)) {
          throw err;
        }
        console.warn('Fallback to 3.5 flash model:', err);
        response = await generateContentWithLimiter({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
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

    const prompt = `You are an expert librarian specializing in book classification.
Classify the following batch of ${batch.length} books into the most appropriate BISAC Subject Headings.
Use only established BISAC categories (e.g., FICTION / Mystery & Detective / General, BIOGRAPHY & AUTOBIOGRAPHY / Historical).

Rules:
1. Provide 1 to 3 relevant BISAC categories per book.
2. Ensure categories are formatted correctly according to standard BISAC naming (Levels separated by ' / ').
3. Respond ONLY with a valid JSON array of objects.

Format:
[
  {
    "id": "original_id",
    "genres": ["BISAC Category 1", "BISAC Category 2"]
  }
]

Books to classify:
${JSON.stringify(booksPromptData, null, 2)}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
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

export async function extractBookGeoMetadata(
  title: string,
  author: string,
  synopsis?: string,
): Promise<ExtractedGeoResponse | null> {
  try {
    const schema = {
      type: Type.OBJECT,
      properties: {
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
      required: ['isNonEarth', 'locations'],
    };

    const prompt = `You are a peerless, academic literary geographer with deep encyclopedic knowledge of world literature, non-fiction contexts, and global histories.
Your task is to analyze details of the provided book (Title, Author, Synopsis) and determine exactly where the setting takes place on planet Earth.

System Directives:
1. Identify the primary locations (cities, regions, countries) where the actions, histories, or settings of the book take place.
2. STRICTLY CAP extraction to NO MORE than 5 locations. Select only the most critical settings.
3. Every location NAME must be globally unambiguous (e.g., 'Paris, France' instead of 'Paris', 'Springfield, IL, USA' instead of 'Springfield').
4. If the book is set in a fictional realm (Middle-earth, Westeros, Narnia), outer space / sci-fi galaxies (e.g. 'Project Hail Mary'), or is an abstract academic, scientific or mathematical textbook, set 'isNonEarth' to true and return an empty locations list.

Book Details:
Title: ${title}
Author: ${author}
Synopsis: ${synopsis || 'No synopsis provided.'}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (!text) return null;

    try {
      return JSON.parse(text) as ExtractedGeoResponse;
    } catch {
      const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(cleaned) as ExtractedGeoResponse;
    }
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Book geo extraction is pending valid GEMINI_API_KEY configuration.',
      );
      return null;
    }
    handleGeminiError(err);
  }
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
      model: 'gemini-3.5-flash',
      contents: fullPrompt,
      config: {
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

  const prompt = `You are a peerless, academic literary geographer with deep encyclopedic knowledge of world literature, non-fiction contexts, and global histories.
Your task is to analyze details of the provided list of books and determine exactly where the setting takes place on planet Earth for each book.

System Directives:
1. For each book, identify the primary locations (cities, regions, countries) where the actions, histories, or settings of the book take place.
2. STRICTLY CAP extraction to NO MORE than 5 locations per book. Select only the most critical settings.
3. Every location NAME must be globally unambiguous (e.g., 'Paris, France' instead of 'Paris', 'Springfield, IL, USA' instead of 'Springfield').
4. If a book is set in a fictional realm (Middle-earth, Westeros, Narnia), outer space / sci-fi galaxies (e.g. 'Project Hail Mary'), or is an abstract academic, scientific or mathematical textbook, set 'isNonEarth' to true and return an empty locations list for that book.
5. Map each parsed book specifically to the provided unique id in the output JSON.`;

  return batchGeminiOperation<BatchExtractedGeoResponse>(
    books,
    prompt,
    batchSchema,
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

  const prompt = `You are an academic bibliophile historian with encyclopedic knowledge of literature, historical timelines, and world histories.
Your task is to analyze the provided list of books and determine the exact historical setting/era representing the plot or context of each book on earth.

System Directives:
1. For each book, identify if it possesses a real-world Earth historical setting.
2. If a book is abstract academic, mathematics, modern theory, sci-fi (set in future epochs or space), or high fantasy (set in Middle-earth, Westeros, Narnia, or custom-lore realms), set isNonHistorical to true.
3. For historical/historical-context books, determine the approximate startYear and endYear representing the core plot setting.
4. Rule 1 (100-Year Spanning Cap): If a book covers a broad span (e.g., a massive biography/history), isolate the single most definitive or dramatic 100-year window (e.g., Pax Romana, Viking expansion) and cap the gap (endYear - startYear) to be NO MORE than 100 years.
5. Rule 2 (Chronological Grounding): Years must represent real-world calendar parameters. BC/BCE is expressed as a negative integer.
6. Rule 3 (Year Range Constraints): Years MUST be between -10000 and 2100. Any book set primarily outside this epoch must be marked as isNonHistorical: true.
7. Rule 4 (Fictional/Abstract Exclusion): Science fiction, high fantasy, and abstract textbooks with no real setting must be marked isNonHistorical: true with other fields omitted.
8. Map each parsed book precisely to the provided unique id in the output JSON.`;

  const result = await batchGeminiOperation<BatchTemporalResponse>(
    books,
    prompt,
    batchSchema,
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
