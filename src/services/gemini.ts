import {GoogleGenAI} from '@google/genai';
import Papa from 'papaparse';

export async function generateClusterNames(
  clusters: {id: number; books: {title: string; author?: string}[]}[],
): Promise<Record<number, string>> {
  try {
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

    // Group books to avoid massive prompts just in case
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
        .map(b => `- ${b.title} ${b.author ? `by ${b.author}` : ''}`)
        .join('\n')}`,
  )
  .join('\n\n')}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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

    // Clean up keys in case model returns "Cluster 0" instead of "0"
    const result: Record<number, string> = {};
    for (const key of Object.keys(rawResult)) {
      const numericMatch = key.match(/\d+/);
      if (numericMatch) {
        result[parseInt(numericMatch[0], 10)] = rawResult[key];
      }
    }

    return result;
  } catch (err) {
    console.error('Failed to generate cluster names:', err);
    return {};
  }
}

export function handleGeminiError(error: unknown): never {
  console.error('Error calling Gemini:', error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
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

export async function generateBookEmbeddings(
  texts: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<number[][]> {
  try {
    if (!texts || texts.length === 0) return [];
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

    const embeddings: number[][] = new Array(texts.length).fill([]);

    const BATCH_SIZE = 10;
    let completedCount = 0;
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
          // Not throwing, just letting the empty embedding be handled
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
    if (!base64Image || base64Image === 'data:,') {
      throw new Error('Invalid image data provided.');
    }
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

    // First attempt with pro
    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image.split(',')[1] || base64Image,
              },
            },
            {
              text: "Extract a list of all the books visible on this bookshelf. Return ONLY a JSON array of objects, where each object has a 'title' string, an 'author' string, and an 'isbn' string (if visible on the spine or back cover, otherwise null). Do not include markdown formatting like ```json. Just the raw JSON array.",
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
        },
      });
    } catch (e: unknown) {
      console.warn(
        'Retrying with flash model due to internal server error:',
        e,
      );
      response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image.split(',')[1] || base64Image,
              },
            },
            {
              text: "Extract a list of all the books visible on this bookshelf. Return ONLY a JSON array of objects, where each object has a 'title' string, an 'author' string, and an 'isbn' string (if visible on the spine or back cover, otherwise null). Do not include markdown formatting like ```json. Just the raw JSON array.",
            },
          ],
        },
      });
    }

    let text = response.text;
    if (!text) return [];

    text = text
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch (e: unknown) {
      console.error('Failed to parse Gemini response:', e);
      return [];
    }
  } catch (error) {
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
    // 1. Parse CSV locally using PapaParse
    const parsed = Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
    });

    const rows = parsed.data as string[][];
    if (rows.length === 0) return [];

    // Extract first 3 rows to give structural context
    const sampleRows = rows.slice(0, 3);

    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: `You are a data mapping assistant. I am providing you with the first few rows of a CSV file parsed as JSON arrays.
      
      CSV Sample Rows:
      ${JSON.stringify(sampleRows, null, 2)}
      
      Your task is to analyze these rows and determine the structure of the CSV:
      1. Does the first row appear to be a header row?
      2. What are the 0-based column indices for the following book attributes?
         - title (required. name of the book, usually the most prominent text)
         - author (required. author or creator of the book)
         - isbn (optional. prefer ISBN13 if multiple exist)
         - format (optional. binding, format - e.g., 'physical', 'digital', 'paperback', 'kindle')

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
      console.error('Failed to parse Gemini schema response:', e);
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

export async function enrichBooksMetadata(
  books: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<{id: string; series: string}[]> {
  try {
    if (!books || books.length === 0) return [];
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

    const prompt = `Act as an expert librarian. I have a list of books. For each book, please determine:
    1. The book series it belongs to. If it is a standalone book, return 'Standalone'.

    Here are the books:
    ${JSON.stringify(books.map(b => ({id: b.id, title: b.title, author: b.author})))}

    Return ONLY a JSON array of objects. Do not include markdown formatting like \`\`\`json. Each object MUST have:
    - id (exactly matching the provided id)
    - series (the series name, or 'Standalone')
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
        return parsed;
      }
      return [];
    } catch (e) {
      console.error('Failed to parse Gemini response:', e);
      return [];
    }
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function generateLibraryRecommendations(
  libraryBooks: {title: string; author: string}[],
): Promise<string> {
  try {
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    // Limit to 100 books to provide more context for recommendations
    const limitedBooks = libraryBooks.slice(0, 100);
    const bookList = limitedBooks
      .map(b => `"${b.title}" by ${b.author}`)
      .join('\n');
    const prompt = `Act as an expert librarian. Here is a list of books in my library:
    
${bookList}

Based on this reading history, please recommend 5 new books that I might enjoy. 
For each recommendation, provide the Title, Author, and a brief 2-3 sentence explanation of WHY it is a good fit based on my existing library. 
Format the response with simple markdown (use ## for the book titles).`;

    const response = await ai.models.generateContent({
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
  try {
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

    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    const response = await ai.models.generateContent(
      {
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          systemInstruction: 'You are an expert librarian.',
        },
      },
      {signal},
    );

    return (
      response.text ||
      "I'm sorry, I couldn't generate insights for this book at the moment."
    );
  } catch (error) {
    if (signal?.aborted) throw new Error('Aborted');
    handleGeminiError(error);
  }
}

export async function generateLibraryHeroImage(
  libraryName: string,
): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `A beautiful, atmospheric, and cozy library themed hero image for a book collection named '${libraryName}'. High quality, digital art, warm lighting, inviting, no text in the image.`,
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
        const base64 = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        return await compressImage(base64);
      }
    }
    return null;
  } catch (error) {
    console.error('Error generating library hero image:', error);
    return null;
  }
}

export async function getPickOfTheDay(
  books: {title: string; author: string}[],
): Promise<{title: string; author: string; reason: string} | null> {
  try {
    if (!books || books.length === 0) return null;
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    // Randomize the books we send to the AI to get varied recommendations, max 50 books
    const sampleBooks = [...books].sort(() => 0.5 - Math.random()).slice(0, 50);
    const bookList = sampleBooks
      .map((b, i) => `${i + 1}. "${b.title}" by ${b.author}`)
      .join('\n');
    const prompt = `Act as an expert librarian. Here is a sample of books from my library:

${bookList}

Based on the themes and genres of these books, please recommend exactly ONE new book that I would enjoy reading. 
CRITICAL RULE: The book you recommend MUST NOT be in the list above.

Explain in exactly 1-2 sentences WHY this specific book is a great recommendation based on my current library.

Return ONLY a JSON object. Do not include markdown formatting like \`\`\`json. The object MUST have:
- title (the book title)
- author (the book author)
- reason (your 1-2 sentence explanation)`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
    } catch (e: unknown) {
      console.warn('Fallback to pro model due to error in pick of the day:', e);
      response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
    }

    let text = response.text;
    if (!text) return null;
    try {
      text = text
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      const parsed = JSON.parse(text);
      if (parsed.title && parsed.author && parsed.reason) {
        return parsed as {title: string; author: string; reason: string};
      }
      return null;
    } catch {
      return null;
    }
  } catch (err) {
    console.error('Pick of the day error:', err);
    return null;
  }
}

async function compressImage(dataUrl: string): Promise<string> {
  if (typeof window === 'undefined') return dataUrl; // Skip compression on server for now
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Scale down to max 800px width to save space
      const maxWidth = 800;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Compress as JPEG with 0.6 quality (should easily fit in 1MB)
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
