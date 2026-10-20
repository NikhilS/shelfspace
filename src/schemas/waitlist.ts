import {z} from 'zod';
import {safeEmailSchema, safeUrlSchema} from './common';

export const waitlistStatusSchema = z.enum([
  'not_requested',
  'pending',
  'approved',
  'rejected',
]);

export const waitlistEntrySchema = z.object({
  email: safeEmailSchema,
  displayName: z.string().trim().max(120).optional(),
  photoURL: safeUrlSchema.nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedAt: z.string().max(100),
  reviewedAt: z.string().max(100).nullable().optional(),
  reviewedBy: safeEmailSchema.nullable().optional(),
  invitedBy: z.string().max(254).nullable().optional(),
  invitedLibraryName: z.string().max(200).nullable().optional(),
});

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
});

export type WaitlistStatus = z.infer<typeof waitlistStatusSchema>;
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
