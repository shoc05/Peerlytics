import React from 'react';

/**
 * Top-level error boundary. Catches render/runtime errors anywhere in the tree and
 * shows a friendly recovery screen instead of a blank white page (e.g. the kind of
 * crash a bad reference or a thrown effect would otherwise cause).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surfaced in the console for debugging; swap for a real logging service later.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.assign('/dashboard');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = import.meta.env?.DEV;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%)',
          color: '#ededed',
          fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: '100%',
            background: '#161616',
            border: '1px solid #2e2e2e',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: '#9a9a9a', lineHeight: 1.6 }}>
            The app hit an unexpected error. Your saved work is safe. Try reloading — if it
            keeps happening, sign out and back in.
          </p>
          {isDev && this.state.error && (
            <pre
              style={{
                textAlign: 'left',
                background: '#0d0d0d',
                border: '1px solid #2e2e2e',
                borderRadius: 8,
                padding: 12,
                fontSize: 11,
                color: '#e74c3c',
                overflowX: 'auto',
                marginBottom: 20,
                whiteSpace: 'pre-wrap',
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid #2e2e2e',
                background: 'transparent',
                color: '#ededed',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
