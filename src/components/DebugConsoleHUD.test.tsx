import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {DebugTelemetryEngine, interceptConsoleLogs} from '../lib/telemetry';
import {DebugConsoleHUD} from './DebugConsoleHUD';

// Mock Debug Context
vi.mock('../contexts/DebugContext', () => ({
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
});

describe('DebugConsoleHUD Component rendering', () => {
  beforeEach(() => {
    DebugTelemetryEngine.getInstance().clearLogs();
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
});
