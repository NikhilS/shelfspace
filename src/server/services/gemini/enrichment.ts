import {Type, ThinkingLevel} from '@google/genai';
import {BOOK_TAXONOMY, sanitizeGenrePayload} from '../../../constants/taxonomy';
import {
  generateContentWithLimiter,
  isApiKeyError,
  handleGeminiError,
  batchGeminiOperation,
} from './client';

export async function generateLibraryRecommendations(
  libraryBooks: {
    title: string;
    author: string;
    primaryGenre?: string;
    subgenres?: string[];
  }[],
): Promise<string> {
  try {
    const limitedBooks = libraryBooks.slice(0, 100);
    const allOwnedTitles = Array.from(
      new Set(
        libraryBooks
          .map(b => b.title?.trim())
          .filter((t): t is string => Boolean(t)),
      ),
    ).slice(0, 300);

    const bookList = limitedBooks
      .map(b => {
        let line = `"${b.title}" by ${b.author}`;
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

    const prompt = `Here is a catalog of books from a reader's personal library:

${bookList}

Owned Titles Do-Not-Recommend List:
${allOwnedTitles.join(' | ')}

Based on this reader's interests, recurring genres, narrative styles, pacing, and philosophical themes, recommend 5 captivating new books to expand their horizons.

CRITICAL DIRECTIVES:
1. STRICTLY DO NOT recommend any book already listed in the reader's library or in the Owned Titles Do-Not-Recommend List above, nor direct sequels to unread series already owned.
2. Every recommended book MUST be a real, verifiable published work attributed to its actual author (never invent or conflate titles and authors).
3. Recommend exceptional, distinctive titles (a thoughtful blend of acclaimed literary works, modern masterworks, and high-resonance hidden gems).
4. For each book, use this exact markdown format:
   ## [Book Title] by [Author]
   **Why It Fits Your Library**: 2-3 sentences explaining the exact thematic, stylistic, or intellectual resonance with specific books in their collection.
   **Key Themes**: 3-4 comma-separated tags (e.g., *Speculative Fiction, Found Family, Moral Ambiguity*).`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an erudite, insightful literary curator and librarian who recommends real, verifiable books with nuance, depth, and precision.',
        temperature: 0.5,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
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
      prompt = `Provide a compelling, spoiler-free literary summary of "${title}" by ${author}.
Focus on the core premise, central conflict, primary themes, setting, and narrative tone.
Conclude with what kind of reader would find this work most rewarding. Keep it to 2-3 engaging, well-crafted paragraphs without conversational filler. Format with clean markdown (use ## for subheadings if appropriate).`;
      break;
    case 'author_bio':
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

export async function getPickOfTheDay(
  books: {
    title: string;
    author: string;
    primaryGenre?: string;
    subgenres?: string[];
  }[],
): Promise<{title: string; author: string; reason: string}[] | null> {
  try {
    if (!books || books.length === 0) return null;
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

export interface ClassifiedBookGenre {
  id: string;
  primaryGenre: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
}

export async function classifyBooks(
  batch: {id: string; title: string; author: string; synopsis?: string}[],
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
    customGenres?: string[];
  },
): Promise<ClassifiedBookGenre[]> {
  try {
    if (!batch || batch.length === 0) return [];
    const booksPromptData = batch.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      context: b.synopsis ? b.synopsis.substring(0, 300) : '',
    }));

    const canonicalGenres = Object.keys(BOOK_TAXONOMY).filter(
      k => k !== 'Other',
    );
    const validCustomGenres = Array.from(
      new Set(
        (options?.customGenres || [])
          .map(g => g.trim())
          .filter(Boolean)
          .slice(0, 50),
      ),
    );
    const allowedPrimaryEnum = Array.from(
      new Set([...canonicalGenres, ...validCustomGenres, 'Other']),
    );

    const canonicalTaxonomySummary = Object.entries(BOOK_TAXONOMY)
      .filter(([k]) => k !== 'Other')
      .map(
        ([genre, subs]) =>
          `- "${genre}": [${subs.map(s => `"${s}"`).join(', ')}]`,
      )
      .join('\n');

    const customGenresBlock =
      validCustomGenres.length > 0
        ? `\nCustom Library Primary Genres (use when a book specifically fits one of these user-defined categories):\n${validCustomGenres.map(g => `- "${g}"`).join('\n')}`
        : '';

    const prompt = `Classify the following batch of ${batch.length} books into the application's standardized taxonomy.

Canonical Primary Genres & Their Available Subgenres:
${canonicalTaxonomySummary}${customGenresBlock}
- "Other": Use only if the book completely defies all canonical and custom genres above.

Directives:
1. "primaryGenre" (REQUIRED): Select the single best-fitting Primary Genre from the allowed list.
2. "subgenres" (OPTIONAL): Choose 0 to 3 relevant subgenres strictly from the selected Primary Genre's allowed subgenre list. Omit subgenres if none clearly apply.
3. Preserve the exact provided unique book "id".

Books to classify:
${JSON.stringify(booksPromptData)}`;

    const response = await generateContentWithLimiter(
      {
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          systemInstruction:
            'You are an expert library cataloger and bibliographer specializing in literary taxonomy and genre classification.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            description: 'Classified books with standardized taxonomy',
            items: {
              type: Type.OBJECT,
              properties: {
                id: {
                  type: Type.STRING,
                  description: 'The exact input ID of the book',
                },
                primaryGenre: {
                  type: Type.STRING,
                  enum: allowedPrimaryEnum,
                  description: 'The chosen canonical or custom primary genre',
                },
                subgenres: {
                  type: Type.ARRAY,
                  items: {type: Type.STRING},
                  description:
                    '0 to 3 valid subgenres from the chosen primary genre',
                },
              },
              required: ['id', 'primaryGenre'],
            },
          },
          temperature: 0.1,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
        },
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

    const text = response.text;
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(
          (item: {id: string; primaryGenre?: string; subgenres?: string[]}) => {
            const rawPrimary = item.primaryGenre?.trim() || '';
            if (
              validCustomGenres.includes(rawPrimary) &&
              !canonicalGenres.includes(rawPrimary)
            ) {
              return {
                id: item.id,
                primaryGenre: rawPrimary,
                subgenres: [],
                isCustomPrimary: true,
              };
            }
            const sanitized = sanitizeGenrePayload({
              primaryGenre: item.primaryGenre,
              subgenres: item.subgenres,
            });
            return {
              id: item.id,
              primaryGenre: sanitized.primaryGenre,
              subgenres: sanitized.subgenres,
              isCustomPrimary: sanitized.isCustomPrimary,
            };
          },
        );
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

export interface BatchExtractedGeoBookResult {
  id: string;
  isNonEarth: boolean;
  locations: ExtractedGeoLocation[];
}

export interface BatchExtractedGeoResponse {
  enrichment: BatchExtractedGeoBookResult[];
}

export async function extractBookGeoMetadataBatch(
  books: {id: string; title: string; author: string; synopsis?: string}[],
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
  },
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
                'Set to true ONLY if the entire work is sci-fi set in space/fictional planets, high fantasy set in completely fictional realms, or is a textbook, academic guide, philosophy treatise, or abstract work with no logical earthly setting.',
            },
            locations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description:
                      "Fully-qualified geographical name including city/region, state/province, and country to guarantee unambiguous geocoding (e.g., 'Kyoto, Japan', 'Delhi, India', 'Gettysburg, PA, USA').",
                  },
                  adminLevel: {
                    type: Type.STRING,
                    enum: ['city', 'state', 'country', 'region'],
                    description: 'Granularity type of setting.',
                  },
                  rationale: {
                    type: Type.STRING,
                    description:
                      'A short context sentence (15 words max) describing why this spatial setting is vital to the story or historical subject.',
                  },
                },
                required: ['name', 'adminLevel', 'rationale'],
              },
              description:
                'At most 5 key geographical regions, cities, states, or countries central to the narrative, plot, or historical subject. Return empty list if isNonEarth is true.',
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

  const prompt = `Analyze the provided list of books and determine the real-world geographical settings on Earth for each book.

Directives:
1. For each book, identify up to 5 critical real-world locations (cities, states/provinces, regions, or countries) where the primary narrative, biography, or historical actions take place.
2. NEVER use the book publisher's headquarters or the author's residence unless the book's subject or plot actually takes place there.
3. Every location "name" must be fully-qualified and globally unambiguous (e.g., "Kyoto, Japan", "Oxford, Oxfordshire, United Kingdom", "Concord, MA, USA").
4. Set "adminLevel" to "city", "state", "country", or "region".
5. Provide a concise rationale (15 words max) explaining its narrative or historical significance.
6. If a book is set entirely in a fictional realm (e.g., Middle-earth, Westeros, Arrakis), outer space, or is a timeless instructional, philosophical, or technical work without a geographic setting, set "isNonEarth": true and return an empty "locations": [] array.
7. Preserve the exact input "id" for each book.`;

  return batchGeminiOperation<BatchExtractedGeoResponse>(
    books,
    prompt,
    batchSchema,
    'You are an authoritative literary geographer with deep knowledge of world literature, non-fiction contexts, and global historical geography.',
    {
      ...options,
      model: 'gemini-3.8-flash',
      thinkingLevel: ThinkingLevel.LOW,
    },
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
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
  },
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
                'Set to true if the book is sci-fi/fantasy with entirely fictional settings, or is an abstract technical/reference/philosophical work with no specific historical or chronological setting.',
            },
            startYear: {
              type: Type.INTEGER,
              description:
                'Approximate start year of the events or plot (-10000 to 2100). Use negative values for BC/BCE (e.g. -44). Leave blank or omit if isNonHistorical is true.',
            },
            endYear: {
              type: Type.INTEGER,
              description:
                'Approximate end year of the events (must be >= startYear and within 100 years of startYear). Leave blank or omit if isNonHistorical is true.',
            },
            eraName: {
              type: Type.STRING,
              description:
                'Cohesive name label for this historical era (e.g., "Middle Ages", "Renaissance", "World War II", "Victorian Era", "Late Roman Republic"). 2-5 words max. Leave blank or omit if isNonHistorical is true.',
            },
            rationale: {
              type: Type.STRING,
              description:
                'Max 15 words explaining why this temporal context is central to the book. Leave blank or omit if isNonHistorical is true.',
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

  const prompt = `Analyze the provided list of books and determine the chronological historical setting and era for each book on Earth.

Directives:
1. Identify whether the book possesses a real-world Earth timeline or historical setting.
2. If the book is set in an entirely fictional realm (fantasy), far-future or deep-space setting (sci-fi), or is a timeless technical, self-help, or reference manual with no narrative era, mark "isNonHistorical": true and omit startYear, endYear, eraName, and rationale.
3. For books with real Earth timelines:
   - "startYear": Integer representing the approximate starting year of the core events (use negative values for BCE/BC, e.g. -44).
   - "endYear": Integer >= startYear representing the approximate ending year. The span (endYear - startYear) must NOT exceed 100 years; for sweeping histories, select the primary focal century.
   - "eraName": Concise historical era name (2-5 words max, e.g., "Late Antiquity", "Italian Renaissance", "Victorian Era", "Cold War Era", "Jazz Age").
   - "rationale": Concise explanation (15 words max) of the temporal context.
4. Years MUST be between -10000 and 2100.
5. Map each book specifically to its unique input "id".`;

  const result = await batchGeminiOperation<BatchTemporalResponse>(
    books,
    prompt,
    batchSchema,
    'You are an academic bibliophile historian with encyclopedic knowledge of world history, literary chronology, and historical eras.',
    {
      ...options,
      model: 'gemini-3.8-flash',
      thinkingLevel: ThinkingLevel.LOW,
    },
  );

  if (result?.enrichment) {
    result.enrichment.forEach(item => {
      if (!item.isNonHistorical && item.startYear !== undefined) {
        if (item.endYear === undefined) {
          item.endYear = item.startYear;
        } else if (item.endYear < item.startYear) {
          const temp = item.startYear;
          item.startYear = item.endYear;
          item.endYear = temp;
        }
        if (item.endYear - item.startYear > 100) {
          item.endYear = item.startYear + 100;
        }
      }
    });
  }

  return result;
}

export async function generateBookSynopsesBatch(
  books: {id: string; title: string; author: string}[],
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) return {};

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
  books: {id: string; title: string; author: string}[],
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) return {};

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
  books: {id: string; title: string; author: string; synopsis?: string}[],
  options?: {
    priority?: import('../scheduler/providerQuotaScheduler').SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  if (!books || books.length === 0) return {};

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

  const prompt = `Determine whether each book in the provided list belongs to a known literary series, trilogy, or multi-volume sequence.
Directives:
1. If a book belongs to a series, set "isPartOfSeries: true" and format "series" cleanly as "Series Name #N" (e.g., "Foundation #1", "The Stormlight Archive #2", "Wolf Hall Trilogy #1").
2. If the book is a standalone work, set "isPartOfSeries: false" and omit "series".
3. Preserve the exact input "id" for each book.`;

  const res = await batchGeminiOperation<
    Array<{id: string; isPartOfSeries?: boolean; series?: string}>
  >(
    books,
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
