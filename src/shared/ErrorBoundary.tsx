import { Component } from 'react'
import type { ReactNode } from 'react'
import { reloadPage } from './reload'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Last-resort catch for render/chunk errors so the app never shows a blank
 * page. Picture-only (the player can't read): a friendly face and one big
 * reload button.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="error-screen">
        <div className="error-screen-face" aria-hidden>
          🙈
        </div>
        <button
          type="button"
          className="error-screen-reload"
          onClick={() => reloadPage()}
          aria-label="Reload"
        >
          <span aria-hidden>🔄</span>
        </button>
      </div>
    )
  }
}
