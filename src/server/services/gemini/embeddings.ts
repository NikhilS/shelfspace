import {Type, ThinkingLevel} from '@google/genai';
import {
  generateContentWithLimiter,
  geminiEmbeddingProvider,
  isApiKeyError,
  handleGeminiError,
} from './client';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';

export async function generateClusterNames(
  clusters: Array<{id: number; books: Array<{title: string; author?: string}>}>,
): Promise<Record<number, string>> {
  try {
    if (!clusters || clusters.length === 0) {
      return {};
    }

    const prompt = `Clustered below are groups of books from a reader's library based on semantic vector similarity.
For each cluster ID, inspect the titles and authors to identify the shared literary genre, intellectual tradition, aesthetic mood, or historical subject.
Provide a distinct, evocative, and concise name for each cluster (1 to 3 words max).
Rules:
- Never use generic filler words ("Books", "Novels", "Cluster", "Misc", "Collection").
- Ensure every cluster in the response has a unique name (no duplicates across cluster IDs).
- Examples of strong names: "Cosmic Dread", "Golden Age Sleuths", "Magical Realism", "Stoic Philosophy", "Cyberpunk Dystopia".

Clusters:
${clusters
  .map(
    c =>
      `ID ${c.id}:\n${c.books
        .slice(0, 15)
        .map(
          b =>
            `- ${b.title || 'Unknown Title'}${b.author ? ` by ${b.author}` : ''}`,
        )
        .join('\n')}`,
  )
  .join('\n\n')}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.1-flash-lite',
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
        temperature: 0.3,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL,
        },
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
          result[parseInt(numericMatch[0], 10)] = String(
            (parsed as Record<string, unknown>)[key],
          ).trim();
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
  options?: {priority?: SchedulePriority; signal?: AbortSignal},
): Promise<number[][]> {
  try {
    if (!texts || texts.length === 0) {
      return [];
    }
    const embeddings: number[][] = new Array(texts.length).fill([]);

    let completedCount = 0;
    const priority = options?.priority ?? 'BATCH';
    const inFlightByText = new Map<string, Promise<number[]>>();

    await Promise.all(
      texts.map(async (text, index) => {
        if (options?.signal?.aborted) {
          return;
        }
        const normalizedKey = text.trim();
        try {
          if (normalizedKey) {
            let promise = inFlightByText.get(normalizedKey);
            if (!promise) {
              promise = geminiEmbeddingProvider.embedText(normalizedKey, {
                priority,
                signal: options?.signal,
              });
              inFlightByText.set(normalizedKey, promise);
            }
            const values = await promise;
            if (values && values.length > 0) {
              embeddings[index] = values;
            }
          }
        } catch (err: unknown) {
          console.warn('Failed to embed text: ', err);
        } finally {
          completedCount++;
          if (onProgress) {
            onProgress(completedCount, texts.length);
          }
        }
      }),
    );

    return embeddings;
  } catch (error) {
    handleGeminiError(error);
  }
}
