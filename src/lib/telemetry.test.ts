import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  DebugTelemetryEngine,
  instrumentMutation,
  calculatePayloadBytes,
  TelemetryPlugin,
} from './telemetry';
import {PersistenceTelemetryPlugin} from './telemetry/PersistenceTelemetryPlugin';
import {GeminiTelemetryPlugin} from './telemetry/GeminiTelemetryPlugin';
import {RenderPerformancePlugin} from './telemetry/RenderPerformancePlugin';

describe('Phase 4: Telemetry Bus & Pluggable Architecture', () => {
  beforeEach(() => {
    DebugTelemetryEngine.resetInstance();
  });

  it('initializes the telemetry engine singleton', () => {
    const engine1 = DebugTelemetryEngine.getInstance();
    const engine2 = DebugTelemetryEngine.getInstance();
    expect(engine1).toBe(engine2);
  });

  it('allows registering, retrieving, and unregistering plugins', () => {
    const engine = DebugTelemetryEngine.getInstance();
    const testPlugin: TelemetryPlugin = {
      id: 'custom_test',
      name: 'Custom Test',
      renderTab: () => null,
      onMetricUpdate: vi.fn(),
    };

    const unregister = engine.registerPlugin(testPlugin);
    expect(engine.getPlugin('custom_test')).toBe(testPlugin);
    expect(engine.getPlugins().some(p => p.id === 'custom_test')).toBe(true);

    unregister();
    expect(engine.getPlugin('custom_test')).toBeUndefined();
    expect(engine.getPlugins().some(p => p.id === 'custom_test')).toBe(false);
  });

  it('records mutations and updates metrics correctly', () => {
    const engine = DebugTelemetryEngine.getInstance();
    expect(engine.getMetrics().totalFirestoreWrites).toBe(0);

    engine.recordMutation({
      type: 'create',
      path: 'libraries/test-lib',
      durationMs: 42,
      bytes: 128,
      payload: {name: 'Test Lib'},
    });

    const metrics = engine.getMetrics();
    expect(metrics.totalFirestoreWrites).toBe(1);
    expect(metrics.totalBytesWritten).toBe(128);
    expect(metrics.lastWritePayloadBytes).toBe(128);

    const logs = engine.getLogs();
    const writeLog = logs.find(l => l.type === 'db_write');
    expect(writeLog).toBeDefined();
    expect(writeLog?.message).toContain('create on libraries/test-lib');
  });

  it('notifies registered plugins when metrics update', () => {
    const engine = DebugTelemetryEngine.getInstance();
    const onMetricUpdate = vi.fn();
    engine.registerPlugin({
      id: 'listener_test',
      name: 'Listener Test',
      renderTab: () => null,
      onMetricUpdate,
    });

    engine.recordMutation({
      type: 'update',
      path: 'libraries/test-lib/books/1',
      durationMs: 15,
      bytes: 64,
    });

    expect(onMetricUpdate).toHaveBeenCalled();
    expect(onMetricUpdate.mock.calls[0][0].totalFirestoreWrites).toBe(1);
  });

  it('instruments mutation functions with timing and telemetry tracking', async () => {
    const engine = DebugTelemetryEngine.getInstance();
    const mockAction = vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
      return {success: true};
    });

    const result = await instrumentMutation(
      'update',
      'libraries/lib-123/books/book-456',
      {title: 'New Title'},
      mockAction,
    );

    expect(result).toEqual({success: true});
    expect(mockAction).toHaveBeenCalledTimes(1);

    const metrics = engine.getMetrics();
    expect(metrics.totalFirestoreWrites).toBe(1);
    const writeLogs = engine.getLogs().filter(l => l.type === 'db_write');
    expect(writeLogs).toHaveLength(1);
    expect(writeLogs[0].message).toContain(
      'update on libraries/lib-123/books/book-456',
    );
  });

  it('instruments failing mutations and logs errors to telemetry', async () => {
    const engine = DebugTelemetryEngine.getInstance();
    const mockFailingAction = vi
      .fn()
      .mockRejectedValue(new Error('Permission denied'));

    await expect(
      instrumentMutation(
        'delete',
        'libraries/lib-123/books/secret',
        {id: 'secret'},
        mockFailingAction,
      ),
    ).rejects.toThrow('Permission denied');

    const logs = engine.getLogs();
    const errorLog = logs.find(l => l.type === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog?.message).toContain(
      'delete on libraries/lib-123/books/secret',
    );
  });

  it('calculates payload bytes accurately without crashing on cyclic objects', () => {
    const obj: Record<string, unknown> = {name: 'book', count: 42};
    const bytes = calculatePayloadBytes(obj);
    expect(bytes).toBeGreaterThan(0);

    // Cyclic object test
    const cyclicObj: Record<string, unknown> = {title: 'Cycle'};
    cyclicObj.self = cyclicObj;
    expect(() => calculatePayloadBytes(cyclicObj)).not.toThrow();
  });

  it('supports registering the core plugins (Persistence, Gemini, RenderPerformance)', () => {
    const engine = DebugTelemetryEngine.getInstance();
    const persistencePlugin = new PersistenceTelemetryPlugin();
    const geminiPlugin = new GeminiTelemetryPlugin();
    const renderPerfPlugin = new RenderPerformancePlugin();

    engine.registerPlugin(persistencePlugin);
    engine.registerPlugin(geminiPlugin);
    engine.registerPlugin(renderPerfPlugin);

    expect(engine.getPlugin('persistence')).toBeDefined();
    expect(engine.getPlugin('gemini')).toBeDefined();
    expect(engine.getPlugin('render_perf')).toBeDefined();
  });
});
