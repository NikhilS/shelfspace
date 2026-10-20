import {describe, it, expect, vi, beforeEach} from 'vitest';
import {uploadBase64Image} from './storage';
import {trpcVanilla} from './trpc';
import {toast} from 'sonner';

vi.mock('./trpc', () => ({
  trpcVanilla: {
    library: {
      uploadImage: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('uploadBase64Image client storage gateway helper suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through empty strings or non-data URLs untouched without calling tRPC', async () => {
    expect(await uploadBase64Image('', 'libraries/lib-1/hero.png')).toBe('');
    expect(
      await uploadBase64Image(
        'https://images.example.com/cover.jpg',
        'libraries/lib-1/cover.jpg',
      ),
    ).toBe('https://images.example.com/cover.jpg');
    expect(trpcVanilla.library.uploadImage.mutate).not.toHaveBeenCalled();
  });

  it('rejects storage paths missing the libraries/{libraryId}/ prefix', async () => {
    await expect(
      uploadBase64Image('data:image/png;base64,iVBOR', 'invalid/path/img.png'),
    ).rejects.toThrow(/missing libraryId prefix/);
  });

  it('extracts libraryId, delegates to trpcVanilla.library.uploadImage, and triggers toast on retry-limit-exceeded', async () => {
    vi.mocked(trpcVanilla.library.uploadImage.mutate).mockResolvedValueOnce({
      url: 'https://storage.googleapis.com/bucket/libraries/lib-42/hero.png',
    });

    const url = await uploadBase64Image(
      'data:image/png;base64,iVBOR',
      'libraries/lib-42/hero.png',
    );
    expect(url).toBe(
      'https://storage.googleapis.com/bucket/libraries/lib-42/hero.png',
    );
    expect(trpcVanilla.library.uploadImage.mutate).toHaveBeenCalledWith({
      libraryId: 'lib-42',
      path: 'libraries/lib-42/hero.png',
      base64Data: 'data:image/png;base64,iVBOR',
    });

    // retry-limit-exceeded error displays setup toast before rethrowing
    vi.mocked(trpcVanilla.library.uploadImage.mutate).mockRejectedValueOnce(
      new Error('Firebase Storage: retry-limit-exceeded'),
    );
    await expect(
      uploadBase64Image(
        'data:image/png;base64,iVBOR',
        'libraries/lib-42/hero.png',
      ),
    ).rejects.toThrow(/retry-limit-exceeded/);
    expect(toast.error).toHaveBeenCalledWith(
      'Storage Upload Failed',
      expect.objectContaining({duration: 8000}),
    );
  });
});
