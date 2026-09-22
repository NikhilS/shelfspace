import {z} from 'zod';

export const waitlistStatusSchema = z.enum([
  'not_requested',
  'pending',
  'approved',
  'rejected',
]);

export const waitlistEntrySchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  photoURL: z.string().nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  reviewedBy: z.string().email().nullable().optional(),
});

export const joinWaitlistInputSchema = z
  .object({
    displayName: z.string().optional(),
    photoURL: z.string().nullable().optional(),
  })
  .optional();

export const listWaitlistInputSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  })
  .optional();

export const reviewWaitlistInputSchema = z.object({
  email: z.string().email(),
  action: z.enum(['approve', 'reject']),
});

export type WaitlistStatus = z.infer<typeof waitlistStatusSchema>;
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
export type JoinWaitlistInput = z.infer<typeof joinWaitlistInputSchema>;
export type ListWaitlistInput = z.infer<typeof listWaitlistInputSchema>;
export type ReviewWaitlistInput = z.infer<typeof reviewWaitlistInputSchema>;
