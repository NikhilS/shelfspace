import {ThinkingLevel, Type} from '@google/genai';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {
  batchGeminiOperation,
  generateContentWithLimiter,
  handleGeminiError,
  isApiKeyError,
} from './client';
import {gateSeriesCandidatesWithDecisions} from './decisionsEnrichment';

export async function generateBookInsights(
  title: string,
  author: string,
  type: 'summary' | 'catchup' | 'similar' | 'authorBio' | 'synopsis',
  signal?: AbortSignal,
): Promise<string> {
  let prompt = '';
  switch (type) {
    case 'summary':
    case 'synopsis':
      prompt = `Provide a compelling, spoiler-free literary summary of "${title}" by ${author}.
Focus on the core premise, central conflict, primary themes, setting, and narrative tone.
Conclude with what kind of reader would find this work most rewarding. Keep it to 2-3 engaging, well-crafted paragraphs without conversational filler. Format with clean markdown (use ## for subheadings if appropriate).`;
      break;
    case 'authorBio':
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
Detail all major twists, character fates, alliances, and the exact ending accurately. Use concise markdown with bullet points for readability.`;
      break;
    case 'similar':
      prompt = `Recommend 3 to 5 real, published books with strong thematic, stylistic, or emotional kinship to "${title}" by ${author} (excluding other volumes in the same series).
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
            'You are an insightful literary scholar, critic, and expert librarian who provides rich, factually accurate, and compelling book analyses.',
          temperature: type === 'catchup' ? 0.3 : 0.5,
          thinkingConfig: {
            thinkingLevel:
              type === 'catchup' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
          },
        },
      });

      return (
        response.text ||
        "I'm sorry, I couldn't generate insights for this book at the moment."
      );
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
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

export async function getPickOfTheDay(
  books: Array<{
    title: string;
    author: string;
    primaryGenre?: string;
    subgenres?: string[];
  }>,
): Promise<Array<{title: string; author: string; reason: string}> | null> {
  try {
    if (!books || books.length === 0) {
      return null;
    }
    const shuffled = [...books];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sampleBooks = shuffled.slice(0, 100);
    const allOwnedTitles = Array.from(
      new Set(
        books.map(b => b.title?.trim()).filter((t): t is string => Boolean(t)),
      ),
    ).slice(0, 350);

    const bookList = sampleBooks
      .map((b, i) => {
        let line = `${i + 1}. "${b.title || 'Unknown Title'}" by ${b.author || 'Unknown Author'}`;
        if (b.primaryGenre) {
          const subText =
            b.subgenres && b.subgenres.length > 0
              ? ` (${b.subgenres.join(', ')})`
              : '';
          line += ` [Genre: ${b.primaryGenre}${subText}]`;
        }
        return line;
      })
      .join('\n');

    const prompt = `Here is a sample of books from a reader's personal library:

${bookList}

Full Exclusion List of Owned Titles:
${allOwnedTitles.join(' | ')}

Based on the underlying themes, literary voices, and conceptual styles across these titles, recommend 10 non-obvious, deeply rewarding books that this reader would love.
Think like an expert library curator discovering unexpected gems and profound thematic bridges.

CRITICAL RULES:
1. The recommended books MUST NOT appear in the reader's sample list or Full Exclusion List above.
2. Every recommended book MUST be an authentic, published book attributed to its real-world author.
3. Provide 10 distinct recommendations.
4. For each book, explain in 1-2 insightful sentences WHY it is a superb recommendation, naming specific books or themes in their library that it bridges.`;

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
            'You are a distinguished literary curator and reader advisory expert who recommends real, high-resonance literature.',
          responseMimeType: 'application/json',
          responseSchema: pickOfTheDaySchema,
          temperature: 0.6,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      console.warn('Retrying Pick of the Day with Gemini 3.8 Flash:', e);
      response = await generateContentWithLimiter({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: pickOfTheDaySchema,
          temperature: 0.5,
        },
      });
    }

    let text = response.text;
    if (!text) {
      return null;
    }
    try {
      text = text
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      const parsed: unknown = JSON.parse(text);
      const isPickItem = (
        val: unknown,
      ): val is {title: string; author: string; reason: string} => {
        if (!val || typeof val !== 'object') {
          return false;
        }
        const rec = val as Record<string, unknown>;
        return (
          typeof rec.title === 'string' &&
          Boolean(rec.title) &&
          typeof rec.author === 'string' &&
          Boolean(rec.author) &&
          typeof rec.reason === 'string' &&
          Boolean(rec.reason)
        );
      };
      if (Array.isArray(parsed)) {
        return (parsed as unknown[]).filter(isPickItem);
      } else if (isPickItem(parsed)) {
        return [parsed];
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

export async function generateBookSynopsesBatch(
  books: Array<{id: string; title: string; author: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) {
    return {};
  }

  const schema = {
    type: Type.ARRAY,
    description: 'Concise literary synopses for the requested books',
    items: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.STRING,
          description: 'Exact book ID from the input',
        },
        synopsis: {
          type: Type.STRING,
          description:
            'Compelling, spoiler-free 1-2 paragraph literary summary of the book.',
        },
      },
      required: ['id', 'synopsis'],
    },
  };

  const prompt =
    'Provide a compelling, factually accurate, spoiler-free literary summary (1 to 2 concise paragraphs) for each book in the provided list. Preserve the exact input "id" for each book.';

  const res = await batchGeminiOperation<
    Array<{id: string; synopsis?: string}>
  >(
    books,
    prompt,
    schema,
    'You are an insightful literary scholar and librarian who writes accurate, spoiler-free book summaries.',
    {
      ...options,
      model: 'gemini-3.8-flash',
      thinkingLevel: ThinkingLevel.LOW,
    },
  );

  const map: Record<string, string> = {};
  if (Array.isArray(res)) {
    for (const item of res) {
      if (item?.id && item?.synopsis && item.synopsis.trim()) {
        map[item.id] = item.synopsis.trim();
      }
    }
  }
  return map;
}

export async function generateAuthorBiosBatch(
  books: Array<{id: string; title: string; author: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) {
    return {};
  }

  const schema = {
    type: Type.ARRAY,
    description: 'Author biographical profiles for the requested books',
    items: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.STRING,
          description: 'Exact book ID from the input',
        },
        authorBio: {
          type: Type.STRING,
          description:
            'Authoritative 1-2 paragraph biographical profile of the book author.',
        },
      },
      required: ['id', 'authorBio'],
    },
  };

  const prompt =
    'Provide an authoritative, concise 1-2 paragraph biographical profile for the author of each book in the provided list, focusing on their literary career, major themes, and notable works. Preserve the exact input "id" for each book.';

  const res = await batchGeminiOperation<
    Array<{id: string; authorBio?: string}>
  >(
    books,
    prompt,
    schema,
    'You are an insightful literary scholar and biographer.',
    {
      ...options,
      model: 'gemini-3.8-flash',
      thinkingLevel: ThinkingLevel.LOW,
    },
  );

  const map: Record<string, string> = {};
  if (Array.isArray(res)) {
    for (const item of res) {
      if (item?.id && item?.authorBio && item.authorBio.trim()) {
        map[item.id] = item.authorBio.trim();
      }
    }
  }
  return map;
}

export async function extractBookSeriesBatch(
  books: Array<{id: string; title: string; author: string; synopsis?: string}>,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
    skipStandaloneGate?: boolean;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) {
    return {};
  }

  let seriesCandidates = books;
  if (!options?.skipStandaloneGate) {
    try {
      const candidateIds = await gateSeriesCandidatesWithDecisions(
        books,
        options,
      );
      seriesCandidates = books.filter(b => candidateIds.has(b.id));
    } catch (err) {
      if (isApiKeyError(err)) {
        console.info(
          'Series standalone gate is pending valid GEMINI_API_KEY configuration.',
        );
        return {};
      }
      handleGeminiError(err);
    }
  }

  if (seriesCandidates.length === 0) {
    return {};
  }

  const schema = {
    type: Type.ARRAY,
    description: 'Series name and book number for books belonging to a series',
    items: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.STRING,
          description: 'Exact book ID from the input',
        },
        isPartOfSeries: {
          type: Type.BOOLEAN,
          description:
            'True ONLY if the book is genuinely part of a named literary series, trilogy, or multi-volume cycle.',
        },
        series: {
          type: Type.STRING,
          description:
            'Formatted series name and volume number (e.g., "Dune Chronicles #1", "The Lord of the Rings #2", "Neapolitan Novels #1"). Empty string if standalone.',
        },
      },
      required: ['id', 'isPartOfSeries'],
    },
  };

  const prompt = `Format the exact canonical series name and volume number for each confirmed series installment below.
Directives:
1. Set "isPartOfSeries: true" and format "series" cleanly as "Series Name #N" (e.g., "Foundation #1", "The Stormlight Archive #2", "Wolf Hall Trilogy #1").
2. If upon closer inspection a book is actually standalone, set "isPartOfSeries: false" and omit "series".
3. Preserve the exact input "id" for each book.`;

  const res = await batchGeminiOperation<
    Array<{id: string; isPartOfSeries?: boolean; series?: string}>
  >(
    seriesCandidates,
    prompt,
    schema,
    'You are a meticulous bibliographer and literary archivist specializing in book series and edition numbering.',
    {
      ...options,
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
  );

  const map: Record<string, string> = {};
  if (Array.isArray(res)) {
    for (const item of res) {
      if (
        item?.id &&
        item?.isPartOfSeries &&
        item?.series &&
        item.series.trim()
      ) {
        map[item.id] = item.series.trim();
      }
    }
  }
  return map;
}
