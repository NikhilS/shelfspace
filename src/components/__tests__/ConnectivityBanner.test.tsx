import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {render, screen, act} from '@testing-library/react';
import React from 'react';
import {ConnectivityBanner} from '../ConnectivityBanner';

describe('ConnectivityBanner', () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
      writable: true,
    });
  });

  it('does not display banner when online', () => {
    render(<ConnectivityBanner />);
    expect(screen.queryByTestId('connectivity-banner')).not.toBeInTheDocument();
  });

  it('displays banner when offline event occurs', () => {
    render(<ConnectivityBanner />);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    const banner = screen.getByTestId('connectivity-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'status');
    expect(screen.getByText(/Working Offline/i)).toBeInTheDocument();
  });
});
