import React, { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

// ─── Google Icon ──────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────
export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuth()
  const navigate   = useNavigate()
  const emailRef   = useRef(null)

  useEffect(() => { emailRef.current?.focus() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { toast.error('Email and password required'); return }
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#000000',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Animated background orbs */}
      <div className="login-bg-orb-1" />
      <div className="login-bg-orb-2" />

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32, position: 'relative', zIndex: 10 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(0,195,122,0.10)',
          border: '1px solid rgba(0,195,122,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 0 30px rgba(0,195,122,0.15)',
        }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#00C37A', letterSpacing: '-0.02em' }}>V</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 500, color: '#FFFFFF', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Veori
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Built to Achieve
        </p>
      </div>

      {/* Glass card */}
      <div style={{
        width: 440, padding: 40, borderRadius: 20,
        background: 'rgba(255,255,255,0.035)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        position: 'relative', zIndex: 10,
      }}>
        {/* Refraction edge */}
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.30) 50%, rgba(255,255,255,0.15) 70%, transparent)',
        }} />

        <h2 style={{ fontSize: 20, fontWeight: 500, color: '#FFFFFF', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
          Welcome back
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: '0 0 28px' }}>
          Sign in to your acquisitions command center
        </p>

        <form onSubmit={handleSubmit}>
          {/* Email */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', marginBottom: 8 }}>
              Email Address
            </label>
            <input
              ref={emailRef} type="email" placeholder="you@company.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" className="glass-input"
              style={{ width: '100%', height: 52, padding: '0 16px', boxSizing: 'border-box' }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', marginBottom: 8 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'} placeholder="••••••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" className="glass-input"
                style={{ width: '100%', height: 52, padding: '0 48px 0 16px', boxSizing: 'border-box' }}
              />
              <button
                type="button" tabIndex={-1} onClick={() => setShowPass(s => !s)}
                style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.30)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4,
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#00C37A'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.30)'}
              >
                {showPass ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
              </button>
            </div>
          </div>

          {/* Forgot */}
          <div style={{ textAlign: 'right', marginBottom: 24 }}>
            <button type="button"
              style={{ background: 'none', border: 'none', fontSize: 12, color: 'rgba(255,255,255,0.30)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', transition: 'color 0.2s ease' }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.30)'}
            >
              Forgot password?
            </button>
          </div>

          {/* Sign In */}
          <button type="submit" disabled={loading}
            style={{
              width: '100%', height: 52, background: loading ? 'rgba(0,195,122,0.7)' : '#00C37A',
              border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, color: '#000000',
              cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s ease',
              boxShadow: '0 0 20px rgba(0,195,122,0.25), 0 4px 12px rgba(0,195,122,0.15)',
              letterSpacing: '-0.01em', fontFamily: 'inherit',
            }}
            onMouseEnter={e => {
              if (!loading) {
                e.currentTarget.style.background = '#00A868'
                e.currentTarget.style.boxShadow = '0 0 30px rgba(0,195,122,0.4), 0 8px 20px rgba(0,195,122,0.2)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = loading ? 'rgba(0,195,122,0.7)' : '#00C37A'
              e.currentTarget.style.boxShadow = '0 0 20px rgba(0,195,122,0.25), 0 4px 12px rgba(0,195,122,0.15)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            {loading ? (
              <svg className="animate-spin" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24">
                <circle opacity={0.25} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : 'Sign In'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', letterSpacing: '0.05em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* Google */}
          <button type="button" onClick={() => toast.info('Google SSO coming soon')}
            style={{
              width: '100%', height: 52,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 10, fontSize: 14, fontWeight: 500, color: '#FFFFFF',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              marginBottom: 28, transition: 'all 0.2s ease', fontFamily: 'inherit',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
            }}
          >
            <GoogleIcon /> Continue with Google
          </button>

          {/* Register link */}
          <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.30)', margin: 0 }}>
            Don&apos;t have an account?{' '}
            <Link to="/register" style={{ color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>
              Sign up
            </Link>
          </p>
        </form>
      </div>

      {/* Footer */}
      <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 24, letterSpacing: '0.03em', position: 'relative', zIndex: 10 }}>
        veori.net · Autonomous Real Estate Intelligence
      </p>
    </div>
  )
}
