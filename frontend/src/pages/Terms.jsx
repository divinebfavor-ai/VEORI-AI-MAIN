import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function VeoriLogo({ size = 28 }) {
  const cx = size / 2, cy = size / 2
  const rectSize = size * 0.74, x = (size - rectSize) / 2
  const rx = rectSize * 0.243, sw = size * 0.054
  const dotR = size * 0.065, dotGlowR = size * 0.13
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <defs>
        <clipPath id="tc-clip"><circle cx={cx} cy={cy} r={size * 0.485}/></clipPath>
        <filter id="tc-gd" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={size * 0.015} result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={size / 2} fill="#050A14"/>
      <g clipPath="url(#tc-clip)" transform={`rotate(20, ${cx}, ${cy})`}>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#00C37A" strokeWidth={sw} fill="none" transform={`rotate(30, ${cx}, ${cy})`}/>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#C9A84C" strokeWidth={sw} fill="none" transform={`rotate(-30, ${cx}, ${cy})`}/>
      </g>
      <circle cx={cx} cy={cy} r={dotGlowR} fill="white" filter="url(#tc-gd)"/>
      <circle cx={cx} cy={cy} r={dotR} fill="#00C37A"/>
    </svg>
  )
}

export default function Terms() {
  const navigate = useNavigate()

  useEffect(() => {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    document.getElementById('root').style.height = 'auto'
    document.getElementById('root').style.overflow = 'auto'
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.getElementById('root').style.height = ''
      document.getElementById('root').style.overflow = ''
    }
  }, [])
  const s = {
    page: { minHeight: '100vh', background: '#000', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', overflowY: 'auto' },
    nav: { display: 'flex', alignItems: 'center', gap: 10, padding: '24px 48px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' },
    logo: { display: 'flex', alignItems: 'center', gap: 9 },
    logoText: { fontSize: 18, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' },
    container: { maxWidth: 800, margin: '0 auto', padding: '64px 32px' },
    h1: { fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 },
    updated: { color: 'rgba(255,255,255,0.35)', fontSize: 14, marginBottom: 48 },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 48, marginBottom: 12, color: '#00C37A' },
    p: { color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, fontSize: 15, marginBottom: 16 },
    li: { color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, fontSize: 15, marginBottom: 8 },
    footer: { borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 },
    footerText: { fontSize: 13, color: 'rgba(255,255,255,0.25)' },
    footerLinks: { display: 'flex', gap: 24 },
    footerLink: { fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' },
  }

  return (
    <div style={s.page}>
      <nav style={s.nav} onClick={() => navigate('/')}>
        <div style={s.logo}>
          <VeoriLogo size={28}/>
          <span style={s.logoText}>VEORI</span>
        </div>
      </nav>

      <div style={s.container}>
        <h1 style={s.h1}>Terms of Service</h1>
        <p style={s.updated}>Last updated: May 25, 2026</p>

        <p style={s.p}>Welcome to VEORI AI. By accessing or using our platform, you agree to be bound by these Terms of Service. Please read them carefully before using our services.</p>

        <h2 style={s.h2}>1. Acceptance of Terms</h2>
        <p style={s.p}>By creating an account or using VEORI AI in any way, you confirm that you are at least 18 years old, have read and understood these terms, and agree to be legally bound by them. If you do not agree, do not use our services.</p>

        <h2 style={s.h2}>2. Description of Services</h2>
        <p style={s.p}>VEORI AI provides an autonomous real estate acquisitions platform including AI-powered calling, lead management, campaign management, deal tracking, and related tools. We reserve the right to modify, suspend, or discontinue any part of the service at any time.</p>

        <h2 style={s.h2}>3. Account Registration</h2>
        <p style={s.p}>You must provide accurate, complete, and current information when registering. You are responsible for maintaining the confidentiality of your credentials and for all activities under your account. Notify us immediately at support@veori.ai if you suspect unauthorized access.</p>

        <h2 style={s.h2}>4. Subscription and Billing</h2>
        <p style={s.p}>VEORI AI operates on a monthly subscription basis. By subscribing:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}>You authorize us to charge your payment method on a recurring monthly basis.</li>
          <li style={s.li}>Subscriptions automatically renew unless cancelled before the renewal date.</li>
          <li style={s.li}>All fees are non-refundable except where required by law.</li>
          <li style={s.li}>We may change pricing with 30 days written notice.</li>
          <li style={s.li}>Dial limits reset monthly and do not carry over.</li>
        </ul>

        <h2 style={s.h2}>5. Acceptable Use</h2>
        <p style={s.p}>You agree to use VEORI AI only for lawful purposes. You must not:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}>Violate any applicable laws or regulations, including the TCPA, FCC rules, or Do Not Call registry requirements.</li>
          <li style={s.li}>Use the platform to harass, threaten, or deceive individuals.</li>
          <li style={s.li}>Attempt to reverse engineer, hack, or disrupt our systems.</li>
          <li style={s.li}>Resell or redistribute access to the platform without written consent.</li>
          <li style={s.li}>Upload or transmit malicious code, spam, or unauthorized data.</li>
        </ul>

        <h2 style={s.h2}>6. Compliance with Calling Laws</h2>
        <p style={s.p}>You are solely responsible for ensuring your use of VEORI AI's calling features complies with all applicable laws including the Telephone Consumer Protection Act (TCPA), state calling laws, and Do Not Call regulations. VEORI AI provides tools to assist with compliance but does not guarantee compliance. You assume all legal responsibility for outbound calls made through our platform.</p>

        <h2 style={s.h2}>7. Intellectual Property</h2>
        <p style={s.p}>All content, features, and functionality of VEORI AI — including but not limited to software, text, graphics, and AI models — are owned by VEORI AI and protected by intellectual property laws. You may not copy, reproduce, or create derivative works without our express written permission.</p>

        <h2 style={s.h2}>8. Data and Privacy</h2>
        <p style={s.p}>Your use of the platform is also governed by our Privacy Policy. By using VEORI AI, you consent to the collection and use of your data as described therein. You retain ownership of your lead data. We will not sell your data to third parties.</p>

        <h2 style={s.h2}>9. Disclaimer of Warranties</h2>
        <p style={s.p}>VEORI AI is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the service will be uninterrupted, error-free, or that results obtained from using the service will meet your expectations.</p>

        <h2 style={s.h2}>10. Limitation of Liability</h2>
        <p style={s.p}>To the maximum extent permitted by law, VEORI AI shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including lost profits or business interruption, arising from your use of the platform. Our total liability shall not exceed the amount you paid in the 3 months preceding the claim.</p>

        <h2 style={s.h2}>11. Termination</h2>
        <p style={s.p}>We may suspend or terminate your account immediately if you violate these terms, engage in fraudulent activity, or for any other reason at our sole discretion. Upon termination, your right to use the platform ceases immediately. Sections that by their nature should survive termination will survive.</p>

        <h2 style={s.h2}>12. Governing Law</h2>
        <p style={s.p}>These Terms shall be governed by the laws of the State of Delaware, United States, without regard to conflict of law provisions. Any disputes shall be resolved through binding arbitration rather than in court, except that either party may seek injunctive relief in court for intellectual property violations.</p>

        <h2 style={s.h2}>13. Changes to Terms</h2>
        <p style={s.p}>We may update these Terms at any time. We will notify you of material changes via email or in-app notification. Continued use of VEORI AI after changes constitutes acceptance of the new terms.</p>

        <h2 style={s.h2}>14. Contact</h2>
        <p style={s.p}>For questions about these Terms, contact us at: <a href="mailto:support@veori.ai" style={{ color: '#00C37A' }}>support@veori.ai</a></p>
      </div>

      <footer style={s.footer}>
        <span style={s.footerText}>© 2026 VEORI AI. All rights reserved.</span>
        <div style={s.footerLinks}>
          <a href="/terms" style={s.footerLink}>Terms</a>
          <a href="/privacy" style={s.footerLink}>Privacy</a>
          <a href="/" style={s.footerLink}>Home</a>
        </div>
      </footer>
    </div>
  )
}
