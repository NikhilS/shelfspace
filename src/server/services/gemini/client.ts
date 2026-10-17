import {GoogleGenAI} from '@google/genai';
import {geminiLimiter} from '../limiters';

export const logger = {
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

export function getGeminiClient(): GoogleGenAI {
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
