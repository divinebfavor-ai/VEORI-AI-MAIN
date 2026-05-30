import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef, useState, useEffect, useId } from 'react'
import { useNavigate } from 'react-router-dom'

const HERO_BG   = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Dh2N4HpfmHr3sqVUsWx08TjMB3/hf_20260520_150728_06f1619c-4b3c-49f4-bd6b-511027068f8b.png'
const WAVE_BG   = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Dh2N4HpfmHr3sqVUsWx08TjMB3/hf_20260520_153328_75be9237-41b1-40b5-a52e-6b75731a7c61.png'
const API_URL   = 'https://veori-ai-main-production.up.railway.app/api/fw-billing'

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
        >Get started</a>
      </div>
    </motion.nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const bgY        = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const textY      = useTransform(scrollYProgress, [0, 1], ['0%', '18%'])
  const opacityVal = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  return (
    <section ref={ref} style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <motion.div style={{ position: 'absolute', inset: '-10%', y: bgY, backgroundImage: `url(${HERO_BG})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(6,14,26,0.55) 0%, rgba(6,14,26,0.72) 60%, rgba(6,14,26,0.92) 100%)' }} />
      <div className="lp-grid" style={{ position: 'absolute', inset: 0, opacity: 0.6 }} />
      <div style={{ position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)', width: 800, height: 500, background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.09) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 4s ease-in-out infinite' }} />

      <motion.div style={{ position: 'relative', zIndex: 10, y: textY, opacity: opacityVal, textAlign: 'center', padding: '160px 24px 100px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* Logo centered */}
        <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 40 }}>
          <VeoriLogo size={72} />
          <span style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.06em', color: '#fff', fontFamily: 'Inter,sans-serif', lineHeight: 1 }}>VEORI</span>
        </motion.div>

        {/* AI badge */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(0,196,123,0.12)', border: '1px solid rgba(0,196,123,0.30)', borderRadius: 100, padding: '8px 20px', marginBottom: 32 }}>
          <PulseDot />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#00C47B', letterSpacing: '0.02em', fontFamily: 'Inter,sans-serif', textTransform: 'uppercase' }}>AI Operating System for Real Estate</span>
        </motion.div>

        {/* Headline */}
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.32, ease: [0.22,1,0.36,1] }}
          style={{ fontSize: 'clamp(38px,6vw,72px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.06, marginBottom: 24, fontFamily: 'Inter,sans-serif' }}>
          The AI That Calls Sellers,<br />
          <span className="lp-shimmer">Closes Deals, While You Sleep.</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.42, ease: [0.22,1,0.36,1] }}
          style={{ fontSize: 'clamp(15px,1.8vw,18px)', color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, maxWidth: 560, margin: '0 auto 52px', fontFamily: 'Inter,sans-serif' }}>
          Veori makes 3,000 AI calls a month, qualifies sellers, sends contracts, coordinates title companies and closes deals. Fully automated, 24 hours a day.
        </motion.p>

        {/* CTAs */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.52, ease: [0.22,1,0.36,1] }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a href="#pricing"
              style={{ padding: '16px 40px', background: '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, borderRadius: 12, textDecoration: 'none', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s', letterSpacing: '-0.01em' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 16px 40px rgba(0,196,123,0.45)' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
              Get Started Today
            </a>
            <a href="#how"
              style={{ padding: '16px 40px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: 700, borderRadius: 12, textDecoration: 'none', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}>
              See How It Works
            </a>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter,sans-serif' }}>
            From <strong style={{ color: 'rgba(255,255,255,0.60)' }}>$499/month</strong> · No setup fees · Cancel anytime
          </div>
        </motion.div>

        {/* Stats bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.75 }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap', marginTop: 64, borderRadius: 16, background: 'rgba(8,18,34,0.80)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)', maxWidth: 680, margin: '64px auto 0', overflow: 'hidden' }}>
          {[
            { label: 'AI Dials / Month', value: '3,000', color: '#00C47B' },
            { label: 'Saves vs VA', value: '$1,421', color: '#C9A84C' },
            { label: 'Human Required', value: 'Zero', color: '#fff' },
            { label: 'Works 24/7', value: 'Always', color: '#fff' },
          ].map(({ label, value, color }, i) => (
            <div key={label} style={{ flex: 1, minWidth: 140, padding: '22px 20px', textAlign: 'center', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <div style={{ fontFamily: 'Inter,sans-serif', fontSize: 26, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>{value}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)', fontFamily: 'Inter,sans-serif' }}>{label}</div>
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
  { label: 'Monthly cost', value: '$1,280 - $1,920', bad: true },
  { label: 'Calls per day', value: '~90 dials', bad: true },
  { label: 'Calls per week', value: '~450 dials', bad: true },
  { label: 'Calls per month', value: '~1,800 dials', bad: true },
  { label: 'Works weekends', value: 'No', bad: true },
  { label: 'Works nights', value: 'No', bad: true },
  { label: 'Consistent script', value: 'No', bad: true },
  { label: 'Gets tired / quits', value: 'Yes', bad: true },
  { label: 'Training required', value: 'Always', bad: true },
]
const VEORI_ROWS = [
  { label: 'Monthly cost', value: 'From $499/month', good: true },
  { label: 'Calls per day', value: '100+ dials', good: true },
  { label: 'Calls per week', value: '750 dials', good: true },
  { label: 'Calls per month', value: '3,000 dials', good: true },
  { label: 'Works weekends', value: 'Yes, 24/7', good: true },
  { label: 'Works nights', value: 'Yes, 24/7', good: true },
  { label: 'Consistent script', value: 'Perfect every call', good: true },
  { label: 'Gets tired / quits', value: 'Never', good: true },
  { label: 'Training required', value: 'None', good: true },
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
            More calls. Better results.<br />Up to $1,421 less per month.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', maxWidth: 520, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            A human VA makes 1,800 calls a month and costs $1,280-$1,920. Veori makes 3,000 calls for $499. Works nights. Works weekends. Never quits.
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
  { num: '01', title: 'Choose your plan', body: 'Pick the plan that fits your deal volume - from 3,000 dials/month on Starter up to 50,000 on Enterprise. Secure checkout. Account activates within 48 hours.' },
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

const PLANS = [
  { key: 'starter',    name: 'Starter',    price: 499,  dials: '3,000'  },
  { key: 'growth',     name: 'Growth',     price: 999,  dials: '7,000',  popular: true },
  { key: 'pro',        name: 'Pro',        price: 1799, dials: '15,000' },
  { key: 'scale',      name: 'Scale',      price: 2999, dials: '30,000' },
  { key: 'enterprise', name: 'Enterprise', price: 5999, dials: '50,000' },
]

const PLAN_FEATURES = [
  'AI voice calls included',
  'SMS follow-up on no answer',
  'Real-time motivation scoring',
  'Automated 3-day follow-up sequence',
  'Pipeline dashboard',
  'CRM lead management',
  'Number health monitoring',
  'Cancel anytime',
]

const FOUNDING_BONUSES = [
  'Locked at $397/month forever - price never increases',
  'Direct access to founder for product feedback',
  'Shape the product roadmap',
  'Founding Member badge on profile',
]

function FoundingMemberCard({ onSelect }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
      style={{
        background: 'linear-gradient(135deg, #0F1A0A 0%, #0A1205 100%)',
        border: '1px solid rgba(201,168,76,0.55)',
        borderRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 0 80px rgba(201,168,76,0.12), 0 0 40px rgba(201,168,76,0.06), 0 24px 64px rgba(0,0,0,0.40)',
        marginBottom: 20,
      }}>

      {/* Gold top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent 0%, #C9A84C 30%, #F0C96E 50%, #C9A84C 70%, transparent 100%)' }} />

      {/* Corner glow */}
      <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, background: 'radial-gradient(circle, rgba(201,168,76,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -40, left: -40, width: 160, height: 160, background: 'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ padding: '36px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 32 }}>

        {/* Left - pricing */}
        <div style={{ borderRight: '1px solid rgba(201,168,76,0.15)', paddingRight: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 100, padding: '4px 14px', marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', boxShadow: '0 0 8px rgba(201,168,76,0.8)', animation: 'lp-pulse-ring 2s ease-out infinite', display: 'inline-block' }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A84C', fontFamily: 'Inter,sans-serif' }}>Limited - First 20 Spots Only</span>
          </div>

          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', marginBottom: 16, fontFamily: 'Inter,sans-serif' }}>Founding Member</div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3, marginBottom: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.50)', marginTop: 8, fontFamily: 'Inter,sans-serif' }}>$</span>
            <span style={{ fontSize: 64, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, color: '#F0C96E', fontFamily: 'Inter,sans-serif' }}>397</span>
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>/month, billed monthly</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through', textDecorationColor: 'rgba(255,80,80,0.6)', fontFamily: 'Inter,sans-serif' }}>$999/mo (Growth)</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#00C47B', background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', padding: '2px 8px', borderRadius: 100, fontFamily: 'Inter,sans-serif' }}>60% off</span>
          </div>

          <div style={{ fontSize: 13, color: '#C9A84C', fontWeight: 700, marginBottom: 24, fontFamily: 'Inter,sans-serif' }}>
            7,000 dials/month
          </div>

          {/* Scarcity bar */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontFamily: 'Inter,sans-serif' }}>Spots remaining</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', fontFamily: 'Inter,sans-serif' }}>Only 20 available</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
              <div style={{ width: '70%', height: '100%', background: 'linear-gradient(90deg, #C9A84C, #F0C96E)', borderRadius: 100 }} />
            </div>
          </div>

          <button onClick={() => onSelect({ key: 'founding_member', name: 'Founding Member', price: 397, dials: '7,000' })}
            style={{ width: '100%', padding: '15px', background: 'linear-gradient(135deg, #C9A84C 0%, #F0C96E 50%, #C9A84C 100%)', backgroundSize: '200% 100%', color: '#000', fontSize: 15, fontWeight: 900, border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', letterSpacing: '-0.01em', transition: 'all 0.3s', boxShadow: '0 8px 32px rgba(201,168,76,0.35)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundPosition = '100% 0'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(201,168,76,0.55)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundPosition = '0% 0'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(201,168,76,0.35)'; e.currentTarget.style.transform = '' }}>
            Claim Your Spot →
          </button>
          <p style={{ fontSize: 11.5, color: 'rgba(201,168,76,0.55)', textAlign: 'center', marginTop: 10, fontFamily: 'Inter,sans-serif' }}>
            Rate locked forever. Cancel anytime.
          </p>
        </div>

        {/* Middle - Growth features */}
        <div style={{ borderRight: '1px solid rgba(201,168,76,0.15)', paddingRight: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 16, fontFamily: 'Inter,sans-serif' }}>Everything in Growth</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PLAN_FEATURES.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ color: '#00C47B', fontWeight: 700, flexShrink: 0, marginTop: 1, fontSize: 13 }}>✓</span>
                <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13.5, lineHeight: 1.4, fontFamily: 'Inter,sans-serif' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right - Founding bonuses */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 16, fontFamily: 'Inter,sans-serif' }}>Founding Member Bonuses</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FOUNDING_BONUSES.map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ color: '#C9A84C', fontWeight: 700, flexShrink: 0, marginTop: 1, fontSize: 14 }}>★</span>
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13.5, lineHeight: 1.4, fontFamily: 'Inter,sans-serif' }}>{b}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28, padding: '16px 20px', background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: '#C9A84C', fontWeight: 700, marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>Why founding pricing?</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
              The first 20 members help shape VEORI into the tool you actually need. In return, you get Growth plan access at 60% off - permanently.
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function CheckoutModal({ plan, onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true); setError('')
    try {
      // Redirect to register with plan pre-selected
      // After registration, billing page auto-launches Flutterwave checkout
      const params = new URLSearchParams({
        name,
        email,
        plan: plan.key,
      })
      window.location.href = `/register?${params.toString()}`
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,10,20,0.90)', backdropFilter: 'blur(16px)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.32, ease: [0.22,1,0.36,1] }}
        style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 20, padding: '40px 36px', maxWidth: 420, width: '100%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}
          onMouseEnter={e => e.target.style.color = '#fff'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>&times;</button>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 10, fontFamily: 'Inter,sans-serif' }}>Get started</div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>{plan.name} Plan</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', marginBottom: 28, fontFamily: 'Inter,sans-serif' }}>${plan.price.toLocaleString()}/month · {plan.dials} dials</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="text" placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
          <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.40)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
          {error && <p style={{ fontSize: 13, color: '#ff6b6b', margin: 0, fontFamily: 'Inter,sans-serif' }}>{error}</p>}
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '14px', background: '#00C47B', color: '#000', fontSize: 15, fontWeight: 800, border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s', opacity: loading ? 0.8 : 1 }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 10px 32px rgba(0,196,123,0.40)' }}}
            onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none' }}>
            {loading ? 'Redirecting to checkout…' : `Start ${plan.name} Plan →`}
          </button>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: 0, textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>
            Secure checkout. Cancel anytime.
          </p>
        </form>
      </motion.div>
    </div>
  )
}

// ─── ROI Section ──────────────────────────────────────────────────────────────
function ROISection() {
  const { ref, visible } = useReveal()
  const stats = [
    { number: '$499', label: 'Starter plan per month', sub: 'Everything included' },
    { number: '3,000', label: 'AI dials per month', sub: 'Works 24/7, never stops' },
    { number: '1 deal', label: 'Average closes per month', sub: 'Conservative estimate' },
    { number: '$10K-$25K', label: 'Average deal profit', sub: 'Wholesale assignment fee' },
  ]
  return (
    <section style={{ padding: '80px 24px', background: 'rgba(0,196,123,0.03)', borderTop: '1px solid rgba(0,196,123,0.08)', borderBottom: '1px solid rgba(0,196,123,0.08)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6 }}
          style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 12, fontFamily: 'Inter,sans-serif' }}>The ROI</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,44px)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 12, fontFamily: 'Inter,sans-serif' }}>
            For every $1 you spend on Veori,<br />you make back $20 to $50.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            One closed wholesale deal covers your entire subscription for the month. Everything after that is pure profit.
          </p>
        </motion.div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 48 }}>
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: i * 0.08 }}
              style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '28px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 38, fontWeight: 900, color: '#00C47B', letterSpacing: '-0.04em', fontFamily: 'Inter,sans-serif', marginBottom: 8 }}>{s.number}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>{s.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', fontFamily: 'Inter,sans-serif' }}>{s.sub}</div>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay: 0.3 }}
          style={{ background: 'linear-gradient(135deg, rgba(201,168,76,0.10), rgba(201,168,76,0.04))', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 16, padding: '28px 32px', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: 'Inter,sans-serif', marginBottom: 6 }}>
              One deal pays for 20 months of Veori.
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.50)', fontFamily: 'Inter,sans-serif' }}>
              The average wholesale assignment fee is $10,000. Your Starter plan is $499/month.
            </div>
          </div>
          <a href="#pricing" style={{ background: '#C9A84C', color: '#000', fontSize: 14, fontWeight: 800, padding: '14px 28px', borderRadius: 10, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
            See Plans
          </a>
        </motion.div>
      </div>
    </section>
  )
}

function Pricing() {
  const { ref, visible } = useReveal()
  const [selectedPlan, setSelectedPlan] = useState(null)

  return (
    <section id="pricing" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      {selectedPlan && <CheckoutModal plan={selectedPlan} onClose={() => setSelectedPlan(null)} />}
      <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', width: 800, height: 600, background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.05) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 5s ease-in-out infinite' }} />
      <div style={{ maxWidth: 1160, margin: '0 auto', position: 'relative' }}>
        <motion.div ref={ref} initial={{ opacity: 0, y: 16 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
          style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>Pricing</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14, fontFamily: 'Inter,sans-serif' }}>Simple. No surprises.</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            Every plan includes the full platform. Scale up as your operation grows.
          </p>
        </motion.div>

        {/* Founding Member - full-width hero card */}
        <FoundingMemberCard onSelect={setSelectedPlan} />

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>Standard plans</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {/* Standard plan grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.key} plan={plan} index={i} onSelect={setSelectedPlan} />
          ))}
        </div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(255,255,255,0.25)', marginTop: 28, fontFamily: 'Inter,sans-serif' }}>
          All plans billed monthly. Cancel anytime. No setup fees.
        </motion.p>
      </div>
    </section>
  )
}

// ─── PlanCard - extracts hook out of map loop ─────────────────────────────────
function PlanCard({ plan, index, onSelect }) {
  const { ref, visible } = useReveal()
  const isPopular = plan.popular

  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 24 }} animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.07, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
      style={{
        background: isPopular ? 'linear-gradient(160deg, #0D1F35 0%, #091628 100%)' : '#0A1526',
        border: isPopular ? '1px solid rgba(0,196,123,0.35)' : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 18,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: isPopular ? '0 0 60px rgba(0,196,123,0.08), 0 20px 60px rgba(0,0,0,0.30)' : '0 8px 32px rgba(0,0,0,0.20)',
      }}>
      {isPopular && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(0,196,123,0.7), transparent)', borderRadius: '18px 18px 0 0' }} />
          <div style={{ position: 'absolute', top: -1, right: 20, background: '#00C47B', color: '#000', fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '0 0 8px 8px', fontFamily: 'Inter,sans-serif' }}>Most Popular</div>
        </>
      )}

      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 12, fontFamily: 'Inter,sans-serif', color: '#fff' }}>{plan.name}</div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.50)', marginTop: 6, fontFamily: 'Inter,sans-serif' }}>$</span>
        <span style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, fontFamily: 'Inter,sans-serif' }}>{plan.price.toLocaleString()}</span>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>/month</div>

      <div style={{ fontSize: 12.5, color: '#00C47B', fontWeight: 700, marginBottom: 22, fontFamily: 'Inter,sans-serif' }}>
        {plan.dials} dials/month
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 18, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        {PLAN_FEATURES.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <span style={{ color: '#00C47B', flexShrink: 0, marginTop: 1, fontWeight: 700 }}>✓</span>
            <span style={{ color: 'rgba(255,255,255,0.62)', lineHeight: 1.4, fontFamily: 'Inter,sans-serif' }}>{f}</span>
          </div>
        ))}
      </div>

      <button onClick={() => onSelect(plan)}
        style={{
          width: '100%', padding: '13px',
          background: isPopular ? '#00C47B' : 'rgba(255,255,255,0.06)',
          border: isPopular ? 'none' : '1px solid rgba(255,255,255,0.10)',
          color: isPopular ? '#000' : 'rgba(255,255,255,0.85)',
          fontSize: 14, fontWeight: 800, borderRadius: 10, cursor: 'pointer',
          fontFamily: 'Inter,sans-serif', transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          if (isPopular) { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,196,123,0.38)' }
          else { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = '#fff' }
        }}
        onMouseLeave={e => {
          if (isPopular) { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none' }
          else { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }
        }}>
        Get Started →
      </button>
    </motion.div>
  )
}

// ─── ComingSoonCard - extracts hook out of map loop ──────────────────────────
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
            The roadmap is already built.<br />Every subscriber gets it all.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>
            These features are in active development. Every VEORI subscriber gets them automatically - no extra cost, no upgrade required.
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
  return (
    <section style={{ position: 'relative', padding: '120px 24px', overflow: 'hidden', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${WAVE_BG})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.25 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,14,26,0.78)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.10) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-glow 4s ease-in-out infinite' }} />
      <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }} style={{ position: 'relative', maxWidth: 560, margin: '0 auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 18, fontFamily: 'Inter,sans-serif' }}>Start today</div>
        <h2 style={{ fontSize: 'clamp(32px,5vw,56px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.06, marginBottom: 18, fontFamily: 'Inter,sans-serif' }}>
          Your AI acquisitions team.<br />Ready in minutes.
        </h2>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, marginBottom: 40, fontFamily: 'Inter,sans-serif' }}>
          Pick a plan, connect your leads, and let VEORI handle the calls.<br />
          <strong style={{ color: 'rgba(255,255,255,0.80)' }}>No setup fees. Cancel anytime.</strong>
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="#pricing"
            style={{ display: 'inline-block', padding: '15px 36px', background: '#00C47B', color: '#000', fontSize: 16, fontWeight: 800, borderRadius: 10, textDecoration: 'none', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(0,196,123,0.42)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = '' }}>
            See Pricing →
          </a>
          <a href="mailto:support@veori.ai"
            style={{ display: 'inline-block', padding: '15px 36px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.80)', fontSize: 16, fontWeight: 700, borderRadius: 10, textDecoration: 'none', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.80)' }}>
            Talk to us
          </a>
        </div>
        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.28)', marginTop: 24, fontFamily: 'Inter,sans-serif' }}>
          Questions? <a href="mailto:support@veori.ai" style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'underline', textUnderlineOffset: 3 }}>support@veori.ai</a>
        </p>
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
