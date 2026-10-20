import {GoogleGenAI} from '@google/genai';
import {geminiLimiter, geminiEmbeddingLimiter} from '../limiters';
import type {
  ProviderQuotaScheduler,
  SchedulePriority,
  ScheduleTaskOptions,
} from '../scheduler/providerQuotaScheduler';

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
 * First-class provider wrapper for Gemini Structured Extraction & Literary Insights.
 * Participates in both Local (`gemini-structured` token bucket) and Global (`GlobalProviderGovernor`)
 * rate limiting with INTERACTIVE > BATCH priority preemption.
 */
export class GeminiStructuredProvider {
  public readonly id = 'gemini-structured' as const;
  public readonly name = 'Gemini AI' as const;
  public readonly scheduler: ProviderQuotaScheduler = geminiLimiter;

  public isAvailable(): boolean {
    const apiKey = process.env.GEMINI_API_KEY;
    return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
  }

  public async generateContent(
    options: Parameters<GoogleGenAI['models']['generateContent']>[0],
    scheduleOptions?: ScheduleTaskOptions,
  ) {
    const ai = getGeminiClient();
    if (scheduleOptions && Object.keys(scheduleOptions).length > 0) {
      return this.scheduler.schedule(scheduleOptions, () =>
        ai.models.generateContent(options),
      );
    }
    return this.scheduler.schedule(() => ai.models.generateContent(options));
  }
}

/**
 * First-class provider wrapper for Gemini Vector Embeddings (`gemini-embedding-2-preview`).
 * Ensures embedding generation participates in dual-lane priority scheduling and 429 cooldowns.
 */
export class GeminiEmbeddingProvider {
  public readonly id = 'gemini-embedding' as const;
  public readonly name = 'Gemini Embeddings' as const;
  public readonly scheduler: ProviderQuotaScheduler = geminiEmbeddingLimiter;

  public isAvailable(): boolean {
    const apiKey = process.env.GEMINI_API_KEY;
    return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
  }

  public async embedText(
    text: string,
    scheduleOptions?: ScheduleTaskOptions,
  ): Promise<number[]> {
    const ai = getGeminiClient();
    const task = async () => {
      const embedResponse = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: text,
      });
      return embedResponse?.embeddings?.[0]?.values || [];
    };

    if (scheduleOptions && Object.keys(scheduleOptions).length > 0) {
      return this.scheduler.schedule(scheduleOptions, task);
    }
    return this.scheduler.schedule({priority: 'BATCH'}, task);
  }
}

export const geminiStructuredProvider = new GeminiStructuredProvider();
export const geminiEmbeddingProvider = new GeminiEmbeddingProvider();

/**
 * Centrally rate-limited wrapper for generateContent.
 * Supports optional schedule priority (`INTERACTIVE` | `BATCH`) and AbortSignal.
 */
export async function generateContentWithLimiter(
  options: Parameters<GoogleGenAI['models']['generateContent']>[0],
  scheduleOptions?: ScheduleTaskOptions,
) {
  return geminiStructuredProvider.generateContent(options, scheduleOptions);
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
  options?: {priority?: SchedulePriority; signal?: AbortSignal},
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

    const response = await generateContentWithLimiter(
      {
        model: 'gemini-3-flash-preview',
        contents: fullPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.2,
        },
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

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
