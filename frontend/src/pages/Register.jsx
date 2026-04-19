import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

// ─── Reuse the same NodeGraph from Login ─────────────────────────────────────
const NODES = [
  { id:  1, x: 130, y: 180, r: 3.5, hot: false },
  { id:  2, x: 260, y:  90, r: 2.8, hot: false },
  { id:  3, x: 400, y: 155, r: 5.0, hot: true  },
  { id:  4, x: 540, y:  85, r: 2.8, hot: false },
  { id:  5, x: 660, y: 200, r: 3.5, hot: false },
  { id:  6, x: 190, y: 320, r: 3.0, hot: false },
  { id:  7, x: 360, y: 295, r: 5.5, hot: true  },
  { id:  8, x: 510, y: 360, r: 3.5, hot: false },
  { id:  9, x: 680, y: 345, r: 2.8, hot: false },
  { id: 10, x: 140, y: 460, r: 2.8, hot: false },
  { id: 11, x: 320, y: 455, r: 4.0, hot: false },
  { id: 12, x: 560, y: 490, r: 3.0, hot: false },
]

const EDGES = [
  [1, 2], [1, 6],
  [2, 3], [2, 7],
  [3, 4], [3, 7],
  [4, 5], [5, 8],
  [6, 7], [6, 10],
  [7, 8], [7, 11],
  [8, 9], [8, 12],
  [10, 11], [11, 12],
]

const PULSES = [
  { edge: [3, 4], delay: 0 },
  { edge: [2, 7], delay: 900 },
  { edge: [6, 7], delay: 1800 },
  { edge: [7, 11], delay: 600 },
  { edge: [10, 11], delay: 2400 },
]

function NodeGraph() {
  const nodeMap = Object.fromEntries(NODES.map(n => [n.id, n]))
  return (
    <svg
      viewBox="0 0 800 580"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="hotGlowR" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#00E57A" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#00E57A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {EDGES.map(([a, b], i) => {
        const na = nodeMap[a], nb = nodeMap[b]
        return (
          <line
            key={i}
            x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
            stroke="rgba(0,229,122,0.07)"
            strokeWidth="0.8"
          />
        )
      })}

      {PULSES.map(({ edge: [a, b], delay }, i) => {
        const na = nodeMap[a], nb = nodeMap[b]
        const id = `rp-${i}`
        return (
          <g key={id}>
            <path id={id} d={`M${na.x},${na.y} L${nb.x},${nb.y}`} fill="none" />
            <circle r="2.2" fill="#00E57A" opacity="0.7">
              <animateMotion dur="3s" begin={`${delay}ms`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${id}`} />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.7;0.7;0" dur="3s" begin={`${delay}ms`} repeatCount="indefinite" />
            </circle>
          </g>
        )
      })}

      {NODES.map(n => (
        <g key={n.id}>
          {n.hot && (
            <circle
              cx={n.x} cy={n.y} r={n.r * 5}
              fill="url(#hotGlowR)"
              style={{ animation: `node-breathe ${3 + n.id * 0.3}s ease-in-out infinite` }}
            />
          )}
          <circle
            cx={n.x} cy={n.y} r={n.r}
            fill={n.hot ? '#00E57A' : 'rgba(255,255,255,0.15)'}
            style={{
              animation: `node-breathe ${2.5 + n.id * 0.4}s ease-in-out infinite`,
              animationDelay: `${n.id * 150}ms`,
            }}
          />
        </g>
      ))}
    </svg>
  )
}

// ─── Register Page ────────────────────────────────────────────────────────────
export default function Register() {
  const [form, setForm]     = useState({ full_name: '', email: '', password: '', company_name: '' })
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocused] = useState(null)
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

  const fieldStyle = (name) => ({
    width: '100%',
    height: 44,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${focusedField === name ? 'rgba(0,229,122,0.50)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 8,
    padding: '0 14px',
    fontSize: 14,
    color: '#F0F0F5',
    outline: 'none',
    boxShadow: focusedField === name ? '0 0 0 3px rgba(0,229,122,0.08)' : 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    fontFamily: 'Inter, sans-serif',
  })

  const labelStyle = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
    display: 'block',
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0D0D0F', overflow: 'hidden' }}>

      {/* ── Left: System Visualization (60%) ─────────────────────────── */}
      <div style={{
        flex: '0 0 60%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: 40,
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.9 }}>
          <NodeGraph />
        </div>

        {/* Bottom tagline */}
        <div style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <p style={{
            fontFamily: '"JetBrains Mono", "SF Mono", monospace',
            fontSize: 11,
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.04em',
          }}>
            veori.ai — Real estate acquisitions, automated.
          </p>
          <p style={{
            fontFamily: '"JetBrains Mono", "SF Mono", monospace',
            fontSize: 11,
            color: 'rgba(0,229,122,0.50)',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
              background: '#00E57A',
              animation: 'dot-live-anim 2s ease-in-out infinite',
            }} />
            System accepting new operators
          </p>
        </div>
      </div>

      {/* ── Right: Registration Panel (40%) ──────────────────────────── */}
      <div style={{
        flex: '0 0 40%',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 52px',
        background: '#111115',
        overflowY: 'auto',
      }}>
        {/* Identity */}
        <div style={{ marginBottom: 36 }}>
          <p style={{
            fontSize: 22, fontWeight: 600, color: '#F0F0F5',
            letterSpacing: '-0.02em', marginBottom: 8,
          }}>
            Create account
          </p>
          <p style={{ fontSize: 13, color: '#44444F', lineHeight: 1.5 }}>
            Start closing deals autonomously.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Full Name */}
          <div>
            <label style={labelStyle}>Full Name</label>
            <input
              type="text"
              placeholder="John Smith"
              value={form.full_name}
              onChange={set('full_name')}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
              autoComplete="name"
              style={fieldStyle('name')}
            />
          </div>

          {/* Company */}
          <div>
            <label style={labelStyle}>Company Name</label>
            <input
              type="text"
              placeholder="Smith Acquisitions"
              value={form.company_name}
              onChange={set('company_name')}
              onFocus={() => setFocused('company')}
              onBlur={() => setFocused(null)}
              style={fieldStyle('company')}
            />
          </div>

          {/* Email */}
          <div>
            <label style={labelStyle}>Email Address</label>
            <input
              type="email"
              placeholder="you@company.com"
              value={form.email}
              onChange={set('email')}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              autoComplete="email"
              style={fieldStyle('email')}
            />
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              placeholder="Minimum 8 characters"
              value={form.password}
              onChange={set('password')}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              autoComplete="new-password"
              style={fieldStyle('password')}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 6,
              width: '100%', height: 46,
              background: loading ? 'rgba(0,229,122,0.6)' : '#00E57A',
              color: '#000',
              fontWeight: 600, fontSize: 14,
              border: 'none', borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'filter 0.15s ease',
              fontFamily: 'Inter, sans-serif',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.filter = 'brightness(1.08)' }}
            onMouseLeave={e => { e.currentTarget.style.filter = '' }}
          >
            {loading ? (
              <svg className="animate-spin" style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <>Get Access <ArrowRight size={15} strokeWidth={2} /></>
            )}
          </button>
        </form>

        {/* Sign in link */}
        <p style={{ marginTop: 28, fontSize: 13, color: '#44444F', textAlign: 'center' }}>
          Already have access?{' '}
          <Link
            to="/login"
            style={{ color: '#00E57A', textDecoration: 'none', fontWeight: 500 }}
          >
            Sign in →
          </Link>
        </p>
      </div>
    </div>
  )
}
