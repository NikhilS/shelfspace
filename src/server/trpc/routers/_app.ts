import {router} from '../trpc';
import {geminiRouter} from './gemini';
import {metadataRouter} from './metadata';
import {apiKeyRouter} from './apiKey';
import {authRouter} from './auth';
import {userRouter} from './user';
import {
  libraryApiRouter,
  bookApiRouter,
  enrichmentApiRouter,
} from './libraryApi';

export const appRouter = router({
  gemini: geminiRouter,
  metadata: metadataRouter,
  apiKey: apiKeyRouter,
  auth: authRouter,
  user: userRouter,
  library: libraryApiRouter,
  book: bookApiRouter,
  enrichment: enrichmentApiRouter,
});

export type AppRouter = typeof appRouter;
