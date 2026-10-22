import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../../lib/telemetry';
import {DebugConsoleHud} from './DebugConsoleHud';

// Mock Debug Context
vi.mock('../../stores/debugStore', () => ({
  useDebug: () => ({
    isDebugMode: true,
    toggleDebugMode: vi.fn(),
    logs: [],
    clearLogs: vi.fn(),
    debugData: null,
    setDebugData: vi.fn(),
    debugTitle: 'Debug Data',
    profilingLevel: 'basic',
    setProfilingLevel: vi.fn(),
  }),
}));

describe('DebugTelemetryEngine Unit Tests', () => {
  let engine: DebugTelemetryEngine;

  beforeEach(() => {
    DebugTelemetryEngine.resetInstance();
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

  it('updates metrics and tracks cache hits ratio correctly', () => {
    engine.addLog('db_read', 'Read from cache', {fromCache: true});
    engine.addLog('db_read', 'Read from network', {fromCache: false});

    const metrics = engine.getMetrics();
    expect(metrics.totalFirestoreReads).toBe(2);
    expect(metrics.firestoreCacheHits).toBe(1);
  });

  it('handles API request latency calculation correctly', () => {
    engine.addLog('api_res', 'GET /trpc/book.list', {durationMs: 100});
    engine.addLog('api_res', 'GET /trpc/library.get', {durationMs: 200});

    const metrics = engine.getMetrics();
    expect(metrics.totalApiRequests).toBe(2);
    expect(metrics.averageApiLatency).toBe(150);
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

  describe('Persistence & Cache Telemetry Engine Features', () => {
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
        'SSE:geo',
        '/api/enrichment/stream?libraryId=lib1',
      );
      expect(engine.getMetrics().activeFirestoreListeners).toBe(1);

      const listeners = engine.getActiveListeners();
      expect(listeners.length).toBe(1);
      expect(listeners[0].name).toBe('SSE:geo');

      const unregister2 = engine.registerListener(
        'SSE:genre',
        '/api/enrichment/stream?libraryId=lib2',
      );
      expect(engine.getMetrics().activeFirestoreListeners).toBe(2);

      unregister1();
      expect(engine.getMetrics().activeFirestoreListeners).toBe(1);
      expect(engine.getActiveListeners()[0].name).toBe('SSE:genre');

      unregister2();
      expect(engine.getMetrics().activeFirestoreListeners).toBe(0);
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
      expect(metrics.averageBookDocumentBytes).toBe(1500);
      expect(metrics.snapshotParseDurationMs).toBe(8);

      engine.addLog('db_read', 'Books second snapshot', {
        bytes: 30000,
        docCount: 20,
        parseDurationMs: 14,
        fromCache: true,
      });

      metrics = engine.getMetrics();
      expect(metrics.totalBytesTransferred).toBe(45000);
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

      engine.addLog('db_read', 'Second read', {
        bytes: 10000,
        docCount: 5,
      });

      expect(engine.getBaseline()?.metrics.totalBytesTransferred).toBe(20000);
      expect(engine.getMetrics().totalBytesTransferred).toBe(30000);

      engine.clearBaseline();
      expect(engine.getBaseline()).toBeNull();
    });
  });
});

describe('DebugConsoleHud Component rendering', () => {
  beforeEach(() => {
    DebugTelemetryEngine.resetInstance();
    const engine = DebugTelemetryEngine.getInstance();
    engine.clearLogs();
    engine.resetMetrics();
    engine.clearBaseline();
  });

  it('renders the console activator trigger label correctly', () => {
    render(<DebugConsoleHud />);

    const btn = screen.getByRole('button', {name: /Console/i});
    expect(btn).toBeInTheDocument();
  });

  it('expands on trigger button click, presenting the 4 streamlined navigation tabs', () => {
    render(<DebugConsoleHud />);

    const btn = screen.getByRole('button', {name: /Console/i});
    fireEvent.click(btn);

    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Network & Services')).toBeInTheDocument();
    expect(screen.getByTitle('Cache & Persistence')).toBeInTheDocument();
    expect(screen.getByText('PWA & System')).toBeInTheDocument();
  });

  it('displays logged telemetry items and filters by scope inside the Logs tab', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.addLog('info', 'Unique Diagnostic Assertion Message', undefined, {
      scope: 'Auth',
    });

    render(<DebugConsoleHud />);

    const btn = screen.getByRole('button', {name: /Console/i});
    fireEvent.click(btn);

    expect(
      screen.getByText('Unique Diagnostic Assertion Message'),
    ).toBeInTheDocument();
  });

  it('switches to the Cache tab and displays live TanStack Query & IndexedDB gauges and baseline snapshot controls', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.addLog('db_read', 'Books snapshot loaded', {
      bytes: 25600,
      docCount: 10,
      parseDurationMs: 12,
      fromCache: true,
    });

    render(<DebugConsoleHud />);

    fireEvent.click(screen.getByRole('button', {name: /Console/i}));
    fireEvent.click(screen.getByTitle('Cache & Persistence'));

    expect(
      screen.getByText(/TANSTACK QUERY & INDEXEDDB CACHE INSPECTOR/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/CACHE HIT RATIO/i)).toBeInTheDocument();
    expect(screen.getByText(/IN-MEMORY QUERIES/i)).toBeInTheDocument();
    expect(screen.getByText(/INDEXEDDB PERSISTER/i)).toBeInTheDocument();
    expect(screen.getByText(/NET TRANSFERRED/i)).toBeInTheDocument();

    const captureBtn = screen.getByRole('button', {name: /Capture Baseline/i});
    fireEvent.click(captureBtn);

    expect(
      screen.getByText(/Before & After Snapshot Profiler/i),
    ).toBeInTheDocument();
    expect(engine.getBaseline()).not.toBeNull();
  });

  it('switches to the PWA & System tab and displays connectivity, Service Worker, and active streams', () => {
    const engine = DebugTelemetryEngine.getInstance();
    engine.registerListener('SSE:geo', '/api/enrichment/stream?libraryId=lib1');
    engine.updateState('LibraryView', {selectedCount: 3});

    render(<DebugConsoleHud />);

    fireEvent.click(screen.getByRole('button', {name: /Console/i}));
    fireEvent.click(screen.getByTitle('PWA & System'));

    expect(screen.getByText(/PWA CONNECTIVITY/i)).toBeInTheDocument();
    expect(screen.getByText(/SERVICE WORKER/i)).toBeInTheDocument();
    expect(screen.getByText('SSE:geo')).toBeInTheDocument();
    expect(screen.getByText('LibraryView')).toBeInTheDocument();
  });
});
