import React, {ErrorInfo, ReactNode} from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  componentDidMount() {
    window.addEventListener(
      'unhandledrejection',
      this.handleUnhandledRejection,
    );
  }

  componentWillUnmount() {
    window.removeEventListener(
      'unhandledrejection',
      this.handleUnhandledRejection,
    );
  }

  handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (event.reason instanceof Error) {
      this.setState({hasError: true, error: event.reason});
    } else if (typeof event.reason === 'string') {
      this.setState({hasError: true, error: new Error(event.reason)});
    }
  };

  public static getDerivedStateFromError(error: Error): State {
    return {hasError: true, error};
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage =
        this.state.error?.message || 'An unexpected error occurred.';
      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed.error && parsed.operationType) {
          errorMessage = `Firestore Error (${parsed.operationType}): ${parsed.error}`;
        }
      } catch {
        // Not a JSON error, use as is
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-paper p-4">
          <div className="bg-surface p-8 rounded-xl shadow-lg max-w-lg w-full">
            <h2 className="text-2xl font-bold text-red-600 mb-4">
              Something went wrong
            </h2>
            <div className="bg-red-50 p-4 rounded-md text-red-800 text-sm font-mono break-words mb-6">
              {errorMessage}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-accent text-white py-2 px-4 rounded-md hover:bg-accent/90 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
