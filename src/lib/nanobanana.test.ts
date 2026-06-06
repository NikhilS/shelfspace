import {describe, it, expect, vi} from 'vitest';
import {applyNanobananaFlash} from './nanobanana';

describe('applyNanobananaFlash', () => {
  it('handles empty image input gracefully', async () => {
    const result = await applyNanobananaFlash('');
    expect(result).toBe('');
  });

  it('runs image through contrast and brightness canvas filters', async () => {
    // Mock the global Image constructor which is normally empty in test runner environments
    const originalImage = global.Image;

    global.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      width = 100;
      height = 100;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 5);
      }
    } as unknown as typeof HTMLImageElement;

    const mockCtx = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillStyle: '',
      fillRect: vi.fn(),
      filter: '',
    };

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockCtx),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mocked'),
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;

    const originalCreateElement = document.createElement;
    document.createElement = vi.fn().mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas;
      return originalCreateElement(tag);
    }) as typeof document.createElement;

    const result = await applyNanobananaFlash('data:image/jpeg;base64,inputs', {
      straighten: true,
      contrast: 1.25,
      brightness: 1.05,
    });

    expect(result).toBe('data:image/jpeg;base64,mocked');
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockCtx.filter).toContain('contrast(1.25)');
    expect(mockCtx.filter).toContain('brightness(1.05)');

    // Restore original globals
    global.Image = originalImage;
    document.createElement = originalCreateElement;
  });
});
