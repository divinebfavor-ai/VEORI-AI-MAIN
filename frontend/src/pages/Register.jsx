import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'

export default function Register() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', company_name: '' })
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name || !form.email || !form.password) {
      toast.error('Please fill in all required fields')
      return
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await register(form)
      toast.success('Account created!')
      navigate('/dashboard')
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
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(0,195,122,0.10)',
          border: '1px solid rgba(0,195,122,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', backdropFilter: 'blur(10px)',
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
            { key: 'password',     label: 'Password',     type: 'password', ph: 'Minimum 8 characters',  ac: 'new-password' },
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

        <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.30)', margin: '24px 0 0' }}>
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
