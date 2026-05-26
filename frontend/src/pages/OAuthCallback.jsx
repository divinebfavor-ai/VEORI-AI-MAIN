/**
 * OAuth Callback Page — /oauth/callback
 *
 * Operators land here after approving a social media connection.
 * This page reads the result, shows success/error, then closes the popup.
 * If opened in a popup, it posts a message to the parent window then closes.
 * If opened as a full redirect, it redirects to Settings.
 */
import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader } from 'lucide-react'

const PLATFORM_LABELS = {
  facebook:  { label: 'Facebook',  icon: '📘', color: '#1877F2' },
  instagram: { label: 'Instagram', icon: '📸', color: '#E1306C' },
  twitter:   { label: 'Twitter/X', icon: '𝕏',  color: '#1DA1F2' },
  youtube:   { label: 'YouTube',   icon: '▶',  color: '#FF0000' },
  tiktok:    { label: 'TikTok',    icon: '♪',  color: '#69C9D0' },
}

export default function OAuthCallback() {
  const [status, setStatus] = useState('loading') // 'loading' | 'success' | 'error'
  const [platform, setPlatform] = useState('')
  const [account, setAccount] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const success  = params.get('success') === 'true'
    const error    = params.get('error')
    const plat     = params.get('platform') || ''
    const acct     = params.get('account')  || ''

    setPlatform(plat)
    setAccount(acct)

    if (success) {
      setStatus('success')
      // Notify parent window if this was opened as a popup
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_SUCCESS', platform: plat, account: acct }, '*')
        setTimeout(() => window.close(), 1800)
      } else {
        // Full redirect — send them back to Settings
        setTimeout(() => { window.location.href = '/settings?tab=social' }, 2000)
      }
    } else {
      const messages = {
        not_configured:       'This platform is still being configured.',
        token_exchange_failed:'Could not complete sign-in. Please try again.',
        invalid_state:        'Invalid request. Please try again.',
        missing_params:       'Missing required information. Please try again.',
        server_error:         'A server error occurred. Please try again.',
        access_denied:        'You declined the connection.',
      }
      setErrorMsg(messages[error] || 'Something went wrong. Please try again.')
      setStatus('error')
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_ERROR', platform: plat, error }, '*')
        setTimeout(() => window.close(), 3000)
      } else {
        setTimeout(() => { window.location.href = '/settings?tab=social' }, 3000)
      }
    }
  }, [])

  const p = PLATFORM_LABELS[platform] || { label: platform, icon: '🌐', color: '#00C37A' }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#060E1A', fontFamily: 'Inter, sans-serif',
      padding: 24,
    }}>
      <div style={{
        background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 20, padding: '48px 40px', textAlign: 'center',
        maxWidth: 400, width: '100%',
      }}>
        {status === 'loading' && (
          <>
            <Loader size={40} style={{ color: '#00C37A', margin: '0 auto 20px', display: 'block', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 16, color: '#fff', margin: 0 }}>Connecting your account...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{p.icon}</div>
            <CheckCircle size={36} style={{ color: '#00C37A', margin: '0 auto 16px', display: 'block' }} />
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
              {p.label} Connected!
            </p>
            {account && (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 20px' }}>
                Logged in as <strong style={{ color: p.color }}>{account}</strong>
              </p>
            )}
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
              {window.opener ? 'Closing in a moment...' : 'Redirecting back to Settings...'}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={40} style={{ color: '#FF4444', margin: '0 auto 16px', display: 'block' }} />
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
              Connection Failed
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 20px' }}>
              {errorMsg}
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
              {window.opener ? 'Closing...' : 'Redirecting back to Settings...'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
