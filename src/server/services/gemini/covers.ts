import {Decisions} from '@google/genai';
import type {DecisionNoulAnswer} from '../../../schemas/decisions';
import type {SchedulePriority} from '../scheduler/providerQuotaScheduler';
import {
  decideWithLimiter,
  geminiDecisionProvider,
  generateContentWithLimiter,
  isApiKeyError,
} from './client';

export interface VerifyCoverImageInput {
  imageBase64: string;
  mimeType: string;
  title: string;
  author?: string;
}

export interface VerifyCoverImageDecisionResult {
  isValidCover: boolean;
  authenticProbability: number;
  matchProbability: number;
}

/**
 * Evaluates a downloaded book cover image with `gemini-decision-1` multimodal `noul` questions
 * to catch disguised "Image Not Available" graphics, blank publisher stock frames,
 * or covers belonging to a completely unrelated book.
 */
export async function verifyCoverImageWithDecisions(
  input: VerifyCoverImageInput,
  options?: {
    priority?: SchedulePriority;
    signal?: AbortSignal;
  },
): Promise<VerifyCoverImageDecisionResult> {
  const rawBase64 = input.imageBase64.includes(',')
    ? input.imageBase64.split(',')[1] || ''
    : input.imageBase64;

  if (!rawBase64.trim() || !geminiDecisionProvider.isAvailable()) {
    return {
      isValidCover: true,
      authenticProbability: 1,
      matchProbability: 1,
    };
  }

  const questions: Record<string, Decisions.Question> = {
    is_authentic_cover: {
      type: 'noul',
      instructions:
        'Is this image an authentic book cover or edition jacket (rather than a generic "Image Not Available" placeholder graphic, blank solid-color rectangle, publisher logo stub, or broken icon)?',
      criteria: {
        true_description:
          'Authentic published book cover art, typographic edition cover, or archival binding.',
        false_description:
          'Generic "No Cover Available" / "Image Not Found" placeholder, blank box, or corrupted thumbnail.',
      },
    },
    is_plausible_match: {
      type: 'noul',
      instructions: `Could this plausibly be an edition cover for "${input.title}"${input.author ? ` by ${input.author}` : ''} (including translated, minimalist, or classic cloth-bound editions without text, as opposed to clearly displaying a completely different book's title and author)?`,
      criteria: {
        true_description:
          'Matches the target title/author or is an artistic/textless edition cover with no conflicting title.',
        false_description:
          'Clearly prints a completely different, unrelated book title and unrelated author name.',
      },
    },
  };

  try {
    const answers = await decideWithLimiter(
      {
        input: [
          {
            type: 'image',
            data: rawBase64,
            mime_type: input.mimeType || 'image/jpeg',
          },
          {
            type: 'text',
            text: `Target book record: "${input.title}"${input.author ? ` by ${input.author}` : ''}.`,
          },
        ],
        questions,
        operation: 'gemini.verifyCoverImageWithDecisions',
      },
      {
        priority: options?.priority ?? 'BATCH',
        signal: options?.signal,
      },
    );

    const authAns = answers.is_authentic_cover as
      DecisionNoulAnswer | undefined;
    const matchAns = answers.is_plausible_match as
      DecisionNoulAnswer | undefined;

    const authenticProbability = authAns?.type === 'noul' ? authAns.noul : 1;
    const matchProbability = matchAns?.type === 'noul' ? matchAns.noul : 1;

    const isValidCover =
      authenticProbability >= 0.35 && matchProbability >= 0.25;

    return {
      isValidCover,
      authenticProbability,
      matchProbability,
    };
  } catch (err) {
    if (!isApiKeyError(err)) {
      console.warn('Multimodal cover verification skipped:', err);
    }
    return {
      isValidCover: true,
      authenticProbability: 1,
      matchProbability: 1,
    };
  }
}

export async function generateLibraryHeroImage(
  libraryName: string,
): Promise<string | null> {
  try {
    const cleanMotif =
      libraryName.replace(/["'`]/g, '').trim() || 'Archival Study';
    const response = await generateContentWithLimiter({
      model: 'gemini-nano-banana-2.1',
      contents: {
        parts: [
          {
            text: `Breathtaking cozy watercolor and gouache storybook illustration of an enchanting personal library sanctuary inspired by the thematic mood of "${cleanMotif}". Sunlit reading nook with arched wooden mullioned windows, warm golden sunbeams streaming across towering shelves overflowing with finely bound volumes, subtle architectural and decorative motifs reflecting the collection's theme, potted botanicals, a worn leather armchair, and soft atmospheric dust motes. Peaceful Studio Ghibli and warm archival studio aesthetic. Masterpiece digital art, rich warm palette. CRITICAL: Render purely visual scenery—strictly no text, no signage, no plaques, no letters, no words, and no alphabet characters anywhere in the artwork.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '1K',
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    if (isApiKeyError(error)) {
      console.info(
        'Library hero image generation is pending valid GEMINI_API_KEY configuration.',
      );
      throw error;
    } else {
      console.error('Error generating library hero image:', error);
      return null;
    }
  }
}
