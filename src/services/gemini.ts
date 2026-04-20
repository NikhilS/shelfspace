import { GoogleGenAI } from "@google/genai";

export function handleGeminiError(error: any): never {
  console.error("Error calling Gemini:", error);
  const errorMessage = error?.message || '';
  if (error?.status === 429 || errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota')) {
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

export async function extractBooksFromCsv(csvText: string): Promise<{ title: string, author: string, isbn?: string, genre?: string }[]> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a data extraction assistant. I am providing you with the raw text of a CSV file containing a user's book library (e.g., from Goodreads, Amazon, or a custom spreadsheet).
      
      Your task is to parse this data and extract the list of books.
      For each book, extract:
      - title (string, required)
      - author (string, required. If multiple, join with commas)
      - isbn (string, optional. Prefer ISBN13 if both are present. Clean up any formatting like '="123"' to just '123')
      - genre (string, optional. If there are bookshelves/tags, pick the most relevant genre)

      Return ONLY a JSON array of objects. Do not include markdown formatting like \`\`\`json. Just the raw JSON array.
      
      CSV Data:
      ${csvText.substring(0, 30000)} // Limit to avoid token limits if file is massive
      `,
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
export async function generateBookInsights(title: string, author: string, type: 'summary' | 'catchup' | 'similar'): Promise<string> {
  try {
    let prompt = "";
    switch (type) {
      case 'summary':
        prompt = `Act as an expert librarian and literary critic. Provide a compelling, spoiler-free summary of the book "${title}" by ${author}. 
        Focus on the premise, the main themes, the setting, and the general tone of the book. 
        Why might someone want to read this? Keep it concise (around 2-3 paragraphs) and engaging. Format with simple markdown (use ## for headings if needed).`;
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
