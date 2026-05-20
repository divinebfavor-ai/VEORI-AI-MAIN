import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'
import { useState } from 'react'

const API_URL = 'https://veori-ai-main.up.railway.app/api/billing'

const included = [
  '500 AI calls per month',
  'Real-time motivation scoring (0–100)',
  '24/7 automated operation',
  'Full CRM dashboard with recordings',
  'Automated offer delivery',
  'Lead scoring and prioritization',
  'Rate locked permanently',
  'All future features — no upgrade fees',
]

const comingSoon = [
  'Expired listing auto-contact (60 min)',
  'Contract generation under 4 minutes',
  'Buyer matching and deal automation',
  'Automatic public records lead sourcing',
]

export default function Pricing() {
  const { ref, visible } = useReveal()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, plan: 'founding' }),
      })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
    } catch {}
    setLoading(false)
    setDone(true)
  }

  return (
    <section id="pricing" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      {/* Radial spotlight */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 500, background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.07) 0%, transparent 70%)', pointerEvents: 'none', animation: 'glow-breathe 5s ease-in-out infinite' }} />

      <div style={{ maxWidth: 560, margin: '0 auto', position: 'relative' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
        >
          {/* Card */}
          <div style={{ background: '#0A1526', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 0 80px rgba(201,168,76,0.08), 0 32px 80px rgba(0,0,0,0.4)', position: 'relative' }}>
            {/* Gold top line */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.7), transparent)' }} />

            <div style={{ padding: '40px 44px' }}>
              {/* Badge */}
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#000', background: '#C9A84C', padding: '4px 14px', borderRadius: 100 }}>Beta Founding Pricing</span>
              </div>

              {/* Price */}
              <div style={{ textAlign: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.50)', marginTop: 10 }}>$</span>
                  <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>197</span>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 10 }}>
                    <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.50)', fontWeight: 400 }}>/month</span>
                    <span style={{ fontSize: 12, color: '#C9A84C', fontWeight: 700 }}>locked forever</span>
                  </div>
                </div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                  <span style={{ textDecoration: 'line-through', textDecorationColor: 'rgba(255,80,80,0.6)' }}>$297/mo</span>
                  <span style={{ marginLeft: 8 }}>standard rate after beta closes</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '28px 0' }} />

              {/* Included */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>Included today</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 16px' }}>
                  {included.map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                      <span style={{ color: '#00C47B', fontWeight: 700, marginTop: 1, flexShrink: 0 }}>✓</span>
                      <span style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coming soon */}
              <div style={{ background: 'rgba(201,168,76,0.05)', border: '1px dashed rgba(201,168,76,0.20)', borderRadius: 10, padding: '16px 18px', marginBottom: 28 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 12 }}>Coming soon — included free</div>
                {comingSoon.map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 7 }}>
                    <span style={{ color: 'rgba(201,168,76,0.60)', flexShrink: 0 }}>◦</span>
                    <span style={{ color: 'rgba(255,255,255,0.50)' }}>{item}</span>
                  </div>
                ))}
              </div>

              {/* Form */}
              {!done ? (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required
                    style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.35)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <input
                    type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
                    style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.35)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <button
                    type="submit" disabled={loading}
                    style={{ width: '100%', padding: '15px', background: '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.target.style.background = '#00d986'; e.target.style.boxShadow = '0 10px 32px rgba(0,196,123,0.40)'; }}
                    onMouseLeave={e => { e.target.style.background = '#00C47B'; e.target.style.boxShadow = 'none'; }}
                  >
                    {loading ? 'Redirecting...' : 'Lock In $197/Month Forever →'}
                  </button>
                </form>
              ) : (
                <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.28)', borderRadius: 10, padding: '18px', fontSize: 15, color: '#00C47B', fontWeight: 600, textAlign: 'center' }}>
                  You're in. We'll reach out within 24 hours.
                </div>
              )}

              <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 14 }}>
                First 50 operators only. Rate never changes.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
