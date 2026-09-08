import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {
  DebugTelemetryEngine,
  interceptConsoleLogs,
  calculatePayloadBytes,
} from '../lib/telemetry';
import {DebugConsoleHUD} from './DebugConsoleHUD';

// Mock Debug Context
vi.mock('../stores/debugStore', () => ({
  useDebug: () => ({
    isDebugMode: true,
    toggleDebugMode: vi.fn(),
    logs: [],
    clearLogs: vi.fn(),
    debugData: null,
    setDebugData: vi.fn(),
    debugTitle: 'Debug Data',
  }),
}));

describe('DebugTelemetryEngine Unit Tests', () => {
  let engine: DebugTelemetryEngine;

  beforeEach(() => {
    engine = DebugTelemetryEngine.getInstance();
    engine.clearLogs();
    engine.resetMetrics();
    engine.clearBaseline();
  });

  it('correctly behaves as a singleton', () => {
    const engine2 = DebugTelemetryEngine.getInstance();
    expect(engine).toBe(engine2);
  });

  it('adds log entries and computes metrics correctly', () => {
    engine.addLog('info', 'Test info log entry', {data: 123});
    const logs = engine.getLogs();

    expect(logs.length).toBe(1);
    expect(logs[0].type).toBe('info');
    expect(logs[0].message).toBe('Test info log entry');
    expect(logs[0].payload).toEqual({data: 123});
  });

  it('respects the maximum log limit ring buffer of 200 items', () => {
    for (let i = 0; i < 205; i++) {
      engine.addLog('log', `Log entry item ${i}`);
    }
    const logs = engine.getLogs();
    expect(logs.length).toBe(200);
    // Should keep the most recent logs (unshift-based)
    expect(logs[0].message).toBe('Log entry item 204');
  });

  it('updates metrics and tracks Firestore cache hits ratio correctly', () => {
    engine.addLog('db_read', 'Read from server cache', {fromCache: true});
    engine.addLog('db_read', 'Read from server network', {fromCache: false});

    const metrics = engine.getMetrics();
    expect(metrics.totalFirestoreReads).toBe(2);
    expect(metrics.firestoreCacheHits).toBe(1);
  });

  it('handles API request latency calculation correctly', () => {
    engine.addLog('api_res', 'GET /api/books', {durationMs: 100});
    engine.addLog('api_res', 'GET /api/status', {durationMs: 200});

    const metrics = engine.getMetrics();
    expect(metrics.totalApiRequests).toBe(2);
    expect(metrics.averageApiLatency).toBe(150); // (100 + 200) / 2
  });

  it('allows active components or hooks state observer inspection', () => {
    engine.updateState('SampleComponent', {
      activeId: 'book123',
      loading: false,
    });
    const activeStates = engine.getActiveStates();

    expect(activeStates.SampleComponent).toEqual({
      activeId: 'book123',
      loading: false,
    });

    engine.removeState('SampleComponent');
    expect(engine.getActiveStates().SampleComponent).toBeUndefined();
  });

  // ==========================================
  // PHASE 0 TELEMETRY INFRASTRUCTURE TESTS
  // ==========================================

  describe('Phase 0: Persistence Telemetry Engine Features', () => {
    it('accurately calculates payload bytes for various data types', () => {
      expect(calculatePayloadBytes(null)).toBe(0);
      expect(calculatePayloadBytes(undefined)).toBe(0);
      expect(calculatePayloadBytes('')).toBe(0);

      const simpleString = 'Hello World';
      expect(calculatePayloadBytes(simpleString)).toBe(11);

      const sampleObj = {title: 'The Great Gatsby', pages: 180};
      const expectedSize = new Blob([JSON.stringify(sampleObj)]).size;
      expect(calculatePayloadBytes(sampleObj)).toBe(expectedSize);
    });

    it('tracks active listener registrations and cleanups accurately', () => {
      const unregister1 = engine.registerListener(
        'useLibraryData:books',
        'libraries/lib1/books',
      );
      expect(engine.getMetrics().activeFirestoreListeners).toBe(1);

      const listeners = engine.getActiveListeners();
      expect(listeners.length).toBe(1);
      expect(listeners[0].name).toBe('useLibraryData:books');
      expect(listeners[0].path).toBe('libraries/lib1/books');

      const unregister2 = engine.registerListener(
        'useBook:details',
        'libraries/lib1/books/b1/details',
      );
      expect(engine.getMetrics().activeFirestoreListeners).toBe(2);
      expect(engine.getActiveListeners().length).toBe(2);

      // Cleanup listener 1
      unregister1();
      expect(engine.getMetrics().activeFirestoreListeners).toBe(1);
      expect(engine.getActiveListeners()[0].name).toBe('useBook:details');

      // Cleanup listener 2
      unregister2();
      expect(engine.getMetrics().activeFirestoreListeners).toBe(0);
      expect(engine.getActiveListeners().length).toBe(0);
    });

    it('accumulates transferred bytes and computes average book document size', () => {
      engine.addLog('db_read', 'Books snapshot loaded', {
        bytes: 15000,
        docCount: 10,
        parseDurationMs: 8,
        fromCache: false,
      });

      let metrics = engine.getMetrics();
      expect(metrics.totalBytesTransferred).toBe(15000);
      expect(metrics.averageBookDocumentBytes).toBe(1500); // 15000 / 10
      expect(metrics.snapshotParseDurationMs).toBe(8);

      // Add another snapshot with 20 books (30,000 bytes)
      engine.addLog('db_read', 'Books second snapshot', {
        bytes: 30000,
        docCount: 20,
        parseDurationMs: 14,
        fromCache: true,
      });

      metrics = engine.getMetrics();
      expect(metrics.totalBytesTransferred).toBe(45000);
      // Total bytes across books = 45000, total docs = 30 -> average = 1500
      expect(metrics.averageBookDocumentBytes).toBe(1500);
      expect(metrics.snapshotParseDurationMs).toBe(14);
      expect(metrics.firestoreCacheHits).toBe(1);
      expect(metrics.totalFirestoreReads).toBe(2);
    });

    it('captures, compares, and clears baseline snapshots', () => {
      engine.addLog('db_read', 'Initial read', {
        bytes: 20000,
        docCount: 10,
      });

      expect(engine.getBaseline()).toBeNull();

      const baseline = engine.captureBaseline();
      expect(baseline).not.toBeNull();
      expect(baseline.metrics.totalBytesTransferred).toBe(20000);
      expect(baseline.metrics.averageBookDocumentBytes).toBe(2000);

      // Modify live metrics
      engine.addLog('db_read', 'Second read', {
        bytes: 10000,
        docCount: 5,
      });

      // Baseline should remain an immutable copy
      expect(engine.getBaseline()?.metrics.totalBytesTransferred).toBe(20000);
      expect(engine.getMetrics().totalBytesTransferred).toBe(30000);

      // Clear baseline
      engine.clearBaseline();
      expect(engine.getBaseline()).toBeNull();
    });
  });
});

describe('DebugConsoleHUD Component rendering', () => {
  beforeEach(() => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.clearLogs();
    engine.resetMetrics();
    engine.clearBaseline();
  });

  it('renders the console activator trigger label correctly', () => {
    render(<DebugConsoleHUD />);

    const btn = screen.getByRole('button', {name: /Console/i});
    expect(btn).toBeInTheDocument();
  });

  it('expands on trigger button click, presenting core navigation tabs', () => {
    render(<DebugConsoleHUD />);

    const btn = screen.getByRole('button', {name: /Console/i});
    fireEvent.click(btn);

    // Core navigation tabs should enter DOM
    expect(screen.getByText('Network & DB Ops')).toBeInTheDocument();
    expect(screen.getByText('Active Page State')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Persistence Telemetry')).toBeInTheDocument();
  });

  it('displays logged telemetry items correctly inside the log drawer', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.addLog('info', 'Unique Diagnostic Assertion Message');

    render(<DebugConsoleHUD />);

    const btn = screen.getByRole('button', {name: /Console/i});
    fireEvent.click(btn);

    expect(
      screen.getByText('Unique Diagnostic Assertion Message'),
    ).toBeInTheDocument();
  });

  it('switches to the Persistence Telemetry tab and displays live telemetry metrics', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.addLog('db_read', 'Books snapshot loaded', {
      bytes: 25600,
      docCount: 10,
      parseDurationMs: 12,
      fromCache: true,
    });
    engine.registerListener('useLibraryData:books', 'libraries/lib1/books');

    render(<DebugConsoleHUD />);

    // Expand HUD
    const expandBtn = screen.getByRole('button', {name: /Console/i});
    fireEvent.click(expandBtn);

    // Click Persistence Telemetry tab
    const persistenceTabBtn = screen.getByRole('button', {
      name: /Persistence Telemetry/i,
    });
    fireEvent.click(persistenceTabBtn);

    // Verify Phase 0 header and gauges are rendered
    expect(
      screen.getByText(/PHASE 0: DATA & PERSISTENCE PROFILER/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/NET TRANSFERRED/i)).toBeInTheDocument();
    expect(screen.getByText(/AVG BOOK DOC SIZE/i)).toBeInTheDocument();
    expect(screen.getByText(/ACTIVE LISTENERS/i)).toBeInTheDocument();
    expect(screen.getByText(/CACHE & PARSE/i)).toBeInTheDocument();

    // Verify active listener is listed in registry
    expect(screen.getByText('useLibraryData:books')).toBeInTheDocument();
    expect(screen.getByText('libraries/lib1/books')).toBeInTheDocument();
  });

  it('captures baseline from the Persistence Telemetry panel', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.addLog('db_read', 'Initial read', {
      bytes: 50000,
      docCount: 20,
    });

    render(<DebugConsoleHUD />);

    // Expand HUD and open persistence tab
    fireEvent.click(screen.getByRole('button', {name: /Console/i}));
    fireEvent.click(
      screen.getByRole('button', {name: /Persistence Telemetry/i}),
    );

    // Click Capture Baseline button
    const captureBtn = screen.getByRole('button', {name: /Capture Baseline/i});
    fireEvent.click(captureBtn);

    // Profiler comparison table should now be rendered
    expect(
      screen.getByText(/Before & After Snapshot Profiler/i),
    ).toBeInTheDocument();
    expect(engine.getBaseline()).not.toBeNull();
  });
});
