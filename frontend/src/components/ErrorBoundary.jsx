import React from 'react'

export default class ErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border border-border-subtle rounded-xl p-8 text-center">
            <p className="text-[28px] font-light text-white mb-2">Something went wrong</p>
            <p className="text-[13px] text-text-muted mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.replace('/')}
              className="bg-primary hover:bg-primary-hover text-black font-semibold px-6 py-2.5 rounded-[6px] text-[14px] transition-colors">
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
