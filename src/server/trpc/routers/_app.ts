import {router} from '../trpc';
import {geminiRouter} from './gemini';
import {metadataRouter} from './metadata';
import {authRouter} from './auth';
import {userRouter} from './user';
import {libraryApiRouter} from './libraryApi';
import {bookApiRouter} from './bookApi';
import {enrichmentApiRouter} from './enrichmentApi';
import {readingTrackerRouter} from './readingTracker';

export const appRouter = router({
  gemini: geminiRouter,
  metadata: metadataRouter,
  auth: authRouter,
  user: userRouter,
  library: libraryApiRouter,
  book: bookApiRouter,
  enrichment: enrichmentApiRouter,
  readingTracker: readingTrackerRouter,
});

export type AppRouter = typeof appRouter;
