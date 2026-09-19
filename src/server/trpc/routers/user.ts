import {z} from 'zod';
import {router} from '../trpc';
import {protectedProcedure} from '../../auth/procedures';
import {UserService} from '../../../services/server/userService';

export const userRouter = router({
  syncProfile: protectedProcedure
    .input(
      z.object({
        uid: z.string(),
        email: z.string().optional(),
        displayName: z.string().optional(),
        photoURL: z.string().optional(),
      }),
    )
    .mutation(async ({input}) => {
      return UserService.syncProfile(input);
    }),

  getProfile: protectedProcedure.query(async ({ctx}) => {
    return UserService.getProfile(ctx.user.uid);
  }),
});
