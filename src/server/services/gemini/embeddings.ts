import {Type} from '@google/genai';
import {
  generateContentWithLimiter,
  geminiEmbeddingProvider,
  isApiKeyError,
  handleGeminiError,
} from './client';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';

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
      model: 'gemini-3-flash-preview',
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
    if (!texts || texts.length === 0) return [];
    const embeddings: number[][] = new Array(texts.length).fill([]);

    let completedCount = 0;
    const priority = options?.priority ?? 'BATCH';

    await Promise.all(
      texts.map(async (text, index) => {
        if (options?.signal?.aborted) return;
        try {
          const values = await geminiEmbeddingProvider.embedText(text, {
            priority,
            signal: options?.signal,
          });
          if (values && values.length > 0) {
            embeddings[index] = values;
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
