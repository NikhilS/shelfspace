# tRPC Migration Design Document

## 1. Overview
The current architecture relies on a custom `apiClient.ts` to communicate with our Express backend. This requires manual type definition synchronization or duplicated type interfaces between the frontend and the backend. It forces us to manually cast the response payloads and maintain API route strings separately.

Migrating to [tRPC](https://trpc.io/) will allow the frontend to seamlessly import the backend's API router types. It provides immediate compile-time errors if a payload or response shape changes, entirely eliminating a class of runtime bugs without requiring code generation (like GraphQL or OpenAPI). 

## 2. Goals
- **End-to-End Type Safety:** Ensure all client-side network calls are naturally strongly typed by the backend's TRPC router.
- **Maintainability:** Eliminate the cognitive load of coordinating types in separate locations.
- **Developer Experience:** Provide excellent autocomplete directly in the IDE for API methods and payloads without intermediate code-generation steps.
- **Safety:** Execute the migration incrementally without breaking the existing REST API.

## 3. Recommended Tech Stack
- `@trpc/server`: For backend TRPC routing and Express adapter.
- `@trpc/client`: Custom client setup.
- `@trpc/react-query`: To integrate smoothly with our current TanStack Query architecture.
- `zod`: For robust runtime payload validation on request inputs.

## 4. Implementation Strategy

### Step 1: Install Dependencies
```bash
npm install @trpc/server @trpc/client @trpc/react-query zod
```

### Step 2: Set up the tRPC Backend
1. **Initialize tRPC (`src/server/trpc/trpc.ts`):** 
```ts
import { initTRPC, TRPCError } from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
import { getAuth } from 'firebase-admin/auth';
import type { Request, Response } from 'express';

// Context definition passing req/res and user info
export const createContext = async ({ req, res }: trpcExpress.CreateExpressContextOptions) => {
  const authHeader = req.headers.authorization;
  let user = null;
  
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      user = await getAuth().verifyIdToken(token);
    } catch {
      // invalid token
    }
  }

  return { req, res, user };
};

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { user: ctx.user } });
});
```

2. **Define AppRouter (`src/server/trpc/routers/_app.ts`):**
Map our existing backend logic into a main tRPC router structure.
```ts
import { router } from '../trpc';
import { libraryRouter } from './library';
import { metadataRouter } from './metadata';
import { geminiRouter } from './gemini';

export const appRouter = router({
  library: libraryRouter,
  metadata: metadataRouter,
  gemini: geminiRouter
});

export type AppRouter = typeof appRouter;
```

3. **Wire it to Express (`server.ts`):**
Mount the tRPC handler to the `/trpc` endpoint, running alongside our existing `/api` REST endpoints to allow a gradual migration.

```ts
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter } from './src/server/trpc/routers/_app';
import { createContext } from './src/server/trpc/trpc';

// Inside startServer()
app.use('/trpc', trpcExpress.createExpressMiddleware({
  router: appRouter,
  createContext,
}));
```

### Step 3: Set up the React Frontend
1. **Configure tRPC hooks (`src/lib/trpc.ts`):**
```ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../server/trpc/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
```

2. **Setup Provider (`src/App.tsx`):**
Integrate `trpc.Provider` wrapping the `QueryClientProvider` and set up the tRPC HTTP batch link, passing Firebase Auth tokens in headers via our custom async auth context or similar headers function.

```tsx
import { httpBatchLink } from '@trpc/client';
import { auth } from './firebase';

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      async headers() {
        const token = await auth.currentUser?.getIdToken();
        return {
          Authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});
```

### Step 4: Incremental Migration Plan (Safe Handover)
Instead of a high-risk "big bang" rewrite, we'll perform a phased rollout module by module:

1. **Parallel Support:** For a given feature (e.g., `gemini.ts`), write the equivalent tRPC router endpoint while keeping the original REST `/api` endpoint active.
2. **Hook Replacement:** Migrate one specific hook to use `trpc.useQuery` or `trpc.useMutation` instead of `useMutation` + `apiClient`.
3. **Zod Validation:** Rewrite request payload validations to use `zod` in the backend tRPC router.
4. **Cleanup:** After porting a feature successfully to the client, delete the old `/api` Express endpoint and remove the duplicate `apiClient` fetch call.

## 5. Potential Risks & Mitigation
- **Server Bundle Size:** Ensure that the tRPC server-side types don't mistakenly export internal server libraries via their types. Types should be primitive or basic Zod-inferred types to avoid leaking server code to the client bundler.
- **Vite Setup:** In our current `vite.config.ts` or during `npm run build`, we must ensure that the `trpc` imports of backend types don't cause Vite to try to bundle `server.ts` imports if they're not structurally isolated. Keeping the router definitions in `src/server/trpc/` alongside front-end safe type exports solves this.

## 6. Conclusion
Transitioning to tRPC aligns exceptionally well with our TypeScript-heavy architecture and completely removes the fragility of `apiClient.ts` manual casting. Adopting it module by module via `/trpc` safely isolates risk while immediately conferring end-to-end type safety benefits.
