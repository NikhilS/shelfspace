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
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {hasError: true, error};
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `ErrorBoundary caught an error in ${this.props.name || 'Unknown View'}:`,
      error,
      errorInfo,
    );
  }

  private handleReset = () => {
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
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] w-full p-8 text-center bg-surface-container-lowest rounded-3xl border border-outline-variant/30 my-8 architectural-shadow">
          <div className="w-16 h-16 bg-error-container rounded-full flex items-center justify-center mb-6">
            <AlertCircle size={32} className="text-error" />
          </div>
          <h2 className="font-serif text-2xl font-bold text-primary mb-3">
            Something went wrong
          </h2>
          <p className="font-body-md text-on-surface-variant max-w-md mb-8 leading-relaxed">
            {this.props.name
              ? `The ${this.props.name} failed to render.`
              : 'An unexpected error occurred while rendering this part of the application.'}{' '}
            {this.state.error?.message ? (
              <span className="block mt-2 font-mono text-xs text-error/80 bg-error/5 border border-error/10 p-2 rounded">
                Ref: {this.state.error.message.substring(0, 150)}
              </span>
            ) : (
              'We have been notified and are looking into it.'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Button
              onClick={this.handleReset}
              className="flex items-center gap-2"
            >
              <RefreshCcw size={18} />
              Try Again
            </Button>
            <Button
              onClick={this.handleFullReload}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCcw size={18} className="animate-spin-once" />
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
