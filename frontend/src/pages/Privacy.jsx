import React from 'react'
import { useNavigate } from 'react-router-dom'

function VeoriLogo({ size = 28 }) {
  const cx = size / 2, cy = size / 2
  const rectSize = size * 0.74, x = (size - rectSize) / 2
  const rx = rectSize * 0.243, sw = size * 0.054
  const dotR = size * 0.065, dotGlowR = size * 0.13
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <defs>
        <clipPath id="pp-clip"><circle cx={cx} cy={cy} r={size * 0.485}/></clipPath>
        <filter id="pp-gd" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={size * 0.015} result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={size / 2} fill="#050A14"/>
      <g clipPath="url(#pp-clip)" transform={`rotate(20, ${cx}, ${cy})`}>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#00C37A" strokeWidth={sw} fill="none" transform={`rotate(30, ${cx}, ${cy})`}/>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#C9A84C" strokeWidth={sw} fill="none" transform={`rotate(-30, ${cx}, ${cy})`}/>
      </g>
      <circle cx={cx} cy={cy} r={dotGlowR} fill="white" filter="url(#pp-gd)"/>
      <circle cx={cx} cy={cy} r={dotR} fill="#00C37A"/>
    </svg>
  )
}

export default function Privacy() {
  const navigate = useNavigate()
  const s = {
    page: { minHeight: '100vh', background: '#000', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' },
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
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.updated}>Last updated: May 25, 2026</p>

        <p style={s.p}>VEORI AI ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform at veori.net and related services.</p>

        <h2 style={s.h2}>1. Information We Collect</h2>
        <p style={s.p}>We collect information you provide directly to us:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}><strong style={{ color: '#fff' }}>Account Information:</strong> Name, email address, password, company name, and phone number when you register.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>Billing Information:</strong> Payment method details processed securely through Stripe. We do not store raw card numbers.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>Business Data:</strong> Lead information, property data, campaign settings, call recordings, and transcripts you upload or generate through the platform.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>Communications:</strong> Messages you send to our support team.</li>
        </ul>
        <p style={s.p}>We also collect information automatically:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}>Log data including IP address, browser type, pages visited, and time spent.</li>
          <li style={s.li}>Usage data about how you interact with the platform.</li>
          <li style={s.li}>Device information including hardware model and operating system.</li>
        </ul>

        <h2 style={s.h2}>2. How We Use Your Information</h2>
        <p style={s.p}>We use the information we collect to:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}>Provide, maintain, and improve our services.</li>
          <li style={s.li}>Process transactions and send billing-related communications.</li>
          <li style={s.li}>Send service updates, security alerts, and support messages.</li>
          <li style={s.li}>Power AI features including call analysis, lead scoring, and transcription.</li>
          <li style={s.li}>Monitor and analyze usage patterns to improve the platform.</li>
          <li style={s.li}>Detect, prevent, and address technical issues and fraud.</li>
          <li style={s.li}>Comply with legal obligations.</li>
        </ul>

        <h2 style={s.h2}>3. Sharing of Information</h2>
        <p style={s.p}>We do not sell your personal information. We may share your information with:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}><strong style={{ color: '#fff' }}>Service Providers:</strong> Third-party vendors who help us operate the platform, including Supabase (database), Stripe (payments), VAPI (AI calling), Anthropic (AI), Resend (email), and Twilio (telephony). These providers are contractually obligated to protect your data.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>Legal Requirements:</strong> When required by law, court order, or governmental authority.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, with notice to you.</li>
          <li style={s.li}><strong style={{ color: '#fff' }}>With Your Consent:</strong> For any other purpose with your explicit consent.</li>
        </ul>

        <h2 style={s.h2}>4. Call Recordings and Transcripts</h2>
        <p style={s.p}>VEORI AI enables AI-powered outbound calling. All calls made through our platform may be recorded and transcribed. You are responsible for ensuring you have the required consent and disclosures in place before recording calls, as required by applicable law (including state-specific two-party consent laws). Call data is stored securely and used to provide our services. You may delete call records from your account at any time.</p>

        <h2 style={s.h2}>5. Data Retention</h2>
        <p style={s.p}>We retain your information for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data at any time by contacting us at support@veori.ai. We may retain certain information for legal compliance, dispute resolution, or enforcement of agreements.</p>

        <h2 style={s.h2}>6. Data Security</h2>
        <p style={s.p}>We implement industry-standard security measures including encryption in transit (TLS), encrypted storage, access controls, and regular security reviews. However, no method of transmission over the Internet is 100% secure. We cannot guarantee absolute security of your data.</p>

        <h2 style={s.h2}>7. Your Rights and Choices</h2>
        <p style={s.p}>Depending on your location, you may have the right to:</p>
        <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
          <li style={s.li}>Access the personal information we hold about you.</li>
          <li style={s.li}>Request correction of inaccurate data.</li>
          <li style={s.li}>Request deletion of your data.</li>
          <li style={s.li}>Object to or restrict certain processing of your data.</li>
          <li style={s.li}>Data portability — receive your data in a structured format.</li>
          <li style={s.li}>Withdraw consent where processing is based on consent.</li>
        </ul>
        <p style={s.p}>To exercise these rights, contact us at <a href="mailto:support@veori.ai" style={{ color: '#00C37A' }}>support@veori.ai</a>.</p>

        <h2 style={s.h2}>8. Cookies</h2>
        <p style={s.p}>We use essential cookies to maintain your session and authentication. We do not use third-party advertising cookies. You can control cookie settings through your browser, though disabling cookies may affect platform functionality.</p>

        <h2 style={s.h2}>9. Children's Privacy</h2>
        <p style={s.p}>VEORI AI is not directed to individuals under 18 years of age. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will delete it promptly.</p>

        <h2 style={s.h2}>10. International Data Transfers</h2>
        <p style={s.p}>Your information may be transferred to and processed in countries other than your own, including the United States. We ensure appropriate safeguards are in place for such transfers in accordance with applicable data protection laws.</p>

        <h2 style={s.h2}>11. Third-Party Links</h2>
        <p style={s.p}>Our platform may contain links to third-party websites or services. We are not responsible for the privacy practices of those third parties. We encourage you to review their privacy policies.</p>

        <h2 style={s.h2}>12. Changes to This Policy</h2>
        <p style={s.p}>We may update this Privacy Policy periodically. We will notify you of material changes via email or a prominent notice on our platform. Your continued use of VEORI AI after the effective date constitutes acceptance of the updated policy.</p>

        <h2 style={s.h2}>13. Contact Us</h2>
        <p style={s.p}>If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
        <p style={s.p}>
          <strong style={{ color: '#fff' }}>VEORI AI</strong><br/>
          Email: <a href="mailto:support@veori.ai" style={{ color: '#00C37A' }}>support@veori.ai</a><br/>
          Website: <a href="https://veori.net" style={{ color: '#00C37A' }}>veori.net</a>
        </p>
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
