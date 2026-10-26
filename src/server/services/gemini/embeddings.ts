import {Type, ThinkingLevel} from '@google/genai';
import {
  generateContentWithLimiter,
  geminiEmbeddingProvider,
  isApiKeyError,
  handleGeminiError,
} from './client';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';

export interface ClusterBookSample {
  title: string;
  author?: string;
  primaryGenre?: string;
  synopsis?: string;
}

export interface ClusterThemeInfo {
  name: string;
  thesis: string;
}

export async function generateClusterThemes(
  clusters: Array<{
    id: number;
    totalCount?: number;
    books: ClusterBookSample[];
  }>,
): Promise<Record<number, ClusterThemeInfo>> {
  try {
    if (!clusters || clusters.length === 0) {
      return {};
    }

    const prompt = `Clustered below are constellations of books from a reader's library, grouped by high-dimensional semantic vector kinship.
For each cluster ID, look BEYOND obvious bookstore genres and surface-level categories to uncover the emergent, organic connection uniting the books—such as a shared human dilemma, psychological atmosphere, philosophical tension, narrative structure, or recurring motif.

For each cluster, provide:
1. "name": A distinct, evocative thematic constellation title (2 to 4 words max).
2. "thesis": A single, insightful curatorial sentence (14 to 28 words) explaining the non-obvious thread that connects these specific works.

Rules:
- STRICTLY FORBIDDEN in "name": Never use standard bookstore genre labels ("Science Fiction", "Historical Fiction", "Fantasy", "Mystery", "Thriller", "Biography", "Non-Fiction", "Literary Fiction", "Romance", "Horror", "History", "Philosophy") or filler words ("Books", "Novels", "Cluster", "Misc", "Collection").
- Ensure every cluster in the response has a unique "name" and a specific "thesis" grounded in the books listed.
- Examples of strong emergent names: "Architects of Fragile Utopias", "Memory & Exiled Identities", "Quiet Domestic Revolutions", "Obsession at the Frontier", "Labyrinths of Institutional Power".

Clusters:
${clusters
  .map(c => {
    const countLabel =
      typeof c.totalCount === 'number' && c.totalCount > c.books.length
        ? ` (${c.totalCount} total volumes; representative sample below)`
        : '';
    const bookLines = c.books
      .slice(0, 18)
      .map(b => {
        const authorPart = b.author ? ` by ${b.author}` : '';
        const genrePart = b.primaryGenre ? ` [${b.primaryGenre}]` : '';
        const synSnippet = b.synopsis
          ? ` — ${b.synopsis.replace(/\s+/g, ' ').trim().slice(0, 160)}`
          : '';
        return `- "${b.title || 'Unknown Title'}"${authorPart}${genrePart}${synSnippet}`;
      })
      .join('\n');
    return `ID ${c.id}${countLabel}:\n${bookLines}`;
  })
  .join('\n\n')}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an erudite literary curator and bibliographer who discovers surprising, cross-genre thematic threads and intellectual kinships across personal book collections.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description:
            'List of named constellations with their one-sentence curatorial thesis',
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.INTEGER,
                description: 'The exact cluster ID provided in the input',
              },
              name: {
                type: Type.STRING,
                description:
                  'Evocative, non-genre thematic constellation name (2 to 4 words max)',
              },
              thesis: {
                type: Type.STRING,
                description:
                  'One-sentence curatorial thesis (14 to 28 words) explaining the emergent connection uniting the cluster',
              },
            },
            required: ['id', 'name', 'thesis'],
          },
        },
        temperature: 0.35,
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

    const result: Record<number, ClusterThemeInfo> = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item?.id === 'number' && typeof item?.name === 'string') {
          const cleanName = item.name.trim();
          const cleanThesis =
            typeof item.thesis === 'string' ? item.thesis.trim() : '';
          if (cleanName) {
            result[item.id] = {
              name: cleanName,
              thesis: cleanThesis,
            };
          }
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        const numericMatch = key.match(/\d+/);
        if (numericMatch) {
          const cid = parseInt(numericMatch[0], 10);
          const val = (parsed as Record<string, unknown>)[key];
          if (typeof val === 'string' && val.trim()) {
            result[cid] = {name: val.trim(), thesis: ''};
          } else if (val && typeof val === 'object') {
            const obj = val as Record<string, unknown>;
            const cleanName =
              typeof obj.name === 'string' ? obj.name.trim() : '';
            const cleanThesis =
              typeof obj.thesis === 'string' ? obj.thesis.trim() : '';
            if (cleanName) {
              result[cid] = {name: cleanName, thesis: cleanThesis};
            }
          }
        }
      }
    }

    return result;
  } catch (err) {
    if (isApiKeyError(err)) {
      console.info(
        'Cluster theme generation is pending valid GEMINI_API_KEY configuration.',
      );
    } else {
      console.error('Failed to generate cluster themes:', err);
    }
    return {};
  }
}

export async function generateClusterNames(
  clusters: Array<{
    id: number;
    totalCount?: number;
    books: ClusterBookSample[];
  }>,
): Promise<Record<number, string>> {
  const themes = await generateClusterThemes(clusters);
  const names: Record<number, string> = {};
  for (const [idStr, info] of Object.entries(themes)) {
    if (info?.name) {
      names[Number(idStr)] = info.name;
    }
  }
  return names;
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
