import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const APP_URL = 'https://veori.net'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  return (
    <motion.nav
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.28, 0.11, 0.32, 1] }}
      style={{
        position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
        zIndex: 50, width: 'min(1080px, calc(100% - 28px))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px 0 18px', height: 54, borderRadius: 980,
        background: scrolled ? 'rgba(10,21,38,0.72)' : 'rgba(10,21,38,0.44)',
        backdropFilter: 'saturate(180%) blur(22px)',
        WebkitBackdropFilter: 'saturate(180%) blur(22px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: scrolled ? '0 10px 40px rgba(0,0,0,0.42)' : '0 6px 22px rgba(0,0,0,0.24)',
        transition: 'background 0.35s var(--ease-apple), box-shadow 0.35s var(--ease-apple)',
      }}
    >
      {/* Logo */}
      <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <img src="/favicon.svg" alt="VEORI" width="26" height="26" style={{ display: 'block' }} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.03em', color: '#fff' }}>VEORI</span>
      </a>

      {/* Links */}
      <ul className="hidden md:flex" style={{ listStyle: 'none', display: 'flex', gap: 2, margin: 0, padding: 0 }}>
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing']].map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.62)', textDecoration: 'none', padding: '8px 14px', borderRadius: 980, display: 'block', transition: 'color 0.2s var(--ease-apple), background 0.2s var(--ease-apple)' }}
              onMouseEnter={e => { e.target.style.color = '#fff'; e.target.style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { e.target.style.color = 'rgba(255,255,255,0.62)'; e.target.style.background = 'transparent' }}
            >{label}</a>
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <a
          href={`${APP_URL}/login`}
          style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.70)', padding: '8px 14px', borderRadius: 980, textDecoration: 'none', transition: 'color 0.2s var(--ease-apple)' }}
          onMouseEnter={e => e.target.style.color = '#fff'}
          onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.70)'}
        >Log in</a>
        <a
          href="#pricing"
          className="btn-apple"
          style={{ fontSize: 13.5, fontWeight: 600, color: '#000', background: '#00C47B', padding: '9px 18px' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,196,123,0.40)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none' }}
        >Get started</a>
      </div>
    </motion.nav>
  )
}
