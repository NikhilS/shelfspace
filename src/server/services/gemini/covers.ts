import {generateContentWithLimiter, isApiKeyError} from './client';

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
