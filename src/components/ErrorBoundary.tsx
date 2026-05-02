import React, {Component, ErrorInfo, ReactNode} from 'react';
import {AlertCircle, RefreshCcw} from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
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
            We've been notified and are looking into it.
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 bg-primary text-on-primary px-6 py-3 rounded-xl hover:bg-primary/90 transition-all font-body-md text-sm font-bold shadow-sm"
          >
            <RefreshCcw size={18} />
            Try Refreshing
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
