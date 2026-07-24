import {router} from '../trpc';
import {geminiRouter} from './gemini';
import {metadataRouter} from './metadata';
import {apiKeyRouter} from './apiKey';
import {
  libraryApiRouter,
  bookApiRouter,
  enrichmentApiRouter,
} from './libraryApi';

export const appRouter = router({
  gemini: geminiRouter,
  metadata: metadataRouter,
  apiKey: apiKeyRouter,
  library: libraryApiRouter,
  book: bookApiRouter,
  enrichment: enrichmentApiRouter,
});

export type AppRouter = typeof appRouter;
