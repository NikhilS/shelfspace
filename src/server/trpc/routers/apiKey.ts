import {router, protectedProcedure} from '../trpc';
import {createApiKeySchema, revokeApiKeySchema} from '../../../schemas/apiKey';
import {ApiKeyService} from '../../../services/server/apiKeyService';

export const apiKeyRouter = router({
  list: protectedProcedure.query(async ({ctx}) => {
    return ApiKeyService.listApiKeys(ctx.user.uid);
  }),

  create: protectedProcedure
    .input(createApiKeySchema)
    .mutation(async ({input, ctx}) => {
      return ApiKeyService.generateApiKey(
        ctx.user.uid,
        ctx.user.email,
        input.name,
      );
    }),

  revoke: protectedProcedure
    .input(revokeApiKeySchema)
    .mutation(async ({input, ctx}) => {
      return ApiKeyService.revokeApiKey(ctx.user.uid, input.keyId);
    }),
});
