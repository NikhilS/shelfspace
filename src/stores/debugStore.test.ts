import {describe, it, expect, beforeEach} from 'vitest';
import {useDebugStore} from './debugStore';

describe('useDebugStore Zustand store unit suite', () => {
  beforeEach(() => {
    useDebugStore.setState({
      isDebugMode: false,
      profilingLevel: 'normal',
      logs: [],
      debugData: null,
      debugTitle: 'Debug Data',
    });
  });

  it('toggles debug mode, updates profiling level, sets debug data, and clears logs', () => {
    expect(useDebugStore.getState().isDebugMode).toBe(false);

    useDebugStore.getState().toggleDebugMode();
    expect(useDebugStore.getState().isDebugMode).toBe(true);

    useDebugStore.getState().setProfilingLevel('verbose');
    expect(useDebugStore.getState().profilingLevel).toBe('verbose');

    useDebugStore.getState().setDebugData({count: 5}, 'Custom Inspector');
    expect(useDebugStore.getState().debugData).toEqual({count: 5});
    expect(useDebugStore.getState().debugTitle).toBe('Custom Inspector');

    useDebugStore.getState().addLog('Test log message', 'info', {ok: true});
    useDebugStore.getState().clearLogs();
    expect(useDebugStore.getState().logs).toEqual([]);
  });
});
