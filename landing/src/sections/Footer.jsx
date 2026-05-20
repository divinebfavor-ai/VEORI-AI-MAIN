export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '36px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <defs><linearGradient id="foot-lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00E090"/><stop offset="100%" stopColor="#009E61"/></linearGradient></defs>
          <rect width="32" height="32" rx="8" fill="url(#foot-lg)"/>
          <text x="16" y="23" fontFamily="Inter,system-ui,sans-serif" fontSize="15" fontWeight="900" fill="#000" textAnchor="middle">V</text>
        </svg>
        <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>VEORI</span>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        {[['How it works', '#how'], ['Platform', '#platform'], ['Pricing', '#pricing'], ['Contact', 'mailto:divinebfavor@gmail.com']].map(([label, href]) => (
          <li key={label}><a href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.70)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>{label}</a></li>
        ))}
      </ul>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© 2026 VEORI AI. All rights reserved.</div>
    </footer>
  )
}
