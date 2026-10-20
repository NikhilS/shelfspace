import {generateContentWithLimiter, isApiKeyError} from './client';

export async function generateLibraryHeroImage(
  libraryName: string,
): Promise<string | null> {
  try {
    const response = await generateContentWithLimiter({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          {
            text: `Breathtaking cozy watercolor and gouache storybook illustration of an enchanting personal library sanctuary named '${libraryName}'. Sunlit reading nook with arched wooden mullioned windows, warm golden sunbeams streaming across towering shelves overflowing with beautifully bound books, potted houseplants, a comfortable leather armchair, soft atmospheric lighting and floating dust motes. Peaceful Studio Ghibli inspired aesthetic. Masterpiece digital art, vibrant warm palette. Strictly no text, no letters, no words, no alphabet characters anywhere in the artwork.`,
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
