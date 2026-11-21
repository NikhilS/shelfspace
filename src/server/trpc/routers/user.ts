import {z} from 'zod';
import {router, protectedProcedure} from '../trpc';
import {UserService} from '../../services/userService';
import {
  safeIdSchema,
  safeEmailSchema,
  safeUrlSchema,
} from '../../../schemas/common';

export const userRouter = router({
  syncProfile: protectedProcedure
    .input(
      z
        .object({
          uid: safeIdSchema.optional(),
          email: safeEmailSchema.optional(),
          displayName: z.string().trim().max(120).optional(),
          photoURL: safeUrlSchema.optional(),
        })
        .strict()
        .optional(),
    )
    .mutation(async ({ctx, input}) => {
      return await UserService.syncProfile({
        uid: ctx.user.uid,
        email: ctx.user.email,
        displayName: input?.displayName || ctx.user.displayName,
        photoURL: input?.photoURL || ctx.user.photoURL,
      });
    }),
});
