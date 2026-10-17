import {z} from 'zod';
import {router, protectedProcedure} from '../trpc';
import {UserService} from '../../services/userService';

export const userRouter = router({
  syncProfile: protectedProcedure
    .input(
      z
        .object({
          uid: z.string().optional(),
          email: z.string().optional(),
          displayName: z.string().optional(),
          photoURL: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ctx, input}) => {
      return await UserService.syncProfile({
        uid: ctx.user.uid,
        email: input?.email || ctx.user.email,
        displayName: input?.displayName || ctx.user.displayName,
        photoURL: input?.photoURL || ctx.user.photoURL,
      });
    }),

  getProfile: protectedProcedure
    .input(z.object({uid: z.string().min(1)}).optional())
    .query(async ({ctx, input}) => {
      const targetUid = input?.uid || ctx.user.uid;
      return await UserService.getProfile(targetUid);
    }),
});
