import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches React render errors so the page doesn't go blank on a thrown
 * exception (which is what mobile Safari/Chrome show when a render fails
 * in a tree without an error boundary). The error + component stack are
 * also re-thrown via `console.error` so `errorOverlay` picks them up.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info })
    // Surface to errorOverlay (mirrored from console.error).
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        padding: 24,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        color: '#fafafa',
        background: '#1a1a1a',
        minHeight: '100vh',
        lineHeight: 1.5,
      }}>
        <h2 style={{ marginTop: 0, color: '#ff6b6b' }}>Render error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
          {this.state.info?.componentStack && (
            <>{'\n\nComponent stack:'}{this.state.info.componentStack}</>
          )}
        </pre>
        <button
          onClick={() => this.setState({ error: null, info: null })}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            background: '#2a2a2a',
            color: '#fafafa',
            border: '1px solid #555',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
