import {router} from '../trpc';
import {geminiRouter} from './gemini';
import {metadataRouter} from './metadata';

export const appRouter = router({
  gemini: geminiRouter,
  metadata: metadataRouter,
});

export type AppRouter = typeof appRouter;
