import React from 'react';
import {render, screen} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {ErrorBoundary} from './ErrorBoundary';

const ThrowError = ({shouldThrow}: {shouldThrow: boolean}) => {
  if (shouldThrow) {
    throw new Error('Test Error');
  }
  return <div>Component Content</div>;
};

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Component Content')).toBeInTheDocument();
  });

  it('renders fallback UI when an error occurs', () => {
    // Prevent vitest from failing the test due to the thrown error we are catching
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/unexpected error occurred/)).toBeInTheDocument();
    
    consoleSpy.mockRestore();
  });

  it('renders custom fallback when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom Fallback</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Fallback')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('displays the component name in the error message if provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary name="Library Map">
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/The Library Map failed to render/)).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
