import {describe, it, expect, beforeEach} from 'vitest';
import {useAppStore} from './appStore';

describe('useAppStore Zustand store unit suite', () => {
  beforeEach(() => {
    useAppStore.setState({theme: 'system'});
  });

  it('initializes with system theme and transitions across light, dark, and system modes', () => {
    expect(useAppStore.getState().theme).toBe('system');

    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');

    useAppStore.getState().setTheme('light');
    expect(useAppStore.getState().theme).toBe('light');
  });
});
