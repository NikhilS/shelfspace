import {z} from 'zod';
import {router} from '../trpc';
import {
  publicProcedure,
  authenticatedProcedure,
  adminProcedure,
} from '../../auth/procedures';
import {AllowlistService} from '../../auth/allowlistService';
import {WaitlistService} from '../../auth/waitlistService';
import {
  joinWaitlistInputSchema,
  listWaitlistInputSchema,
  reviewWaitlistInputSchema,
} from '../../../schemas/waitlist';

export const authRouter = router({
  getPermissions: publicProcedure.query(async ({ctx}) => {
    return {
      isAppAllowed: ctx.isAppAllowed,
      isAdmin: ctx.isAdmin,
      user: ctx.user,
    };
  }),

  listAllowlist: adminProcedure.query(async () => {
    const users = await AllowlistService.listUsers();
    return {users};
  }),

  addAllowlistUser: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.string().optional().default('user'),
      }),
    )
    .mutation(async ({input}) => {
      await AllowlistService.addUser(input.email, input.role);
      return {success: true};
    }),

  removeAllowlistUser: adminProcedure
    .input(z.object({email: z.string().email()}))
    .mutation(async ({input}) => {
      await AllowlistService.removeUser(input.email);
      return {success: true};
    }),

  getWaitlistStatus: authenticatedProcedure.query(async ({ctx}) => {
    return WaitlistService.getStatus(ctx.user.email);
  }),

  joinWaitlist: authenticatedProcedure
    .input(joinWaitlistInputSchema)
    .mutation(async ({ctx, input}) => {
      const entry = await WaitlistService.join({
        email: ctx.user.email,
        displayName: input?.displayName || ctx.user.displayName,
        photoURL:
          input?.photoURL !== undefined ? input.photoURL : ctx.user.photoURL,
      });
      return {success: true, entry};
    }),

  listWaitlist: adminProcedure
    .input(listWaitlistInputSchema)
    .query(async ({input}) => {
      const entries = await WaitlistService.list(input?.status);
      return {entries};
    }),

  reviewWaitlistEntry: adminProcedure
    .input(reviewWaitlistInputSchema)
    .mutation(async ({ctx, input}) => {
      return WaitlistService.review({
        email: input.email,
        action: input.action,
        adminEmail: ctx.user.email,
      });
    }),
});
