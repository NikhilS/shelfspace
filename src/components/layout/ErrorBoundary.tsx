import React, {Component, ErrorInfo, ReactNode} from 'react';
import {AlertCircle, RefreshCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const boundaryName = this.props.name || 'Root Application View';
    console.error(
      `[ErrorBoundary] Caught render error in "${boundaryName}":`,
      error,
      errorInfo,
    );
    try {
      const reportFn =
        typeof window !== 'undefined'
          ? (
              window as unknown as {
                __reportClientLog?: (
                  level: string,
                  message: string,
                  stack?: string,
                  meta?: unknown,
                ) => void;
              }
            ).__reportClientLog
          : undefined;
      if (typeof reportFn === 'function') {
        reportFn(
          'error',
          `[ErrorBoundary:${boundaryName}] ${error.message}`,
          error.stack,
          {componentStack: errorInfo.componentStack},
        );
      }
    } catch {
      // Ignore reporting errors
    }
  }

  private handleReset = () => {
    try {
      sessionStorage.removeItem('chunk_retry_reloaded');
    } catch {
      // Ignore storage errors in restricted contexts
    }
    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (err) {
        console.error('Error boundary onReset callback failed:', err);
      }
    }
    this.setState({hasError: false, error: null});
  };

  private handleFullReload = () => {
    try {
      sessionStorage.removeItem('chunk_retry_reloaded');
      const hardReset =
        typeof window !== 'undefined'
          ? (window as unknown as {__bookishHardResetAndReload?: () => void})
              .__bookishHardResetAndReload
          : undefined;
      if (typeof hardReset === 'function') {
        hardReset();
        return;
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] w-full p-8 text-center bg-surface rounded-xl border border-outline-variant/60 my-8 architectural-shadow">
          <div className="w-14 h-14 bg-error-container rounded-lg flex items-center justify-center mb-5 border border-error/20">
            <AlertCircle size={28} className="text-error" />
          </div>
          <h2 className="font-serif text-2xl font-semibold text-primary mb-2">
            Something went wrong
          </h2>
          <p className="font-sans text-sm text-on-surface-variant max-w-md mb-6 leading-relaxed">
            {this.props.name
              ? `The ${this.props.name} failed to render.`
              : 'An unexpected error occurred while rendering this part of the application.'}{' '}
            {this.state.error?.message ? (
              <span className="block mt-3 font-mono text-xs text-error bg-error/5 border border-error/15 p-3 rounded-lg text-left break-words">
                Ref: {this.state.error.message.substring(0, 240)}
              </span>
            ) : (
              'We have been notified and are looking into it.'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Button
              onClick={this.handleReset}
              className="flex items-center gap-2 rounded-lg"
            >
              <RefreshCcw size={16} />
              Try Again
            </Button>
            <Button
              onClick={this.handleFullReload}
              variant="outline"
              className="flex items-center gap-2 rounded-lg"
            >
              <RefreshCcw size={16} />
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
