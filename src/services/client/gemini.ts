import {auth} from '../../firebase';
import {apiClient} from '../../lib/apiClient';

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

export function handleGeminiError(error: unknown): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (isApiKeyError(error)) {
    throw error;
  }
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

async function runClientProxy(
  action: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required for AI actions');
  }

  interface ProxyResult {
    result: unknown;
  }

  const data = await apiClient.post<ProxyResult>(
    '/api/gemini/action',
    {action, payload},
    {signal},
  );

  return data.result;
}

export async function generateClusterNames(
  clusters: {id: number; books: {title: string; author?: string}[]}[],
): Promise<Record<number, string>> {
  return runClientProxy('generateClusterNames', {clusters}) as Promise<
    Record<number, string>
  >;
}

export async function generateBookEmbeddings(
  texts: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<number[][]> {
  const result = (await runClientProxy('generateBookEmbeddings', {
    texts,
  })) as number[][];
  if (onProgress) {
    onProgress(texts.length, texts.length);
  }
  return result;
}

export async function extractBooksFromImage(
  base64Image: string,
  mimeType: string,
): Promise<{title: string; author: string; isbn?: string}[]> {
  return runClientProxy('extractBooksFromImage', {
    base64Image,
    mimeType,
  }) as Promise<{title: string; author: string; isbn?: string}[]>;
}

export async function extractBooksFromCsv(csvText: string): Promise<
  {
    title: string;
    author: string;
    isbn?: string;
    format?: 'physical' | 'digital';
  }[]
> {
  return runClientProxy('extractBooksFromCsv', {csvText}) as Promise<
    {
      title: string;
      author: string;
      isbn?: string;
      format?: 'physical' | 'digital';
    }[]
  >;
}

export async function generateLibraryRecommendations(
  libraryBooks: {title: string; author: string}[],
): Promise<string> {
  return runClientProxy('generateLibraryRecommendations', {
    libraryBooks,
  }) as Promise<string>;
}

export async function generateBookInsights(
  title: string,
  author: string,
  type: 'summary' | 'catchup' | 'similar' | 'author_bio' | 'synopsis',
  signal?: AbortSignal,
): Promise<string> {
  return runClientProxy(
    'generateBookInsights',
    {title, author, type},
    signal,
  ) as Promise<string>;
}

export async function generateLibraryHeroImage(
  libraryName: string,
): Promise<string | null> {
  return runClientProxy('generateLibraryHeroImage', {
    libraryName,
  }) as Promise<string | null>;
}

export async function getPickOfTheDay(
  books: {title: string; author: string}[],
): Promise<{title: string; author: string; reason: string}[] | null> {
  return runClientProxy('getPickOfTheDay', {books}) as Promise<
    {title: string; author: string; reason: string}[] | null
  >;
}

export async function extractBookGeoMetadata(
  title: string,
  author: string,
  synopsis?: string,
): Promise<ExtractedGeoResponse | null> {
  return runClientProxy('extractBookGeoMetadata', {
    title,
    author,
    synopsis,
  }) as Promise<ExtractedGeoResponse | null>;
}

export async function extractBookGeoMetadataBatch(
  books: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<BatchExtractedGeoResponse | null> {
  return runClientProxy('extractBookGeoMetadataBatch', {
    books,
  }) as Promise<BatchExtractedGeoResponse | null>;
}

export async function extractBookTemporalMetadataBatch(
  books: {id: string; title: string; author: string; synopsis?: string}[],
): Promise<BatchTemporalResponse | null> {
  return runClientProxy('extractBookTemporalMetadataBatch', {
    books,
  }) as Promise<BatchTemporalResponse | null>;
}
