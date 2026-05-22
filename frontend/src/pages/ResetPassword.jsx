import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { auth } from '../services/api'
import VeoriLogo from '../components/VeoriLogo'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    if (!token) {
      toast.error('Invalid reset link')
      navigate('/forgot-password')
    }
  }, [token, navigate])

  const rules = [
    { label: '12+ characters', ok: password.length >= 12 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Number', ok: /[0-9]/.test(password) },
    { label: 'Special character', ok: /[^A-Za-z0-9]/.test(password) },
  ]
  const allValid = rules.every(r => r.ok)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!allValid) { toast.error('Password does not meet requirements'); return }
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    setLoading(true)
    try {
      await auth.resetPassword(token, password)
      setDone(true)
      toast.success('Password updated successfully')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed. The link may have expired.')
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
    fontFamily: 'inherit',
  }

  const btnStyle = {
    width: '100%', height: 44, borderRadius: 10,
    background: allValid ? '#00C37A' : 'rgba(0,195,122,0.3)',
    border: 'none', color: '#000',
    fontSize: 14, fontWeight: 700,
    cursor: loading || !allValid ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', letterSpacing: '-0.01em',
    transition: 'background 0.2s',
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#000', position: 'relative', overflow: 'hidden',
    }}>
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
        {done ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 10px' }}>Password updated</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 24px', lineHeight: 1.6 }}>
              Your password has been changed. You can now log in with your new password.
            </p>
            <Link to="/login">
              <button style={{ ...btnStyle, width: 'auto', padding: '0 28px', cursor: 'pointer', background: '#00C37A' }}>
                Go to Login
              </button>
            </Link>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.03em' }}>Create new password</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '0 0 24px' }}>
              Choose a strong password for your account.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: 6 }}>NEW PASSWORD</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                    style={{ ...inputStyle, paddingRight: 42 }}
                    onFocus={e => e.target.style.borderColor = 'rgba(0,195,122,0.5)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0 }}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Password rules */}
              {password.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                  {rules.map(r => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                      <span style={{ color: r.ok ? '#00C37A' : 'rgba(255,255,255,0.3)', fontWeight: 700 }}>{r.ok ? '✓' : '○'}</span>
                      <span style={{ color: r.ok ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.30)' }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: 6 }}>CONFIRM PASSWORD</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  style={{ ...inputStyle, borderColor: confirm && confirm !== password ? 'rgba(255,68,68,0.5)' : undefined }}
                  onFocus={e => e.target.style.borderColor = 'rgba(0,195,122,0.5)'}
                  onBlur={e => { if (!confirm || confirm === password) e.target.style.borderColor = 'rgba(255,255,255,0.12)' }}
                />
                {confirm && confirm !== password && (
                  <p style={{ fontSize: 11, color: '#FF4444', margin: '4px 0 0' }}>Passwords do not match</p>
                )}
              </div>

              <button type="submit" style={btnStyle} disabled={loading || !allValid}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
