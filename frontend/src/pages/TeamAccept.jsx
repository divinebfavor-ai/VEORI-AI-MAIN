import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { team as teamApi } from '../services/api'

// Invite link target. The invite is tied to an email, so the invitee signs in (or
// registers) with that email first; the token is kept across sign-in.
const PENDING_KEY = 'veori_pending_team_invite'

export default function TeamAccept() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const hydrated = useAuthStore(s => s.hydrated)
  const [state, setState] = useState({ status: 'working', message: '' })

  const token = params.get('token') || (() => { try { return sessionStorage.getItem(PENDING_KEY) } catch { return null } })()

  useEffect(() => {
    if (!hydrated) return
    if (!token) { setState({ status: 'error', message: 'This invite link is incomplete.' }); return }
    if (!isAuthenticated) {
      try { sessionStorage.setItem(PENDING_KEY, token) } catch { /* storage unavailable */ }
      setState({ status: 'signin', message: '' })
      return
    }
    teamApi.accept(token)
      .then(() => {
        try { sessionStorage.removeItem(PENDING_KEY) } catch { /* storage unavailable */ }
        setState({ status: 'done', message: 'You joined the team.' })
        setTimeout(() => window.location.assign('/dashboard'), 1200)
      })
      .catch(err => setState({ status: 'error', message: err?.response?.data?.error || 'Could not accept the invite.' }))
  }, [hydrated, isAuthenticated, token])

  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--app-bg)', padding: 16 }
  const card = { width: 420, maxWidth: '100%', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, color: 'var(--t1)' }

  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Team invite</h1>
        {state.status === 'working' && <p style={{ color: 'var(--t3)', fontSize: 14 }}>Accepting your invite...</p>}
        {state.status === 'done' && <p style={{ color: '#00C37A', fontSize: 14 }}>{state.message}</p>}
        {state.status === 'error' && <p style={{ color: '#FF4444', fontSize: 14 }}>{state.message}</p>}
        {state.status === 'signin' && (
          <>
            <p style={{ color: 'var(--t2)', fontSize: 14, lineHeight: 1.6 }}>Sign in, or create an account, with the email address the invite was sent to. Then open the invite link again.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => navigate('/login')} style={{ flex: 1, height: 40, borderRadius: 8, border: 'none', background: '#00C37A', color: '#000', fontWeight: 600, cursor: 'pointer' }}>Sign in</button>
              <button onClick={() => navigate('/register')} style={{ flex: 1, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--t1)', fontWeight: 600, cursor: 'pointer' }}>Create account</button>
            </div>
          </>
        )}
        {state.status !== 'signin' && <p style={{ marginTop: 16, fontSize: 12 }}><Link to="/dashboard" style={{ color: '#00C37A' }}>Go to dashboard</Link></p>}
      </div>
    </div>
  )
}
