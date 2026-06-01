import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import VeoriLogo from '../components/VeoriLogo'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app'
const API_ROUTES = `${API}/api`

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

export default function Register() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', company_name: '' })
  const [loading, setLoading] = useState(false)
  const [refCode, setRefCode] = useState('')
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    const ref  = params.get('ref')
    const name = params.get('name')
    const email = params.get('email')
    const plan = params.get('plan')
    if (ref)   setRefCode(ref.toUpperCase())
    if (name || email) setForm(f => ({ ...f, full_name: name || f.full_name, email: email || f.email }))
    if (plan)  localStorage.setItem('pending_plan', plan)
  }, [])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const pwRules = [
    { label: '12+ characters', ok: form.password.length >= 12 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(form.password) },
    { label: 'Number', ok: /[0-9]/.test(form.password) },
    { label: 'Special character', ok: /[^A-Za-z0-9]/.test(form.password) },
  ]
  const pwValid = pwRules.every(r => r.ok)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name || !form.email || !form.password) {
      toast.error('Please fill in all required fields')
      return
    }
    if (!pwValid) {
      toast.error('Password does not meet the requirements below')
      return
    }
    setLoading(true)
    try {
      const result = await register(form)
      // Apply referral code if present
      if (refCode && result?.user?.id) {
        fetch(`${API_ROUTES}/referrals/apply`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ referral_code: refCode, user_id: result.user.id }),
        }).catch(() => {})
      }
      toast.success('Account created!')
      const pendingPlan = localStorage.getItem('pending_plan')
      if (pendingPlan) {
        localStorage.removeItem('pending_plan')
        navigate(`/billing?plan=${pendingPlan}`)
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#000000', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background orbs */}
      <div className="login-bg-orb-1" />
      <div className="login-bg-orb-2" />

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <VeoriLogo size={56} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 500, color: '#FFFFFF', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          VEORI
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Built to Achieve
        </p>
      </div>

      {/* Glass card */}
      <div style={{
        width: 440, padding: '36px 40px', borderRadius: 20,
        background: 'rgba(255,255,255,0.035)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.6)',
        position: 'relative', zIndex: 10,
      }}>
        {/* Refraction edge */}
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.30) 50%, rgba(255,255,255,0.15) 70%, transparent)',
        }} />

        <h2 style={{ fontSize: 20, fontWeight: 500, color: '#FFFFFF', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
          Create your account
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: '0 0 24px' }}>
          Start closing deals autonomously
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { key: 'full_name',    label: 'Full Name',    type: 'text',     ph: 'John Smith',            ac: 'name' },
            { key: 'company_name', label: 'Company Name', type: 'text',     ph: 'Smith Acquisitions',    ac: 'organization' },
            { key: 'email',        label: 'Email Address',type: 'email',    ph: 'you@company.com',       ac: 'email' },
            { key: 'password',     label: 'Password',     type: 'password', ph: 'At least 12 characters', ac: 'new-password' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', marginBottom: 8 }}>
                {f.label}
              </label>
              <input
                type={f.type} placeholder={f.ph}
                value={form[f.key]} onChange={set(f.key)} autoComplete={f.ac}
                className="glass-input"
                style={{ width: '100%', height: 48, padding: '0 16px', boxSizing: 'border-box' }}
              />
            </div>
          ))}

          {/* Password strength rules */}
          {form.password.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginTop: -4 }}>
              {pwRules.map(r => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                  <span style={{ color: r.ok ? '#00C37A' : 'rgba(255,255,255,0.3)', fontWeight: 700 }}>{r.ok ? '✓' : '○'}</span>
                  <span style={{ color: r.ok ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.30)' }}>{r.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Promo Code */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', marginBottom: 8 }}>
              Promo / Referral Code <span style={{ color: 'rgba(255,255,255,0.18)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="e.g. JOHN4A2B"
                value={refCode}
                onChange={e => setRefCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                className="glass-input"
                style={{ width: '100%', height: 48, padding: '0 44px 0 16px', boxSizing: 'border-box', fontFamily: 'Geist Mono, monospace', letterSpacing: '0.12em', textTransform: 'uppercase' }}
              />
              {refCode.length >= 6 && (
                <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18 }}>✓</span>
              )}
            </div>
            {refCode.length >= 6 && (
              <p style={{ fontSize: 11, color: '#00C37A', margin: '5px 0 0' }}>Code accepted — your referrer earns their bonus once you subscribe to a plan.</p>
            )}
          </div>

          <button type="submit" disabled={loading}
            style={{
              width: '100%', height: 52,
              background: loading ? 'rgba(0,195,122,0.7)' : '#00C37A',
              border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600,
              color: '#000', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s ease', marginTop: 4,
              boxShadow: '0 0 20px rgba(0,195,122,0.25), 0 4px 12px rgba(0,195,122,0.15)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = '#00A868'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { e.currentTarget.style.background = loading ? 'rgba(0,195,122,0.7)' : '#00C37A'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            {loading ? (
              <svg className="animate-spin" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24">
                <circle opacity={0.25} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : 'Create Account'}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', letterSpacing: '0.05em' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {/* Google sign-up */}
        <button type="button" onClick={() => { window.location.href = `${API_ROUTES}/auth/google` }}
          style={{
            width: '100%', height: 52,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10, fontSize: 14, fontWeight: 500, color: '#FFFFFF',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            marginBottom: 20, transition: 'all 0.2s ease', fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)' }}
        >
          <GoogleIcon /> Continue with Google
        </button>

        <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.30)', margin: '0' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
        </p>
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 24, letterSpacing: '0.03em', position: 'relative', zIndex: 10 }}>
        veori.net · Autonomous Real Estate Intelligence
      </p>
    </div>
  )
}
