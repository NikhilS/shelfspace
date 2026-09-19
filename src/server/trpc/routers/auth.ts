import {z} from 'zod';
import {router} from '../trpc';
import {publicProcedure, adminProcedure} from '../../auth/procedures';
import {AllowlistService} from '../../auth/allowlistService';

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
});
