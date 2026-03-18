import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: string | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

/**
 * Error boundary for chunk visualization components.
 * Catches rendering errors in child components and displays a fallback UI
 * with the error message and a retry button.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
class ChunkVisualizationErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ChunkVisualization Error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            padding: '40px 20px',
            color: '#666',
          }}
          role="alert"
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h4 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '16px' }}>
            Something went wrong
          </h4>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: '1.4' }}>
            {this.state.error || 'An unexpected error occurred in the chunk visualization.'}
          </p>
          <button
            style={{
              padding: '12px 24px',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              fontWeight: '600',
              backgroundColor: '#007bff',
              color: 'white',
              cursor: 'pointer',
            }}
            onClick={this.handleReset}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChunkVisualizationErrorBoundary;
