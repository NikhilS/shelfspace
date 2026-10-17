import {Type} from '@google/genai';
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

Based on this reader's interests, recurring genres, narrative styles, pacing, and philosophical themes, recommend 5 captivating new books to expand their horizons.

CRITICAL DIRECTIVES:
1. STRICTLY DO NOT recommend any book that is already listed in the reader's library above.
2. Recommend exceptional, distinctive titles (a thoughtful blend of acclaimed literary works, modern masterworks, and hidden gems).
3. For each book, use this clear markdown format:
   ## [Book Title] by [Author]
   **Why It Fits Your Library**: 2-3 sentences explaining the exact thematic, stylistic, or intellectual resonance with specific books in their collection.
   **Key Themes**: 3-4 comma-separated tags (e.g., *Speculative Fiction, Found Family, Moral Ambiguity*).`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an erudite, insightful literary curator and librarian who recommends books with nuance, depth, and precision.',
        temperature: 0.6,
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
Conclude with what kind of reader would find this work most rewarding. Keep it to 2-3 engaging, well-crafted paragraphs. Format with clean markdown (use ## for subheadings if appropriate).`;
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
Detail all major twists, deaths, alliances, and the exact ending. Use concise markdown with bullet points for readability.`;
      break;
    case 'similar':
      prompt = `Recommend 3 to 5 books with strong thematic, stylistic, or emotional kinship to "${title}" by ${author}.
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
            'You are an insightful literary scholar, critic, and expert librarian who provides rich, accurate, and compelling book analyses.',
          temperature: type === 'catchup' ? 0.3 : 0.5,
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

Based on the underlying themes, literary voices, and conceptual styles across these titles, recommend 10 non-obvious, deeply rewarding books that this reader would love.
Think like an expert library curator discovering unexpected gems and profound thematic bridges.

CRITICAL RULES:
1. The recommended books MUST NOT be in the reader's current list above.
2. Provide exactly 10 distinct recommendations.
3. For each book, explain in 1-2 insightful sentences WHY it is a superb recommendation, highlighting the surprising or complementary connection to their taste.`;

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
            'You are a distinguished literary curator and reader advisory expert who recommends surprising, high-resonance literature.',
          responseMimeType: 'application/json',
          responseSchema: pickOfTheDaySchema,
          temperature: 0.7,
        },
      });
    } catch (e: unknown) {
      if (isApiKeyError(e)) {
        throw e;
      }
      console.warn('Fallback to Gemini 3.1 Pro for pick of the day:', e);
      try {
        response = await generateContentWithLimiter({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            systemInstruction:
              'You are a distinguished literary curator and reader advisory expert who recommends surprising, high-resonance literature.',
            responseMimeType: 'application/json',
            responseSchema: pickOfTheDaySchema,
            temperature: 0.7,
          },
        });
      } catch (err: unknown) {
        if (isApiKeyError(err)) {
          throw err;
        }
        console.warn('Fallback retry with Gemini 3.8 Flash model:', err);
        response = await generateContentWithLimiter({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: pickOfTheDaySchema,
          },
        });
      }
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
): Promise<ClassifiedBookGenre[]> {
  try {
    if (!batch || batch.length === 0) return [];
    const booksPromptData = batch.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      context: b.synopsis ? b.synopsis.substring(0, 300) : '',
    }));

    const canonicalTaxonomySummary = Object.entries(BOOK_TAXONOMY)
      .filter(([k]) => k !== 'Other')
      .map(
        ([genre, subs]) =>
          `- "${genre}": [${subs.map(s => `"${s}"`).join(', ')}]`,
      )
      .join('\n');

    const prompt = `Classify the following batch of ${batch.length} books into the application's standardized taxonomy.

Canonical Primary Genres & Their Available Subgenres:
${canonicalTaxonomySummary}
- "Other": Use only if the book completely defies the 18 canonical genres.

Directives:
1. "primaryGenre" (REQUIRED): Select the single best-fitting canonical Primary Genre.
2. "subgenres" (OPTIONAL): Choose 0 to 3 relevant subgenres strictly from the selected Primary Genre's allowed list. Subgenres are optional—only include ones that clearly match.
3. Preserve the exact provided unique book "id".

Books to classify:
${JSON.stringify(booksPromptData, null, 2)}`;

    const response = await generateContentWithLimiter({
      model: 'gemini-3.8-flash',
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
                description: 'The chosen canonical primary genre or Other',
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
      },
    });

    const text = response.text;
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(
          (item: {id: string; primaryGenre?: string; subgenres?: string[]}) => {
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

export interface ExtractedGeoResponse {
  isNonEarth: boolean;
  locations: ExtractedGeoLocation[];
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
                'Set to true ONLY if the entire work is sci-fi set in space/fictional planets, high fantasy set in completely fictional realms, or is a textbook, academic guide, or abstract literature with no logical earthly setting.',
            },
            locations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description:
                      "Fully-qualified geographical name. Must include specific city, province/state, and country name combined to guarantee precise geocoding (e.g., 'Kyoto, Japan' instead of 'Kyoto', 'Delhi, India' instead of 'Delhi', 'Gettysburg, PA, USA' instead of 'Gettysburg').",
                  },
                  adminLevel: {
                    type: Type.STRING,
                    enum: ['city', 'state', 'country', 'region'],
                    description: 'Granularity type of setting.',
                  },
                  rationale: {
                    type: Type.STRING,
                    description:
                      'A short context sentence (15 words max) describing why this spatial setting is vital to the story.',
                  },
                },
                required: ['name', 'adminLevel', 'rationale'],
              },
              description:
                'At most 5 key geographical regions, cities, states, or countries central to the narrative, plot, setting, or historical backdrop. Return empty list if isNonEarth is true.',
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

  const prompt = `Analyze details of the provided list of books and determine the exact real-world geographical settings on Earth for each book.

Directives:
1. For each book, identify up to 5 critical locations (cities, states/provinces, regions, or countries) where the primary narrative or historical actions occur.
2. Every location "name" must be fully-qualified and globally unambiguous (e.g., "Kyoto, Japan", "Oxford, Oxfordshire, United Kingdom", "Concord, MA, USA").
3. Set "adminLevel" to "city", "state", "country", or "region".
4. For each location, provide a concise rationale (15 words max) explaining its narrative or historical significance.
5. If a book is set entirely in a fictional realm (e.g., Middle-earth, Westeros, Narnia), outer space / sci-fi alien worlds, or is an abstract academic/mathematical work without an earthly setting, set "isNonEarth" to true and return an empty locations array.
6. Map each parsed book specifically to the exact "id" provided in the input.`;

  return batchGeminiOperation<BatchExtractedGeoResponse>(
    books,
    prompt,
    batchSchema,
    'You are an authoritative literary geographer with deep knowledge of world literature, non-fiction contexts, and global historical geography.',
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
                'Set to true if the book is sci-fi/fantasy with entirely fictional settings, abstract technical/mathematical manuals, modern theoretical guidelines with no real-world earth timeline.',
            },
            startYear: {
              type: Type.INTEGER,
              description:
                'Approximate start year of the events or plot. Use negative values for BC/BCE (e.g. -44). Leave blank or omit if isNonHistorical is true.',
            },
            endYear: {
              type: Type.INTEGER,
              description:
                'Approximate end year of the events. Gap between start and end year must not exceed 100 years. Leave blank or omit if isNonHistorical is true.',
            },
            eraName: {
              type: Type.STRING,
              description:
                'Cohesive name label for this historical era (e.g., "Middle Ages", "Renaissance", "World War II", "Victorian Era", "Late Roman Republic"). 2-5 words max. Leave blank or omit if isNonHistorical is true.',
            },
            rationale: {
              type: Type.STRING,
              description:
                'Max 15 words explaining why this temporal context is critical to the story. Leave blank or omit if isNonHistorical is true.',
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
1. Identify if the book possesses a real-world Earth timeline or historical backdrop.
2. If the book is set in an entirely fictional realm (fantasy), far-future or deep-space setting (sci-fi), or is an abstract technical manual with no real-world time setting, mark "isNonHistorical: true" and omit startYear, endYear, eraName, and rationale.
3. For books with real Earth timelines:
   - "startYear": Integer representing the approximate starting year of the core events (use negative values for BCE/BC, e.g. -44).
   - "endYear": Integer representing the approximate ending year. The span between startYear and endYear must NOT exceed 100 years. For sweeping histories, isolate the definitive period.
   - "eraName": Concise historical era name (e.g., "Late Antiquity", "Italian Renaissance", "Victorian Era", "Cold War Era", "Jazz Age").
   - "rationale": Concise explanation (15 words max) of the temporal context.
4. Years MUST be between -10000 and 2100.
5. Map each book specifically to its unique input "id".`;

  const result = await batchGeminiOperation<BatchTemporalResponse>(
    books,
    prompt,
    batchSchema,
    'You are an academic bibliophile historian with encyclopedic knowledge of world history, literary chronology, and historical eras.',
  );

  if (result?.enrichment) {
    result.enrichment.forEach(item => {
      if (
        !item.isNonHistorical &&
        item.startYear !== undefined &&
        item.endYear === undefined
      ) {
        item.endYear = item.startYear;
      }
    });
  }

  return result;
}
