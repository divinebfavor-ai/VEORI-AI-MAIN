import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef, useState, useEffect, useId } from 'react'
import { useNavigate } from 'react-router-dom'

const HERO_BG   = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Dh2N4HpfmHr3sqVUsWx08TjMB3/hf_20260520_150728_06f1619c-4b3c-49f4-bd6b-511027068f8b.png'
const WAVE_BG   = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Dh2N4HpfmHr3sqVUsWx08TjMB3/hf_20260520_153328_75be9237-41b1-40b5-a52e-6b75731a7c61.png'
const API_URL   = 'https://veori-ai-main-production.up.railway.app/api/billing'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useReveal() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, visible }
}

function PulseDot() {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 8, height: 8 }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#00C47B', animation: 'lp-pulse-ring 1.8s ease-out infinite', transform: 'scale(1)', opacity: 0 }} />
      <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: '#00C47B' }} />
    </span>
  )
}

function VeoriLogo({ size = 32 }) {
  const id = useId().replace(/:/g, '')
  const cx = size / 2
  const cy = size / 2
  const rectSize = size * 0.74
  const x = (size - rectSize) / 2
  const rx = rectSize * 0.243
  const sw = size * 0.054
  const dotR = size * 0.065
  const dotGlowR = size * 0.13

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`clip-${id}`}><circle cx={cx} cy={cy} r={size * 0.485}/></clipPath>
        <filter id={`gd-${id}`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={size * 0.015} result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={size / 2} fill="#050A14"/>
      <g clipPath={`url(#clip-${id})`} transform={`rotate(20, ${cx}, ${cy})`}>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} ry={rx}
          stroke="#00C37A" strokeWidth={sw} fill="none"
          transform={`rotate(30, ${cx}, ${cy})`}/>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} ry={rx}
          stroke="#C9A84C" strokeWidth={sw} fill="none"
          transform={`rotate(-30, ${cx}, ${cy})`}/>
      </g>
      <circle cx={cx} cy={cy} r={dotGlowR} fill="white" filter={`url(#gd-${id})`}/>
      <circle cx={cx} cy={cy} r={dotR} fill="#00C37A"/>
    </svg>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  return (
    <motion.nav
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 64,
        background: scrolled ? 'rgba(6,14,26,0.92)' : 'rgba(6,14,26,0.60)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        boxShadow: scrolled ? '0 8px 40px rgba(0,0,0,0.5)' : 'none',
        transition: 'all 0.35s ease',
      }}
    >
      <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <VeoriLogo size={32} />
        <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff', fontFamily: 'Inter,sans-serif' }}>VEORI</span>
      </a>

      <ul style={{ listStyle: 'none', display: 'flex', gap: 4, margin: 0, padding: 0 }}>
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing']].map(([label, href]) => (
          <li key={label}>
            <a href={href} style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.48)', textDecoration: 'none', padding: '6px 12px', borderRadius: 7, display: 'block', transition: 'color 0.2s' }}
              onMouseEnter={e => e.target.style.color = '#fff'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.48)'}
            >{label}</a>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => navigate('/login')}
          style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.70)', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.20)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.70)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >Log in</button>
        <a href="#pricing" style={{ fontSize: 13.5, fontWeight: 700, color: '#000', background: '#00C47B', padding: '7px 18px', borderRadius: 8, textDecoration: 'none', transition: 'all 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,196,123,0.38)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none'; }}
        >Get founding access</a>
      </div>
    </motion.nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const bgY    = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const textY  = useTransform(scrollYProgress, [0, 1], ['0%', '18%'])
  const opacityVal = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  const [name, setName]     = useState('')
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]     = useState(false)
  const [spots, setSpots]   = useState(50)

  useEffect(() => {
    let c = 50; const t = setInterval(() => { if (c > 38) { c--; setSpots(c) } else clearInterval(t) }, 80)
    return () => clearInterval(t)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, plan: 'founding' }) })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
    } catch {}
    setLoading(false); setDone(true)
  }

  return (
    <section ref={ref} style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <motion.div style={{ position: 'absolute', inset: '-10%', y: bgY, backgroundImage: `url(${HERO_BG})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(6,14,26,0.55) 0%, rgba(6,14,26,0.72) 60%, rgba(6,14,26,0.92) 100%)' }} />
      <div className="lp-grid" style={{ position: 'absolute', inset: 0, opacity: 0.6 }} />
      <div style={{ position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)', width: 800, height: 500, background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.09) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 4s ease-in-out infinite' }} />

      <motion.div style={{ position: 'relative', zIndex: 10, y: textY, opacity: opacityVal, textAlign: 'center', padding: '140px 24px 80px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease: [0.22,1,0.36,1] }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 11, marginBottom: 32 }}>
          <VeoriLogo size={44} />
          <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.05em', color: '#fff', fontFamily: 'Inter,sans-serif' }}>VEORI</span>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2, ease: [0.22,1,0.36,1] }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.22)', borderRadius: 100, padding: '6px 16px', marginBottom: 36 }}>
          <PulseDot />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#00C47B', letterSpacing: '0.01em', fontFamily: 'Inter,sans-serif' }}>Accepting first 50 founding operators</span>
        </motion.div>

        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.32, ease: [0.22,1,0.36,1] }}
          style={{ fontSize: 'clamp(44px,7vw,80px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.04, marginBottom: 22, fontFamily: 'Inter,sans-serif' }}>
          Your AI VA That<br />
          <span className="lp-shimmer">Never Stops Calling</span>
        </motion.h1>

        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.42, ease: [0.22,1,0.36,1] }}
          style={{ fontSize: 'clamp(16px,1.8vw,19px)', color: 'rgba(255,255,255,0.72)', lineHeight: 1.68, maxWidth: 600, margin: '0 auto 48px', fontFamily: 'Inter,sans-serif' }}>
          VEORI calls your sellers, qualifies them, makes offers, calls your buyers, sends contracts for e-sign, coordinates your title company, and closes the deal. All automatically. 24/7.{' '}
          Beta founding operators lock in <strong style={{ color: '#C9A84C' }}>$197/month forever.</strong>
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.52, ease: [0.22,1,0.36,1] }} style={{ maxWidth: 480, margin: '0 auto' }}>
          {!done ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required
                style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.4)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'} />
              <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
                style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.4)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'} />
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '15px', background: loading ? 'rgba(0,196,123,0.7)' : '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, border: 'none', borderRadius: 10, cursor: loading ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif', letterSpacing: '-0.01em', transition: 'all 0.2s' }}
                onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(0,196,123,0.40)' }}}
                onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
                {loading ? 'Redirecting to checkout...' : 'Join Beta at $197/mo Locked Forever →'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12.5, color: 'rgba(255,255,255,0.35)', marginTop: 2, fontFamily: 'Inter,sans-serif' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', display: 'inline-block' }} />
                <span><strong style={{ color: 'rgba(255,255,255,0.50)' }}>{spots}</strong> founding spots remaining of 50</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', display: 'inline-block' }} />
              </div>
            </form>
          ) : (
            <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.28)', borderRadius: 14, padding: '24px 28px', fontSize: 16, color: '#00C47B', fontWeight: 600, fontFamily: 'Inter,sans-serif' }}>
              You're in. We'll reach out within 24 hours to get you set up.
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.9 }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, flexWrap: 'wrap', marginTop: 56, padding: '20px 32px', borderRadius: 14, background: 'rgba(10,21,38,0.70)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)', maxWidth: 640, margin: '56px auto 0' }}>
          {[['AI calls / day', '500', '#00C47B'], ['Seller to e-sign', '4 min', '#fff'], ['Sides worked', 'Both', '#C9A84C'], ['Human required', 'Zero', '#fff']].map(([label, value, color], i) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 600, color, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)', fontFamily: 'Inter,sans-serif' }}>{label}</div>
              {i < 3 && <div style={{ position: 'absolute' }} />}
            </div>
          ))}
        </motion.div>
      </motion.div>

      <div style={{ position: 'absolute', bottom: 32, left: '50%', animation: 'lp-float 2.5s ease-in-out infinite', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', fontFamily: 'Inter,sans-serif' }}>Scroll</div>
        <div style={{ width: 1, height: 32, background: 'linear-gradient(to bottom, rgba(0,196,123,0.6), transparent)' }} />
      </div>
    </section>
  )
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

const TICK_EVENTS = [
  { label: 'Lead qualified', value: 'Score 91', city: 'Dallas TX' },
  { label: 'AI call completed', value: '2m 14s', city: 'Atlanta GA' },
  { label: 'Offer sent', value: '$142,000', city: 'Houston TX' },
  { label: 'Seller motivated', value: 'Score 96', city: 'Phoenix AZ' },
  { label: 'Contract generated', value: '3m 48s', city: 'Miami FL' },
  { label: 'Offer accepted', value: '+$21,400', city: 'Tampa FL' },
  { label: 'Lead qualified', value: 'Score 84', city: 'Memphis TN' },
  { label: 'Follow-up scheduled', value: '30 days', city: 'Charlotte NC' },
]
const DOUBLED = [...TICK_EVENTS, ...TICK_EVENTS]

function Ticker() {
  return (
    <div style={{ overflow: 'hidden', padding: '14px 0', background: 'rgba(0,196,123,0.04)', borderTop: '1px solid rgba(0,196,123,0.08)', borderBottom: '1px solid rgba(0,196,123,0.08)' }}>
      <div className="lp-ticker" style={{ display: 'flex', width: 'max-content' }}>
        {DOUBLED.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 36px', fontSize: 12.5, color: 'rgba(255,255,255,0.40)', whiteSpace: 'nowrap', fontFamily: 'Inter,sans-serif' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00C47B', flexShrink: 0 }} />
            <span>{e.label}</span>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{e.value}</span>
            <span style={{ color: 'rgba(255,255,255,0.28)' }}>{e.city}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── What You Get ─────────────────────────────────────────────────────────────

const FEATURES = [
  { title: 'AI Calls Sellers and Buyers', body: 'Upload your seller list and VEORI calls every one automatically. Upload your buyer list and VEORI calls them too. Natural conversations on both sides. No robotic scripts.', icon: 'phone' },
  { title: 'Qualifies Both Sides', body: 'Every seller call is scored 0 to 100 for motivation. Every buyer is qualified for criteria, budget, and timeline. VEORI surfaces who is ready to move on both ends of the deal.', icon: 'activity' },
  { title: 'Makes and Presents Offers', body: 'VEORI makes cash offers to sellers based on your criteria. When a deal is locked, it presents the opportunity to buyers in your network. Confident, consistent pitches every time.', icon: 'briefcase' },
  { title: 'E-Sign and Contract Delivery', body: 'Contracts are generated and sent for e-signature automatically the moment a seller agrees. Once signed, VEORI sends the contract to your agent without you touching a thing.', icon: 'file' },
  { title: 'Title Company Coordination', body: 'Book your preferred title company inside VEORI. The AI calls them, delivers the contract, follows up on the schedule, and tracks the closing. You stay out of the admin loop.', icon: 'home' },
  { title: 'Property Photo Requests', body: 'VEORI automatically requests property photos from sellers during or after a call. Photos are stored directly in your deal dashboard alongside call recordings and notes.', icon: 'image' },
  { title: '24/7 Operation', body: 'Works while you sleep. No time zones, no weekends off, no sick days. Calls happen around the clock across your full pipeline: sellers, buyers, and title. Without you touching it.', icon: 'clock' },
  { title: 'Full Deal CRM', body: 'Every call recording, motivation score, transcript, photo, contract, and status update lives in one dashboard. Your entire pipeline from first contact to closing, visible in one place.', icon: 'grid' },
]

const ICONS = {
  phone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.88a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  activity: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  briefcase: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  file: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  image: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  clock: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  grid: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
}

function FeatureCard({ f, index }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, delay: index * 0.07, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
      style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.06)', borderLeft: '2px solid #00C47B', borderRadius: 14, padding: '28px 26px', cursor: 'default' }}>
      <div style={{ marginBottom: 16 }}>{ICONS[f.icon]}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: '#fff', letterSpacing: '-0.02em', fontFamily: 'Inter,sans-serif' }}>{f.title}</div>
      <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.50)', lineHeight: 1.68, fontFamily: 'Inter,sans-serif' }}>{f.body}</div>
    </motion.div>
  )
}

function WhatYouGet() {
  const { ref, visible } = useReveal()
  return (
    <section id="platform" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      <div className="lp-grid" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>What you get today</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>
            From first call to closed deal.<br />All of it. Automated.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.52)', maxWidth: 560, lineHeight: 1.65, marginBottom: 56, fontFamily: 'Inter,sans-serif' }}>
            VEORI doesn't just call sellers. It works both sides of every deal: sellers, buyers, agents, and title companies. From first contact to closing.
          </p>
        </motion.div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16 }}>
          {FEATURES.map((f, i) => <FeatureCard key={f.title} f={f} index={i} />)}
        </div>
      </div>
    </section>
  )
}

// ─── Comparison ───────────────────────────────────────────────────────────────

const HUMAN_ROWS = [
  { label: 'Cost', value: '$1,500/month', bad: true },
  { label: 'Availability', value: '8 hours/day', bad: true },
  { label: 'Consistency', value: 'Varies daily', bad: true },
  { label: 'Sick days', value: 'Yes', bad: true },
  { label: 'Training required', value: 'Always', bad: true },
  { label: 'Quits after 6 months', value: 'Usually', bad: true },
  { label: 'Calls per day', value: '80 to 120', bad: true },
]
const VEORI_ROWS = [
  { label: 'Cost', value: '$197/month', good: true },
  { label: 'Availability', value: '24/7/365', good: true },
  { label: 'Consistency', value: 'Perfect every call', good: true },
  { label: 'Sick days', value: 'Never', good: true },
  { label: 'Training required', value: 'None', good: true },
  { label: 'Quits', value: 'Never', good: true },
  { label: 'Calls per day', value: '500', good: true },
]

function SideCard({ title, rows, highlighted, delay = 0 }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div ref={ref} initial={{ opacity: 0, x: highlighted ? 24 : -24 }} animate={visible ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22,1,0.36,1] }}
      style={{ flex: 1, background: highlighted ? 'linear-gradient(160deg, rgba(0,196,123,0.08), rgba(0,196,123,0.03))' : 'rgba(255,255,255,0.015)', border: highlighted ? '1px solid rgba(0,196,123,0.28)' : '1px solid rgba(255,255,255,0.05)', borderRadius: 16, overflow: 'hidden', opacity: highlighted ? 1 : 0.55, transition: 'opacity 0.3s' }}
      whileHover={{ opacity: 1, transition: { duration: 0.2 } }}>
      <div style={{ padding: '20px 26px', borderBottom: `1px solid ${highlighted ? 'rgba(0,196,123,0.16)' : 'rgba(255,255,255,0.05)'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        {highlighted && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C47B', position: 'relative' }}><div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: 'rgba(0,196,123,0.3)', animation: 'lp-pulse-ring 2s ease-out infinite' }} /></div>}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: highlighted ? '#00C47B' : 'rgba(255,255,255,0.50)', textTransform: 'uppercase', fontFamily: 'Inter,sans-serif' }}>{title}</div>
      </div>
      {rows.map((row, i) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 26px', borderBottom: i < rows.length - 1 ? `1px solid ${highlighted ? 'rgba(0,196,123,0.08)' : 'rgba(255,255,255,0.04)'}` : 'none' }}>
          <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter,sans-serif' }}>{row.label}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: row.good ? '#00C47B' : row.bad ? 'rgba(255,80,80,0.75)' : '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{row.value}</span>
        </div>
      ))}
    </motion.div>
  )
}

function Comparison() {
  const { ref, visible } = useReveal()
  return (
    <section style={{ padding: '100px 24px', background: 'rgba(255,255,255,0.012)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }} style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>The math</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,44px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>
            Same result. Better consistency.<br />$1,303 less per month.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', maxWidth: 460, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            A human VA costs more, works less, and quits eventually. VEORI doesn't.
          </p>
        </motion.div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <SideCard title="Human VA" rows={HUMAN_ROWS} highlighted={false} delay={0.05} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 28, padding: '20px 0' }}>
            <div style={{ width: 1, flex: 1, background: 'linear-gradient(to bottom, transparent, rgba(0,196,123,0.6), transparent)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: '#00C47B', boxShadow: '0 0 12px rgba(0,196,123,0.7)', animation: 'lp-pulse-ring 2s ease-out infinite' }} />
            </div>
          </div>
          <SideCard title="VEORI AI" rows={VEORI_ROWS} highlighted={true} delay={0.12} />
        </div>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const STEPS = [
  { num: '01', title: 'Pay $197 today', body: 'Lock in founding operator pricing permanently. Standard pricing is $297/month after beta closes. Your rate never changes.' },
  { num: '02', title: 'Account activates in 48 hours', body: 'Create your own login inside the VEORI platform. We send you a setup link. No waiting on someone to manually onboard you.' },
  { num: '03', title: 'Upload your seller list', body: 'Drop in a CSV with your leads. Names, numbers, addresses. VEORI starts calling automatically. Natural conversations, handles objections, scores every seller 0 to 100.' },
  { num: '04', title: 'VEORI qualifies and makes offers', body: 'Hot sellers are flagged by motivation score. VEORI makes cash offers based on your criteria. Consistent pitch every time. No variance, no emotion, just execution.' },
  { num: '05', title: 'Contract sent for e-sign automatically', body: 'The moment a seller agrees, VEORI generates the contract and sends it for e-signature. Once signed, it forwards it directly to your agent. No manual steps.' },
  { num: '06', title: 'Upload your buyer list', body: 'VEORI calls your buyers, qualifies them for budget, criteria, and timeline, then presents the deal. Both sides worked. Both sides qualified. All automated.' },
  { num: '07', title: 'Title company booked and called', body: 'Select your preferred title company inside VEORI. The AI calls them, delivers the contract, follows up on schedule, and tracks every step through to closing.' },
  { num: '08', title: 'Deal closes. You collect.', body: 'VEORI managed the full cycle. You reviewed the dashboard. That is the only job you had. Scale by uploading more lists.' },
]

function Step({ step, index }) {
  const { ref, visible } = useReveal()
  const isLast = index === STEPS.length - 1
  return (
    <div ref={ref} style={{ display: 'flex', gap: 24, position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 52 }}>
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={visible ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22,1,0.36,1] }}
          style={{ width: 52, height: 52, borderRadius: '50%', border: '1px solid rgba(201,168,76,0.30)', background: 'rgba(201,168,76,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: '#C9A84C', flexShrink: 0, zIndex: 2 }}>
          {step.num}
        </motion.div>
        {!isLast && (
          <motion.div initial={{ scaleY: 0, opacity: 0 }} animate={visible ? { scaleY: 1, opacity: 1 } : {}}
            transition={{ duration: 0.9, delay: index * 0.06 + 0.3, ease: 'easeOut' }}
            style={{ width: 1, flex: 1, minHeight: 32, background: 'linear-gradient(to bottom, rgba(0,196,123,0.5), rgba(0,196,123,0.06))', marginTop: 8, transformOrigin: 'top' }} />
        )}
      </div>
      <motion.div initial={{ opacity: 0, x: 16 }} animate={visible ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.6, delay: index * 0.06 + 0.08, ease: [0.22,1,0.36,1] }}
        style={{ paddingBottom: isLast ? 0 : 44, paddingTop: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.025em', color: '#fff', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{step.title}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.50)', lineHeight: 1.70, maxWidth: 480, fontFamily: 'Inter,sans-serif' }}>{step.body}</div>
      </motion.div>
    </div>
  )
}

function HowItWorks() {
  const { ref, visible } = useReveal()
  return (
    <section id="how" style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }} style={{ marginBottom: 64 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>How it works</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>
            Seller to buyer to signed.<br />VEORI runs the whole thing.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            From first outbound call to closed title. Eight steps. Your only job is to review the dashboard.
          </p>
        </motion.div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {STEPS.map((s, i) => <Step key={s.num} step={s} index={i} />)}
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const FOUNDING_ITEMS = [
  '500 AI calls/month (sellers and buyers)',
  'Real-time motivation scoring (0 to 100)',
  'Automated offer delivery to sellers',
  'Buyer list calling and qualification',
  'E-sign and automatic agent delivery',
  'Title company booking and follow-up',
  'Property photo requests',
  'Full CRM dashboard with recordings',
  '24/7 automated operation',
  'Rate locked permanently',
  'All future features, no upgrade fees',
]

const OTHER_PLANS = [
  { name: 'Standard', price: '$297', cycle: '/month', note: 'After beta closes', calls: '500 AI calls/month', features: ['500 AI calls/month', 'Seller and buyer calling', 'Motivation scoring', 'E-sign and agent delivery', 'Title company coordination', 'Full CRM dashboard'] },
  { name: 'Grind', price: '$697', cycle: '/month', note: 'Most popular at scale', calls: '2,000 AI calls/month', features: ['2,000 AI calls/month', 'All Standard features', 'Advanced scoring model', 'Multi-list management', 'Priority support'] },
  { name: 'Empire', price: '$1,497', cycle: '/month', note: 'Multi-market operators', calls: '5,000 AI calls/month', features: ['5,000 AI calls/month', 'All Grind features', 'Multi-market campaigns', 'Dedicated success manager', 'Custom integrations'] },
  { name: 'Dynasty', price: '$4,997', cycle: '/month', note: 'Enterprise operations', calls: '15,000 AI calls/month', features: ['15,000 AI calls/month', 'All Empire features', 'White-label option', 'SLA guarantee', 'Custom build-outs'] },
]

function WaitlistModal({ plan, onClose }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [loading, setLoading] = useState(false)
  async function handleSubmit(e) {
    e.preventDefault(); if (!name.trim() || !email.includes('@')) return; setLoading(true)
    try { await fetch(`${API_URL}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, plan: plan.name.toLowerCase(), type: 'waitlist' }) }) } catch {}
    setLoading(false); setDone(true)
  }
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,10,20,0.88)', backdropFilter: 'blur(14px)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.35, ease: [0.22,1,0.36,1] }}
        style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '40px 36px', maxWidth: 420, width: '100%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }} onMouseEnter={e => e.target.style.color = '#fff'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>&times;</button>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 10, fontFamily: 'Inter,sans-serif' }}>Join the waitlist</div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>{plan.name} Plan</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{plan.price}/month. {plan.calls}.<br />We'll reach out when this plan opens.</div>
        {!done ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 15, fontWeight: 700, borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }} onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.10)' }} onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.06)' }}>{loading ? 'Saving...' : `Join ${plan.name} Waitlist →`}</button>
          </form>
        ) : (
          <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', borderRadius: 10, padding: '18px', fontSize: 15, color: '#00C47B', fontWeight: 600, textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>You're on the list. We'll reach out when {plan.name} opens.</div>
        )}
      </motion.div>
    </div>
  )
}

function Pricing() {
  const { ref, visible } = useReveal()
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [loading, setLoading] = useState(false); const [done, setDone] = useState(false); const [waitlistPlan, setWaitlistPlan] = useState(null)
  async function handleSubmit(e) {
    e.preventDefault(); if (!name.trim() || !email.includes('@')) return; setLoading(true)
    try { const res = await fetch(`${API_URL}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, plan: 'founding' }) }); const data = await res.json(); if (data.url) { window.location.href = data.url; return } } catch {}
    setLoading(false); setDone(true)
  }
  return (
    <section id="pricing" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      {waitlistPlan && <WaitlistModal plan={waitlistPlan} onClose={() => setWaitlistPlan(null)} />}
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 500, background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.06) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 5s ease-in-out infinite' }} />
      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }} style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>Pricing</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>Simple. No surprises.</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>Founding operators lock in $197/month permanently. All other plans open when beta closes.</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
          style={{ background: '#0A1526', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 0 80px rgba(201,168,76,0.07), 0 32px 80px rgba(0,0,0,0.35)', position: 'relative', marginBottom: 20 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.7), transparent)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div style={{ padding: '40px 44px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#000', background: '#C9A84C', padding: '4px 14px', borderRadius: 100, marginBottom: 24, fontFamily: 'Inter,sans-serif' }}>Founding · Beta Only</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginTop: 10, fontFamily: 'Inter,sans-serif' }}>$</span>
                <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, fontFamily: 'Inter,sans-serif' }}>197</span>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 12 }}>
                  <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter,sans-serif' }}>/month</span>
                  <span style={{ fontSize: 12, color: '#C9A84C', fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>locked forever</span>
                </div>
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.32)', marginBottom: 28, fontFamily: 'Inter,sans-serif' }}>
                <span style={{ textDecoration: 'line-through', textDecorationColor: 'rgba(255,80,80,0.5)' }}>$297/mo</span>
                <span style={{ marginLeft: 8 }}>standard rate after beta</span>
              </div>
              {!done ? (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
                  <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
                  <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', background: '#00C47B', color: '#000', fontSize: 15, fontWeight: 800, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 10px 32px rgba(0,196,123,0.40)' }} onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none' }}>{loading ? 'Redirecting...' : 'Lock In $197/Month Forever →'}</button>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 2, textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>First 50 operators only. Rate never changes.</p>
                </form>
              ) : (
                <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', borderRadius: 10, padding: '18px', fontSize: 15, color: '#00C47B', fontWeight: 600, textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>You're in. We'll reach out within 24 hours.</div>
              )}
            </div>
            <div style={{ padding: '40px 44px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 20, fontFamily: 'Inter,sans-serif' }}>Everything included</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {FOUNDING_ITEMS.map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <span style={{ color: '#00C47B', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.4, fontFamily: 'Inter,sans-serif' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', textAlign: 'center', marginBottom: 20, fontFamily: 'Inter,sans-serif' }}>Other plans, join the waitlist</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {OTHER_PLANS.map((plan, i) => (
              <OtherPlanCard key={plan.name} plan={plan} index={i} onWaitlist={setWaitlistPlan} />
            ))}
          </div>
        </div>
        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(255,255,255,0.25)', marginTop: 24, fontFamily: 'Inter,sans-serif' }}>
          All plans billed monthly. Cancel anytime. Founding operator rate ($197/month) is locked permanently and never increases.
        </motion.p>
      </div>
    </section>
  )
}

// ─── OtherPlanCard — extracts hook out of map loop ───────────────────────────
function OtherPlanCard({ plan, index, onWaitlist }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div key={plan.name} ref={ref} initial={{ opacity: 0, y: 24 }} animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -3, transition: { duration: 0.22 } }}
      style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{plan.note}</div>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>{plan.name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.04em', fontFamily: 'Inter,sans-serif' }}>{plan.price}</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', fontFamily: 'Inter,sans-serif' }}>{plan.cycle}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#00C47B', fontWeight: 600, marginBottom: 20, fontFamily: 'Inter,sans-serif' }}>{plan.calls}</div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 18, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {plan.features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'rgba(0,196,123,0.7)', flexShrink: 0, marginTop: 1 }}>✓</span>
            <span style={{ color: 'rgba(255,255,255,0.60)', fontFamily: 'Inter,sans-serif' }}>{f}</span>
          </div>
        ))}
      </div>
      <button onClick={() => onWaitlist(plan)}
        style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.80)', fontSize: 14, fontWeight: 700, borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.80)' }}>
        Join Waitlist →
      </button>
    </motion.div>
  )
}

// ─── ComingSoonCard — extracts hook out of map loop ──────────────────────────
function ComingSoonCard({ item, index }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 24 }} animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.09, ease: [0.22,1,0.36,1] }}
      style={{ background: 'rgba(201,168,76,0.03)', border: '1px dashed rgba(201,168,76,0.22)', borderRadius: 14, padding: '26px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {item.icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#C9A84C', background: 'rgba(201,168,76,0.10)', padding: '3px 9px', borderRadius: 100, fontFamily: 'Inter,sans-serif' }}>Coming Soon</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10, color: '#fff', fontFamily: 'Inter,sans-serif' }}>{item.title}</div>
      <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>{item.body}</div>
    </motion.div>
  )
}

// ─── Coming Soon ──────────────────────────────────────────────────────────────

const COMING_SOON = [
  { title: 'Automatic Lead Sourcing', body: 'VEORI pulls motivated sellers directly from county public records. Distressed, pre-foreclosure, probate, absentee. No manual searching.', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
  { title: 'Expired Listing Auto-Contact', body: 'VEORI detects expired MLS listings and reaches out within 60 minutes. Before any other investor gets there.', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { title: 'Buyer Matching and Deal Automation', body: 'VEORI matches your contracts to buyers in your network automatically. Assignment fees calculated. Deals move without you coordinating manually.', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { title: 'Contract Generation in 4 Minutes', body: 'The moment a seller agrees, VEORI drafts, populates, and sends a compliant contract. No delays. No lost deals.', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
]

function ComingSoon() {
  const { ref, visible } = useReveal()
  return (
    <section style={{ padding: '100px 24px', background: 'rgba(255,255,255,0.012)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }} style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>Coming soon</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,42px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.1, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>
            The roadmap is already built.<br />Founding operators get it all free.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            These features are in active development. Every founding operator gets them automatically at no extra cost.
          </p>
        </motion.div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          {COMING_SOON.map((item, i) => (
            <ComingSoonCard key={item.title} item={item} index={i} />
          ))}
        </div>
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.4 }}
          style={{ textAlign: 'center', marginTop: 40, fontSize: 14, color: 'rgba(255,255,255,0.38)', fontFamily: 'Inter,sans-serif' }}>
          Founding operators get every future feature unlocked automatically. <strong style={{ color: '#C9A84C' }}>No upgrade fees. Ever.</strong>
        </motion.div>
      </div>
    </section>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTA() {
  const { ref, visible } = useReveal()
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [loading, setLoading] = useState(false); const [done, setDone] = useState(false)
  async function handleSubmit(e) {
    e.preventDefault(); if (!name.trim() || !email.includes('@')) return; setLoading(true)
    try { const res = await fetch(`${API_URL}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, plan: 'founding' }) }); const data = await res.json(); if (data.url) { window.location.href = data.url; return } } catch {}
    setLoading(false); setDone(true)
  }
  return (
    <section style={{ position: 'relative', padding: '120px 24px', overflow: 'hidden', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${WAVE_BG})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.25 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,14,26,0.75)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.10) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 4s ease-in-out infinite' }} />
      <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }} style={{ position: 'relative', maxWidth: 520, margin: '0 auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 18, fontFamily: 'Inter,sans-serif' }}>Last call</div>
        <h2 style={{ fontSize: 'clamp(32px,5vw,56px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.06, marginBottom: 18, fontFamily: 'Inter,sans-serif' }}>Lock In Founding<br />Operator Pricing</h2>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, marginBottom: 40, fontFamily: 'Inter,sans-serif' }}>
          Join the first 50. <strong style={{ color: '#C9A84C' }}>$197/month forever.</strong><br />
          When the spots are gone, standard pricing is $297/month.
        </p>
        {!done ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto' }}>
            <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'} />
            <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '13px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.10)'} />
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '15px', background: '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(0,196,123,0.42)'; e.currentTarget.style.transform = 'translateY(-1px)' }} onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = '' }}>{loading ? 'Redirecting...' : 'Lock In $197/Month Forever →'}</button>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.30)', marginTop: 4, fontFamily: 'Inter,sans-serif' }}>
              Questions? <a href="mailto:divinebfavor@gmail.com" style={{ color: 'rgba(255,255,255,0.48)', textDecoration: 'underline', textUnderlineOffset: 3 }}>divinebfavor@gmail.com</a>
            </p>
          </form>
        ) : (
          <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.28)', borderRadius: 14, padding: '28px', fontSize: 16, color: '#00C47B', fontWeight: 600, maxWidth: 400, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
            You're in. We'll reach out within 24 hours to get you set up.
          </div>
        )}
      </motion.div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '36px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <VeoriLogo size={28} />
        <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff', fontFamily: 'Inter,sans-serif' }}>VEORI</span>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', gap: 22, flexWrap: 'wrap', margin: 0, padding: 0 }}>
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing'], ['Contact', 'mailto:divinebfavor@gmail.com']].map(([label, href]) => (
          <li key={label}><a href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s', fontFamily: 'Inter,sans-serif' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.70)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>{label}</a></li>
        ))}
        <li><a href="/terms" style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s', fontFamily: 'Inter,sans-serif' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.70)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>Terms</a></li>
        <li><a href="/privacy" style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s', fontFamily: 'Inter,sans-serif' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.70)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>Privacy</a></li>
      </ul>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>© 2026 VEORI AI. All rights reserved.</div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="lp-body">
      <LandingNav />
      <Hero />
      <Ticker />
      <WhatYouGet />
      <Comparison />
      <HowItWorks />
      <Pricing />
      <ComingSoon />
      <FinalCTA />
      <Footer />
    </div>
  )
}
