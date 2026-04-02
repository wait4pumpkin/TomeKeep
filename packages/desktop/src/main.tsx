import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message + '\n\n' + (e.stack ?? '') }
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{
          color: 'red', padding: 24, whiteSpace: 'pre-wrap',
          fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5,
          background: '#fff', minHeight: '100vh', margin: 0,
        }}>
          {this.state.error}
        </pre>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
