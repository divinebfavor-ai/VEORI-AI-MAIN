import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import useThemeStore from './store/themeStore'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 }
  }
})

// Apply theme immediately before first render to avoid flash
const themeState = useThemeStore.getState()
const hasStoredTheme = localStorage.getItem('veori-theme')
if (!hasStoredTheme) {
  themeState.detectOSPreference()
} else {
  themeState.init()
}

// Sync from DB after auth is available (non-blocking)
if (localStorage.getItem('veori_token')) {
  themeState.syncFromDB()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          gutter={10}
          containerStyle={{ top: 20, right: 20 }}
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(10, 12, 20, 0.82)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              color: 'rgba(255,255,255,0.88)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              fontSize: '13px',
              fontFamily: 'Geist, sans-serif',
              fontWeight: '450',
              letterSpacing: '-0.01em',
              lineHeight: '1.5',
              padding: '12px 16px',
              maxWidth: '340px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.40), 0 1px 0 rgba(255,255,255,0.04) inset',
            },
            success: {
              duration: 3000,
              style: {
                background: 'rgba(0, 12, 8, 0.85)',
                border: '1px solid rgba(0,195,122,0.22)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.40), 0 0 0 1px rgba(0,195,122,0.06) inset',
              },
              iconTheme: {
                primary: '#00C37A',
                secondary: 'rgba(0,195,122,0.12)',
              },
            },
            error: {
              duration: 4000,
              style: {
                background: 'rgba(16, 4, 4, 0.85)',
                border: '1px solid rgba(255,68,68,0.22)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,68,68,0.06) inset',
              },
              iconTheme: {
                primary: '#FF4444',
                secondary: 'rgba(255,68,68,0.12)',
              },
            },
            loading: {
              style: {
                background: 'rgba(10, 12, 20, 0.82)',
                border: '1px solid rgba(255,255,255,0.08)',
              },
              iconTheme: {
                primary: '#00C37A',
                secondary: 'rgba(255,255,255,0.08)',
              },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
)
