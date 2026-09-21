import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderHook, act} from '@testing-library/react';
import {usePWAInstall} from '../usePWAInstall';

describe('usePWAInstall hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default non-installable state', () => {
    const {result} = renderHook(() => usePWAInstall());
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('captures beforeinstallprompt event and marks app as installable', () => {
    const {result} = renderHook(() => usePWAInstall());

    const mockEvent = new Event('beforeinstallprompt');
    const preventDefaultSpy = vi.spyOn(mockEvent, 'preventDefault');

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(result.current.isInstallable).toBe(true);
  });

  it('prompts the user on install() and updates state when accepted', async () => {
    const {result} = renderHook(() => usePWAInstall());

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const mockEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt: promptMock,
      userChoice: Promise.resolve({
        outcome: 'accepted' as const,
        platform: 'web',
      }),
    });

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(result.current.isInstallable).toBe(true);

    let installed = false;
    await act(async () => {
      installed = await result.current.install();
    });

    expect(promptMock).toHaveBeenCalled();
    expect(installed).toBe(true);
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('handles appinstalled event', () => {
    const {result} = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
  });
});
