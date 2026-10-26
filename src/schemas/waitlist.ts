import {z} from 'zod';
import {safeEmailSchema, safeUrlSchema} from './common';

export const waitlistStatusSchema = z.enum([
  'not_requested',
  'pending',
  'approved',
  'rejected',
]);

export const allowlistRoleSchema = z.enum(['user', 'admin']);
export type AllowlistRole = z.infer<typeof allowlistRoleSchema>;

/**
 * Stored Firestore document schema for `appSettings/allowlist/users/{email}`.
 */
export const storedAllowlistUserDocSchema = z
  .object({
    email: safeEmailSchema,
    role: allowlistRoleSchema,
    hasAiPlan: z.boolean().optional(),
    addedAt: z.string().max(100).optional(),
    addedBy: z.string().max(254).optional(),
    updatedAt: z.string().max(100).optional(),
    updatedBy: z.string().max(254).optional(),
    source: z.string().max(100).optional(),
  })
  .strict();

export type StoredAllowlistUserDoc = z.infer<
  typeof storedAllowlistUserDocSchema
>;

export const waitlistEntrySchema = z
  .object({
    email: safeEmailSchema,
    displayName: z.string().trim().max(120).optional(),
    photoURL: safeUrlSchema.nullable().optional(),
    status: z.enum(['pending', 'approved', 'rejected']),
    requestedAt: z.string().max(100),
    reviewedAt: z.string().max(100).nullable().optional(),
    reviewedBy: safeEmailSchema.nullable().optional(),
    invitedBy: z.string().max(254).nullable().optional(),
    invitedLibraryName: z.string().max(200).nullable().optional(),
  })
  .strict();

/**
 * Stored Firestore document schema for `appSettings/waitlist/entries/{email}`.
 */
export const storedWaitlistEntryDocSchema = waitlistEntrySchema;
export type StoredWaitlistEntryDoc = z.infer<
  typeof storedWaitlistEntryDocSchema
>;

export const joinWaitlistInputSchema = z
  .object({
    displayName: z.string().trim().max(120).optional(),
    photoURL: safeUrlSchema.nullable().optional(),
  })
  .optional();

export const listWaitlistInputSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  })
  .optional();

export const reviewWaitlistInputSchema = z.object({
  email: safeEmailSchema,
  action: z.enum(['approve', 'reject']),
  hasAiPlan: z.boolean().optional(),
});

export type WaitlistStatus = z.infer<typeof waitlistStatusSchema>;
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
