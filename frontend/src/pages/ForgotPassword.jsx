import React, { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { auth } from '../services/api'
import VeoriLogo from '../components/VeoriLogo'

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) { toast.error('Enter your email address'); return }
    setLoading(true)
    try {
      await auth.forgotPassword(email.trim().toLowerCase())
      setSent(true)
    } catch {
      // Always show success to prevent email enumeration
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '12px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, fontSize: 14,
    color: '#fff', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', transition: 'border-color 0.2s',
  }

  const btnStyle = {
    width: '100%', height: 44, borderRadius: 10,
    background: '#00C37A', border: 'none', color: '#000',
    fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', letterSpacing: '-0.01em',
    opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s',
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#000', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background orbs */}
      <div className="login-bg-orb-1" />
      <div className="login-bg-orb-2" />

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 28, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <VeoriLogo size={52} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>VEORI</span>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 18, padding: '32px 28px',
        position: 'relative', zIndex: 10,
        backdropFilter: 'blur(20px)',
      }}>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✉️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 10px' }}>Check your email</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 24px' }}>
              If an account exists for <strong style={{ color: 'rgba(255,255,255,0.80)' }}>{email}</strong>, you will receive a password reset link within a few minutes.
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '0 0 20px' }}>Check your spam folder if you do not see it.</p>
            <Link to="/login" style={{ fontSize: 13, color: '#00C37A', textDecoration: 'none', fontWeight: 600 }}>
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.03em' }}>Forgot your password?</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '0 0 24px', lineHeight: 1.5 }}>
              Enter your email and we will send you a reset link.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: 6 }}>EMAIL</label>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'rgba(0,195,122,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                />
              </div>
              <button type="submit" style={btnStyle} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <Link to="/login" style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)', textDecoration: 'none' }}>
                Back to login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
