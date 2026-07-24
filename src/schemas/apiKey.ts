import {z} from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'API key name is required').max(100),
});

export const revokeApiKeySchema = z.object({
  keyId: z.string().min(1, 'API key ID is required'),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;
