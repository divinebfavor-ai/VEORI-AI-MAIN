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
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-10 h-16"
      style={{
        background: scrolled ? 'rgba(6,14,26,0.92)' : 'rgba(6,14,26,0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        boxShadow: scrolled ? '0 8px 40px rgba(0,0,0,0.5)' : 'none',
        transition: 'all 0.35s ease',
      }}
    >
      {/* Logo */}
      <a href="#" className="flex items-center gap-2.5 no-underline">
        <img src="/favicon.svg" alt="VEORI" width="32" height="32" style={{ display: 'block' }} />
        <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>VEORI</span>
      </a>

      {/* Links */}
      <ul className="hidden md:flex list-none gap-1">
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing']].map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.48)', textDecoration: 'none', padding: '6px 12px', borderRadius: 7, display: 'block', transition: 'color 0.2s' }}
              onMouseEnter={e => e.target.style.color = '#fff'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.48)'}
            >{label}</a>
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <a
          href={`${APP_URL}/login`}
          style={{
            fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.70)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            padding: '7px 16px', borderRadius: 8, textDecoration: 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.target.style.color = '#fff'; e.target.style.borderColor = 'rgba(255,255,255,0.16)'; }}
          onMouseLeave={e => { e.target.style.color = 'rgba(255,255,255,0.70)'; e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >Log in</a>
        <a
          href="#pricing"
          style={{
            fontSize: 13.5, fontWeight: 700, color: '#000',
            background: '#00C47B', border: 'none',
            padding: '7px 18px', borderRadius: 8, textDecoration: 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.target.style.background = '#00d986'; e.target.style.boxShadow = '0 6px 22px rgba(0,196,123,0.38)'; }}
          onMouseLeave={e => { e.target.style.background = '#00C47B'; e.target.style.boxShadow = 'none'; }}
        >Get started</a>
      </div>
    </motion.nav>
  )
}
