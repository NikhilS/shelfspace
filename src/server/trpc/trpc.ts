import {initTRPC, TRPCError} from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
import admin from 'firebase-admin';

export const createContext = async ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions) => {
  const authHeader = req.headers.authorization;
  let user = null;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      user = await admin.auth().verifyIdToken(token);
    } catch {
      // invalid token
    }
  }

  return {req, res, user};
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ctx, next}) => {
  if (!ctx.user) {
    throw new TRPCError({code: 'UNAUTHORIZED'});
  }
  return next({ctx: {user: ctx.user}});
});
