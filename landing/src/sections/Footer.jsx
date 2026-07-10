import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer style={{ background: '#06080D', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '44px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <img src="/favicon.svg" alt="VEORI" width="28" height="28" style={{ display: 'block' }} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.035em', color: '#fff' }}>VEORI</span>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', gap: 22, flexWrap: 'wrap', margin: 0, padding: 0 }}>
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing'], ['Contact', 'mailto:support@veori.net']].map(([label, href]) => (
          <li key={label}><a href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.70)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>{label}</a></li>
        ))}
      </ul>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <Link to="/terms" style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.60)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.30)'}>Terms of Service</Link>
          <Link to="/privacy" style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.60)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.30)'}>Privacy Policy</Link>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© 2026 VEORI AI. All rights reserved.</div>
      </div>
    </footer>
  )
}
