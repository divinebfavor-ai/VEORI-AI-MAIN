import React from 'react'

// Shown while a page's code is downloading. Inside the app shell it fills only
// the content area, so the sidebar and status bar stay put; for public pages
// (no shell) it covers the viewport on the app background.
export default function RouteFallback({ fullScreen = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: fullScreen ? '100vh' : '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: fullScreen ? 'var(--app-bg)' : 'transparent',
        padding: 24,
      }}
    >
      <span className="veori-route-spinner" aria-hidden="true" />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        Loading page
      </span>
      <style>{`
        .veori-route-spinner {
          width: 22px; height: 22px; border-radius: 50%;
          border: 2px solid var(--border); border-top-color: var(--green);
          display: inline-block; animation: veoriRouteSpin 0.8s linear infinite;
        }
        @keyframes veoriRouteSpin { to { transform: rotate(360deg) } }
        @media (prefers-reduced-motion: reduce) { .veori-route-spinner { animation: none } }
      `}</style>
    </div>
  )
}
