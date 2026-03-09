import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_AUTO_RETRIES = 2;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info.componentStack);

    // Auto-retry on first errors (handles WASM / async init races)
    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      setTimeout(() => {
        this.setState((s) => ({
          hasError: false,
          error: null,
          retryCount: s.retryCount + 1,
        }));
      }, 500);
    }
  }

  render() {
    if (this.state.hasError) {
      // Still auto-retrying — show a loading state instead of an error
      if (this.state.retryCount < MAX_AUTO_RETRIES) {
        return (
          <div className="h-screen bg-zinc-900 flex items-center justify-center">
            <span className="text-zinc-500">Loading...</span>
          </div>
        );
      }

      return (
        <div className="h-screen bg-zinc-900 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-red-400 text-lg">Something went wrong</p>
            <pre className="text-zinc-500 text-xs max-w-md overflow-auto">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() =>
                this.setState({ hasError: false, error: null, retryCount: 0 })
              }
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
