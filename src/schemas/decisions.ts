import {z} from 'zod';
import {hasControlCharacters, validateIncomingApiData} from './common';

export const decisionNoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
});

export type DecisionNoulAnswer = z.infer<typeof decisionNoulAnswerSchema>;

export const decisionChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z
    .string()
    .min(1)
    .refine(val => !hasControlCharacters(val), {
      message: 'Choice option key contains control characters',
    }),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
});

export type DecisionChoiceAnswer = z.infer<typeof decisionChoiceAnswerSchema>;

export const decisionScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number().min(0).max(255),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  legend: z.record(z.string(), z.string()).optional().default({}),
  confidence: z.number().min(0).max(1).optional(),
});

export type DecisionScoreAnswer = z.infer<typeof decisionScoreAnswerSchema>;

export const decisionAnswerSchema = z.discriminatedUnion('type', [
  decisionNoulAnswerSchema,
  decisionChoiceAnswerSchema,
  decisionScoreAnswerSchema,
]);

export type DecisionAnswerPayload = z.infer<typeof decisionAnswerSchema>;

export const createDecisionResponseSchema = z.object({
  answers: z.record(z.string(), decisionAnswerSchema).optional().default({}),
  prompt_feedback: z.unknown().optional(),
  usage: z.unknown().optional(),
});

export type ValidatedCreateDecisionResponse = z.infer<
  typeof createDecisionResponseSchema
>;

export function validateDecisionResponse(
  raw: unknown,
  operation: string,
): ValidatedCreateDecisionResponse {
  return validateIncomingApiData(createDecisionResponseSchema, raw, {
    entity: 'CreateDecisionResponse',
    documentPath: operation,
    operation: 'read',
  });
}
