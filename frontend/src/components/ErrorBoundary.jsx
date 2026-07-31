import { Component } from 'react'

/**
 * Catches any render/lifecycle error anywhere below it and shows a visible
 * fallback instead of letting React silently unmount the whole tree (which
 * is what a blank white screen with no words actually is — an uncaught
 * error, not a slow network or a CSS issue).
 *
 * Wrapped around the whole app in main.jsx so no page can take down the
 * entire UI without at least telling the person something broke.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface it in the console for real debugging — on a phone this is
    // visible via remote inspection (chrome://inspect, Safari Web Inspector).
    console.error('Unhandled error rendering the app:', error, info)
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            background: '#F7F4EE',
            color: '#2B2622',
          }}
        >
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ margin: 0, maxWidth: 340, color: '#6B6258', fontSize: 14 }}>
            The page hit an unexpected error and couldn't finish loading.
            Reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#C4694A',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
