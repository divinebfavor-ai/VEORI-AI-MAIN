import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'
import { useState } from 'react'

const WAVE_BG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Dh2N4HpfmHr3sqVUsWx08TjMB3/hf_20260520_153328_75be9237-41b1-40b5-a52e-6b75731a7c61.png'
const APP_URL = 'https://veori.net'

export default function FinalCTA() {
  const { ref, visible } = useReveal()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  // Hand off to the in-app billing page (?plan= auto-launches live checkout).
  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true)
    const q = new URLSearchParams({ plan: 'starter', name, email }).toString()
    window.location.href = `${APP_URL}/billing?${q}`
  }

  const hasWave = WAVE_BG !== '__WAVE_IMAGE_URL__'

  return (
    <section style={{ position: 'relative', padding: '120px 24px', overflow: 'hidden', textAlign: 'center' }}>
      {/* Wave background */}
      {hasWave && (
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${WAVE_BG})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.25 }} />
      )}
      {/* Fallback gradient */}
      <div style={{ position: 'absolute', inset: 0, background: hasWave ? 'rgba(6,14,26,0.75)' : 'radial-gradient(ellipse 100% 80% at 50% 50%, rgba(0,196,123,0.07) 0%, rgba(6,14,26,0) 70%)' }} />

      {/* Gold glow */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.10) 0%, transparent 70%)', pointerEvents: 'none', animation: 'glow-breathe 4s ease-in-out infinite' }} />

      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 28 }}
        animate={visible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
        style={{ position: 'relative', maxWidth: 520, margin: '0 auto' }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 18 }}>Get started</div>

        <h2 style={{ fontSize: 'clamp(32px,5vw,56px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.06, marginBottom: 18 }}>
          Put VEORI to work<br />on your deals
        </h2>

        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, marginBottom: 40 }}>
          Plans start at <strong style={{ color: '#00C47B' }}>$1,499/month.</strong><br />
          Every plan includes every feature. Cancel anytime.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto' }}>
          <input
            type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'}
          />
          <input
            type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'}
          />
          <button
            type="submit" disabled={loading}
            style={{ width: '100%', padding: '15px', background: '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.target.style.background = '#00d986'; e.target.style.boxShadow = '0 12px 36px rgba(0,196,123,0.42)'; e.target.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.target.style.background = '#00C47B'; e.target.style.boxShadow = 'none'; e.target.style.transform = ''; }}
          >
            {loading ? 'Redirecting...' : 'Start at $1,499/Month →'}
          </button>
          <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>
            Questions? <a href="mailto:divinebfavor@gmail.com" style={{ color: 'rgba(255,255,255,0.48)', textDecoration: 'underline', textUnderlineOffset: 3 }}>divinebfavor@gmail.com</a>
          </p>
        </form>
      </motion.div>
    </section>
  )
}
