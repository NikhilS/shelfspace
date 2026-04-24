import { GoogleGenAI } from "@google/genai";
import Papa from 'papaparse';

export function handleGeminiError(error: unknown): never {
  console.error("Error calling Gemini:", error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  if (status === 429 || errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota')) {
    throw new Error("The AI service has exceeded its quota limit. Please try again later.");
  }
  throw new Error("Failed to communicate with the AI service. Please try again.");
}

export async function extractBooksFromImage(base64Image: string, mimeType: string): Promise<{ title: string, author: string, isbn?: string, genre?: string }[]> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Image.split(',')[1] || base64Image,
            },
          },
          {
            text: "Extract a list of all the books visible on this bookshelf. Return ONLY a JSON array of objects, where each object has a 'title' string, an 'author' string, an 'isbn' string (if visible on the spine or back cover, otherwise null), and a 'genre' string (infer from title/author if possible, e.g. 'Science Fiction', 'Fantasy', 'Non-fiction', etc.). Do not include markdown formatting like ```json. Just the raw JSON array.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
      }
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
      console.error("Failed to parse Gemini response:", e);
      return [];
    }
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function extractBooksFromCsv(csvText: string): Promise<{ title: string, author: string, isbn?: string, genre?: string, format?: 'physical' | 'digital' }[]> {
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
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `You are a data mapping assistant. I am providing you with the first few rows of a CSV file parsed as JSON arrays.
      
      CSV Sample Rows:
      ${JSON.stringify(sampleRows, null, 2)}
      
      Your task is to analyze these rows and determine the structure of the CSV:
      1. Does the first row appear to be a header row?
      2. What are the 0-based column indices for the following book attributes?
         - title (required. name of the book, usually the most prominent text)
         - author (required. author or creator of the book)
         - isbn (optional. prefer ISBN13 if multiple exist)
         - genre (optional. categories, bookshelves, tags)
         - format (optional. binding, format - e.g., 'physical', 'digital', 'paperback', 'kindle')

      If an optional attribute is not present in any column, set its index to null.
      
      Return ONLY a JSON object exactly matching this schema, without markdown formatting:
      {
        "hasHeaderRow": boolean,
        "columnMap": {
          "title": number | null,
          "author": number | null,
          "isbn": number | null,
          "genre": number | null,
          "format": number | null
        }
      }`,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return [];
    
    let schema;
    try {
      schema = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse Gemini schema response:", e);
      return [];
    }

    const { hasHeaderRow, columnMap } = schema;
    
    if (!columnMap || typeof columnMap !== 'object' || typeof columnMap.title !== 'number' || typeof columnMap.author !== 'number') {
      return [];
    }

    const books: { title: string, author: string, isbn?: string, genre?: string, format?: 'physical' | 'digital' }[] = [];
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
           if (fVal.includes('kindle') || fVal.includes('ebook') || fVal.includes('digital') || fVal.includes('audiobook')) {
             format = 'digital';
           } else {
             format = 'physical';
           }
        }
      }

      books.push({
        title: row[titleIndex].trim(),
        author: typeof columnMap.author === 'number' ? (row[columnMap.author] || 'Unknown').trim() : 'Unknown',
        isbn: isbn,
        genre: typeof columnMap.genre === 'number' ? row[columnMap.genre]?.trim() : undefined,
        format: format
      });
    }

    return books;
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function enrichBooksMetadata(books: { id: string, title: string, author: string, description?: string, currentGenre?: string }[]): Promise<{ id: string, genre: string, series: string }[]> {
  try {
    if (!books || books.length === 0) return [];
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `Act as an expert librarian. I have a list of books. For each book, please determine:
    1. The primary literary genre (be specific but use standard categories like 'Science Fiction', 'High Fantasy', 'Historical Fiction', 'Thriller', 'Biography', etc.).
    2. The book series it belongs to. If it is a standalone book, return 'Standalone'.

    Here are the books:
    ${JSON.stringify(books.map(b => ({ id: b.id, title: b.title, author: b.author }))) }

    Return ONLY a JSON array of objects. Do not include markdown formatting like \`\`\`json. Each object MUST have:
    - id (exactly matching the provided id)
    - genre (the literary genre)
    - series (the series name, or 'Standalone')
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
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
      console.error("Failed to parse Gemini response:", e);
      return [];
    }
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function generateLibraryRecommendations(libraryBooks: { title: string, author: string }[]): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    // Limit to 100 books to provide more context for recommendations
    const limitedBooks = libraryBooks.slice(0, 100);
    const bookList = limitedBooks.map(b => `"${b.title}" by ${b.author}`).join('\n');
    const prompt = `Act as an expert librarian. Here is a list of books in my library:
    
${bookList}

Based on this reading history, please recommend 5 new books that I might enjoy. 
For each recommendation, provide the Title, Author, and a brief 2-3 sentence explanation of WHY it is a good fit based on my existing library. 
Format the response with simple markdown (use ## for the book titles).`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
    });

    return response.text || "I'm sorry, I couldn't generate recommendations at the moment.";
  } catch (error) {
    handleGeminiError(error);
  }
}
export async function generateBookInsights(title: string, author: string, type: 'summary' | 'catchup' | 'similar' | 'author_bio'): Promise<string> {
  try {
    let prompt = "";
    switch (type) {
      case 'summary':
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

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
    });

    return response.text || "I'm sorry, I couldn't generate insights for this book at the moment.";
  } catch (error) {
    handleGeminiError(error);
  }
}

export async function generateLibraryHeroImage(libraryName: string): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
          aspectRatio: "16:9"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64 = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        return await compressImage(base64);
      }
    }
    return null;
  } catch (error) {
    console.error("Error generating library hero image:", error);
    return null;
  }
}

export async function getPickOfTheDay(books: { title: string, author: string }[]): Promise<{ title: string, author: string, reason: string } | null> {
  try {
    if (!books || books.length === 0) return null;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const bookList = books.map((b, i) => `${i+1}. "${b.title}" by ${b.author}`).join('\n');
    const prompt = `Act as an expert librarian. Here is a sample of books from my library:

${bookList}

Based on the themes and genres of these books, please recommend exactly ONE new book that I would enjoy reading. 
CRITICAL RULE: The book you recommend MUST NOT be in the list above.

Explain in exactly 1-2 sentences WHY this specific book is a great recommendation based on my current library.

Return ONLY a JSON object. Do not include markdown formatting like \`\`\`json. The object MUST have:
- title (the book title)
- author (the book author)
- reason (your 1-2 sentence explanation)`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed.title && parsed.author && parsed.reason) {
        return parsed as { title: string, author: string, reason: string };
      }
      return null;
    } catch(e) {
       return null;
    }
  } catch (err) {
    console.error("Pick of the day error:", err);
    return null;
  }
}

async function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
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
