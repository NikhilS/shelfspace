import {z} from 'zod';

export const BOOK_TAXONOMY = {
  'Literary & Classic Fiction': [
    'Classics (Pre-1945)',
    'Contemporary Fiction',
    'Postmodern & Experimental',
    'Metafiction',
    'Family Saga',
    'Coming of Age (Bildungsroman)',
    'Magical Realism',
    'Short Stories',
  ],
  'Science Fiction': [
    'Hard Sci-Fi',
    'Space Opera',
    'Cyberpunk',
    'Dystopian & Post-Apocalyptic',
    'Time Travel',
    'First Contact & Alien Lore',
    'Solarpunk & Climate Fiction',
  ],
  Fantasy: [
    'Epic & High Fantasy',
    'Urban Fantasy',
    'Dark Fantasy & Grimdark',
    'Mythic & Folklore',
    'Sword & Sorcery',
    'Romantasy',
    'Fairy Tale Retellings',
  ],
  'Mystery & Crime': [
    'Cozy Mystery',
    'Police Procedural',
    'Hardboiled & Noir',
    'Whodunit & Detective',
    'Historical Mystery',
    'Legal Thriller',
  ],
  'Thriller & Suspense': [
    'Psychological Thriller',
    'Domestic Suspense',
    'Espionage & Spy Fiction',
    'Political & Legal Thriller',
    'Techno-Thriller',
    'Action & Adventure',
  ],
  'Horror & Supernatural': [
    'Gothic Horror',
    'Psychological Horror',
    'Haunted & Ghost Stories',
    'Cosmic Horror & Weird Fiction',
    'Occult & Paranormal',
    'Creature Feature & Survival',
  ],
  'Humor & Satire': [
    'Farce & Comic Fiction',
    'Satire & Parody',
    'Comedy of Manners',
    'Dark Comedy',
    'Humorous Essays & Memoirs',
    'British Humor',
  ],
  'Historical Fiction': [
    'Ancient World & Classical',
    'Medieval & Renaissance',
    '18th & 19th Century',
    'Victorian & Edwardian',
    'World War I & II Era',
    'Mid-20th Century',
  ],
  Romance: [
    'Contemporary Romance',
    'Historical Romance',
    'Romantic Comedy',
    'Paranormal & Fantasy Romance',
    'LGBTQ+ Romance',
    'Suspense Romance',
  ],
  'Biography & Memoir': [
    'Autobiography',
    'Personal Memoir',
    'Literary & Artistic Biographies',
    'Historical Figures & Royalty',
    'Political Leaders & Activists',
    'Science & Adventure Biographies',
  ],
  History: [
    'Ancient Civilizations',
    'Medieval History',
    'Early Modern & Renaissance History',
    'Military History & Battles',
    'Social & Cultural History',
    'World & Global Histories',
  ],
  'Philosophy & Critical Thought': [
    'Ethics & Moral Philosophy',
    'Existentialism & Phenomenology',
    'Political Philosophy',
    'Epistemology & Logic',
    'Eastern & Comparative Philosophy',
    'Ancient & Classical Philosophy',
  ],
  'Travel & Exploration': [
    'Travel Memoir & Journey',
    'European Journeys',
    'Americas & Polar Expeditions',
    'Asian & Middle Eastern Travels',
    'Nature & Wilderness Exploration',
    'Guidebooks & Cultural Landscapes',
  ],
  'Science & Nature': [
    'Physics & Astronomy',
    'Biology & Evolutionary Science',
    'Neuroscience & Cognitive Science',
    'Ecology, Climate & Conservation',
    'Mathematics & Information Theory',
    'History & Philosophy of Science',
  ],
  'Self-Help & Psychology': [
    'Cognitive Psychology & Behavior',
    'Habits, Focus & Productivity',
    'Mental Health & Resilience',
    'Mindfulness & Meditation',
    'Interpersonal Relationships',
  ],
  'Business & Economics': [
    'Entrepreneurship & Startups',
    'Macroeconomics & Financial History',
    'Leadership & Management',
    'Personal Finance & Investing',
    'Technology & Industry Analysis',
  ],
  'Poetry & Drama': [
    'Classical Poetry & Sonnets',
    'Modern & Contemporary Poetry',
    'Plays & Theatrical Drama',
    'Epic Poetry',
    'Screenplays & Monologues',
  ],
  'Young Adult & Children': [
    'YA Fiction & Realism',
    'YA Fantasy & Dystopia',
    'Middle Grade Adventures',
    'Children’s Illustrated / Picture Books',
  ],
  Other: [],
} as const;

export type PrimaryGenreKey = keyof typeof BOOK_TAXONOMY;

export const CANONICAL_PRIMARY_GENRES: PrimaryGenreKey[] = (
  Object.keys(BOOK_TAXONOMY) as PrimaryGenreKey[]
).filter(key => key !== 'Other');

export function getCanonicalPrimaryGenres(): PrimaryGenreKey[] {
  return [...CANONICAL_PRIMARY_GENRES];
}

export function getSubgenresFor(primaryGenre: string): readonly string[] {
  if (primaryGenre in BOOK_TAXONOMY) {
    return BOOK_TAXONOMY[primaryGenre as PrimaryGenreKey];
  }
  return [];
}

export const bookGenreSchema = z
  .object({
    primaryGenre: z.string().min(1, 'Primary genre is required'),
    subgenres: z
      .array(z.string())
      .max(3, 'At most 3 subgenres allowed')
      .optional()
      .default([]),
    isCustomPrimary: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.isCustomPrimary || data.primaryGenre === 'Other') {
      return;
    }

    const validSubgenres = BOOK_TAXONOMY[data.primaryGenre as PrimaryGenreKey];
    if (!validSubgenres) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${data.primaryGenre}" is not a recognized canonical genre.`,
        path: ['primaryGenre'],
      });
      return;
    }

    data.subgenres?.forEach((subgenre, index) => {
      if (!validSubgenres.includes(subgenre as never)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${subgenre}" is not a valid subgenre for "${data.primaryGenre}". Allowed: ${validSubgenres.join(', ')}`,
          path: ['subgenres', index],
        });
      }
    });
  });

export function sanitizeGenrePayload(input: {
  primaryGenre?: string | null;
  subgenres?: string[] | null;
  isCustomPrimary?: boolean | null;
}): {primaryGenre: string; subgenres: string[]; isCustomPrimary: boolean} {
  if (!input.primaryGenre || !input.primaryGenre.trim()) {
    return {primaryGenre: 'Other', subgenres: [], isCustomPrimary: true};
  }

  const trimmedPrimary = input.primaryGenre.trim();

  if (input.isCustomPrimary || trimmedPrimary === 'Other') {
    const rawSub = (input.subgenres || [])
      .map(s => s?.trim())
      .filter((s): s is string => Boolean(s))
      .slice(0, 3);
    return {
      primaryGenre: trimmedPrimary,
      subgenres: rawSub,
      isCustomPrimary: true,
    };
  }

  if (!(trimmedPrimary in BOOK_TAXONOMY)) {
    return {
      primaryGenre: trimmedPrimary,
      subgenres: [],
      isCustomPrimary: true,
    };
  }

  const canonicalKey = trimmedPrimary as PrimaryGenreKey;
  const validList = BOOK_TAXONOMY[canonicalKey];

  const filteredSubgenres = (input.subgenres || [])
    .map(s => s?.trim())
    .filter((s): s is string => Boolean(s) && validList.includes(s as never))
    .slice(0, 3);

  return {
    primaryGenre: canonicalKey,
    subgenres: filteredSubgenres,
    isCustomPrimary: false,
  };
}

/**
 * Normalizes raw category strings (Google Books categories, BISAC codes, user strings)
 * into a canonical PrimaryGenreKey and optional subgenres.
 */
export function mapLegacyGenreToTaxonomy(rawCategory: string | string[]): {
  primaryGenre: string;
  subgenres: string[];
  isCustomPrimary: boolean;
} {
  const combined = Array.isArray(rawCategory)
    ? rawCategory.filter(Boolean).join(' / ')
    : rawCategory;

  if (!combined || typeof combined !== 'string' || !combined.trim()) {
    return {primaryGenre: 'Other', subgenres: [], isCustomPrimary: true};
  }

  const normalized = combined.toLowerCase();

  // Science Fiction
  if (
    normalized.includes('science fiction') ||
    normalized.includes('sci-fi') ||
    normalized.includes('space opera') ||
    normalized.includes('cyberpunk') ||
    normalized.includes('dystopian')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('space opera')) subgenres.push('Space Opera');
    if (normalized.includes('cyberpunk')) subgenres.push('Cyberpunk');
    if (normalized.includes('dystopian') || normalized.includes('apocalyptic'))
      subgenres.push('Dystopian & Post-Apocalyptic');
    if (normalized.includes('time travel')) subgenres.push('Time Travel');
    return {
      primaryGenre: 'Science Fiction',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Fantasy
  if (
    normalized.includes('fantasy') ||
    normalized.includes('magic') ||
    normalized.includes('myth')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('epic') || normalized.includes('high fantasy'))
      subgenres.push('Epic & High Fantasy');
    if (normalized.includes('urban fantasy')) subgenres.push('Urban Fantasy');
    if (normalized.includes('folklore') || normalized.includes('myth'))
      subgenres.push('Mythic & Folklore');
    return {
      primaryGenre: 'Fantasy',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Mystery & Crime
  if (
    normalized.includes('mystery') ||
    normalized.includes('detective') ||
    normalized.includes('crime')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('cozy')) subgenres.push('Cozy Mystery');
    if (normalized.includes('police') || normalized.includes('procedural'))
      subgenres.push('Police Procedural');
    if (normalized.includes('hardboiled') || normalized.includes('noir'))
      subgenres.push('Hardboiled & Noir');
    return {
      primaryGenre: 'Mystery & Crime',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Thriller & Suspense
  if (
    normalized.includes('thriller') ||
    normalized.includes('suspense') ||
    normalized.includes('espionage') ||
    normalized.includes('spy')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('psychological'))
      subgenres.push('Psychological Thriller');
    if (normalized.includes('espionage') || normalized.includes('spy'))
      subgenres.push('Espionage & Spy Fiction');
    return {
      primaryGenre: 'Thriller & Suspense',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Horror & Supernatural
  if (
    normalized.includes('horror') ||
    normalized.includes('gothic') ||
    normalized.includes('ghost') ||
    normalized.includes('supernatural')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('gothic')) subgenres.push('Gothic Horror');
    if (normalized.includes('ghost') || normalized.includes('haunted'))
      subgenres.push('Haunted & Ghost Stories');
    return {
      primaryGenre: 'Horror & Supernatural',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Humor & Satire
  if (
    normalized.includes('humor') ||
    normalized.includes('satire') ||
    normalized.includes('comedy') ||
    normalized.includes('comic')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('satire') || normalized.includes('parody'))
      subgenres.push('Satire & Parody');
    if (normalized.includes('farce')) subgenres.push('Farce & Comic Fiction');
    return {
      primaryGenre: 'Humor & Satire',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Historical Fiction
  if (
    normalized.includes('historical fiction') ||
    (normalized.includes('fiction') && normalized.includes('historical'))
  ) {
    return {
      primaryGenre: 'Historical Fiction',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Romance
  if (normalized.includes('romance') || normalized.includes('love story')) {
    const subgenres: string[] = [];
    if (normalized.includes('contemporary'))
      subgenres.push('Contemporary Romance');
    if (normalized.includes('historical')) subgenres.push('Historical Romance');
    if (normalized.includes('comedy')) subgenres.push('Romantic Comedy');
    return {
      primaryGenre: 'Romance',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // Biography & Memoir
  if (
    normalized.includes('biography') ||
    normalized.includes('autobiography') ||
    normalized.includes('memoir')
  ) {
    const subgenres: string[] = [];
    if (normalized.includes('autobiography')) subgenres.push('Autobiography');
    else if (normalized.includes('memoir')) subgenres.push('Personal Memoir');
    return {
      primaryGenre: 'Biography & Memoir',
      subgenres: subgenres.slice(0, 3),
      isCustomPrimary: false,
    };
  }

  // History
  if (normalized.includes('history')) {
    return {
      primaryGenre: 'History',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Philosophy & Critical Thought
  if (normalized.includes('philosophy') || normalized.includes('ethics')) {
    return {
      primaryGenre: 'Philosophy & Critical Thought',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Travel & Exploration
  if (
    normalized.includes('travel') ||
    normalized.includes('exploration') ||
    normalized.includes('voyage')
  ) {
    return {
      primaryGenre: 'Travel & Exploration',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Science & Nature
  if (
    normalized.includes('science') ||
    normalized.includes('physics') ||
    normalized.includes('biology') ||
    normalized.includes('astronomy') ||
    normalized.includes('nature') ||
    normalized.includes('ecology')
  ) {
    return {
      primaryGenre: 'Science & Nature',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Self-Help & Psychology
  if (
    normalized.includes('self-help') ||
    normalized.includes('psychology') ||
    normalized.includes('mindfulness') ||
    normalized.includes('productivity')
  ) {
    return {
      primaryGenre: 'Self-Help & Psychology',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Business & Economics
  if (
    normalized.includes('business') ||
    normalized.includes('economics') ||
    normalized.includes('finance') ||
    normalized.includes('entrepreneurship')
  ) {
    return {
      primaryGenre: 'Business & Economics',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Poetry & Drama
  if (
    normalized.includes('poetry') ||
    normalized.includes('drama') ||
    normalized.includes('plays')
  ) {
    return {
      primaryGenre: 'Poetry & Drama',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Young Adult & Children
  if (
    normalized.includes('young adult') ||
    normalized.includes('ya ') ||
    normalized.includes('juvenile') ||
    normalized.includes('children')
  ) {
    return {
      primaryGenre: 'Young Adult & Children',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Literary & Classic Fiction
  if (
    normalized.includes('classic') ||
    normalized.includes('literary') ||
    normalized.includes('fiction')
  ) {
    return {
      primaryGenre: 'Literary & Classic Fiction',
      subgenres: [],
      isCustomPrimary: false,
    };
  }

  // Default fallback to Other with cleaned string
  return {
    primaryGenre: rawCategory.trim(),
    subgenres: [],
    isCustomPrimary: true,
  };
}
