import { Link } from 'react-router-dom'

const BG    = '#060E1A'
const CARD  = 'rgba(255,255,255,0.03)'
const BORDER= 'rgba(255,255,255,0.07)'
const GREEN = '#00C37A'
const T1    = '#fff'
const T2    = 'rgba(255,255,255,0.75)'
const T3    = 'rgba(255,255,255,0.45)'

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T1, marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${BORDER}` }}>{title}</h2>
      <div style={{ fontSize: 14, color: T2, lineHeight: 1.75 }}>{children}</div>
    </div>
  )
}

function P({ children }) {
  return <p style={{ margin: '0 0 12px' }}>{children}</p>
}

function UL({ items }) {
  return (
    <ul style={{ paddingLeft: 20, margin: '0 0 12px' }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: 6 }}>{item}</li>)}
    </ul>
  )
}

export default function Privacy() {
  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Nav bar */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <defs><linearGradient id="nav-lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00E090"/><stop offset="100%" stopColor="#009E61"/></linearGradient></defs>
            <rect width="32" height="32" rx="8" fill="url(#nav-lg)"/>
            <text x="16" y="23" fontFamily="Inter,system-ui,sans-serif" fontSize="15" fontWeight="900" fill="#000" textAnchor="middle">V</text>
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.04em', color: T1 }}>VEORI</span>
        </Link>
        <Link to="/" style={{ fontSize: 13, color: T3, textDecoration: 'none' }}>Back to Home</Link>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 40px 80px' }}>
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Legal</span>
          <h1 style={{ fontSize: 36, fontWeight: 900, color: T1, margin: '8px 0 12px', letterSpacing: '-0.03em' }}>Privacy Policy</h1>
          <p style={{ fontSize: 13, color: T3 }}>Last updated: May 22, 2026</p>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 40 }}>
          <p style={{ fontSize: 13, color: T2, margin: 0, lineHeight: 1.7 }}>
            VEORI AI is committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and your rights regarding your data. By using our platform, you agree to the practices described here.
          </p>
        </div>

        <Section title="1. Information We Collect">
          <P><strong style={{ color: T1 }}>Account Information:</strong> When you create an account, we collect your name, email address, company name, phone number, and payment information.</P>
          <P><strong style={{ color: T1 }}>Business Data:</strong> Data you upload or create within the Platform, including lead contact information, property details, call recordings, transcripts, deal information, and notes.</P>
          <P><strong style={{ color: T1 }}>Call Data:</strong> When AI calls are made through the Platform, we record and store audio recordings, transcripts, call duration, and outcomes. This data is associated with your account and the leads you manage.</P>
          <P><strong style={{ color: T1 }}>Usage Data:</strong> We collect information about how you use the Platform, including pages viewed, features used, and actions taken. This helps us improve the service.</P>
          <P><strong style={{ color: T1 }}>Technical Data:</strong> IP addresses, browser type, device information, and cookies used to authenticate sessions and maintain security.</P>
        </Section>

        <Section title="2. How We Use Your Information">
          <UL items={[
            'Providing, operating, and improving the Platform and Services.',
            'Processing payments and managing your subscription.',
            'Sending service-related communications (account alerts, billing, security notices).',
            'Providing customer support and responding to inquiries.',
            'Detecting, preventing, and responding to fraud, abuse, or security incidents.',
            'Complying with legal obligations and enforcing our Terms of Service.',
            'Analyzing usage patterns to improve platform features (using aggregated, non-identifying data).',
          ]} />
        </Section>

        <Section title="3. Seller and Lead Data">
          <P>The Platform processes contact information and recordings of property sellers and other individuals ("Seller Data") on your behalf. As an Operator, you are the controller of this Seller Data, and we act as a data processor.</P>
          <P>You are responsible for ensuring you have a lawful basis to contact and process data about the individuals in your lead list, including compliance with TCPA, CAN-SPAM, and applicable state privacy laws.</P>
          <P>We do not use Seller Data for our own marketing purposes or sell it to third parties.</P>
        </Section>

        <Section title="4. Call Recordings and Transcripts">
          <P>Calls made through the Platform may be recorded and transcribed. You are responsible for complying with all applicable call recording disclosure laws in your state and the state of the person being called. Many states require all-party consent for call recording.</P>
          <P>Recordings and transcripts are stored securely on our servers and are accessible only to you (the Operator) and authorized VEORI AI personnel for support and compliance purposes.</P>
          <P>VEORI AI stores call recordings indefinitely on your behalf. You can request deletion of specific recordings at any time by contacting support.</P>
        </Section>

        <Section title="5. Data Sharing">
          <P>We do not sell, rent, or trade your personal information or your leads' data. We share data only in these limited circumstances:</P>
          <UL items={[
            'Service Providers: We use third-party services (Supabase for database storage, VAPI for AI calling, Resend for email, Anthropic for AI analysis) that process data on our behalf under strict data processing agreements.',
            'Legal Requirements: We may disclose data if required by law, court order, or government authority.',
            'Business Transfers: In the event of a merger, acquisition, or sale of assets, data may be transferred to the successor entity.',
            'With Your Consent: We will share data in any other circumstances with your explicit consent.',
          ]} />
        </Section>

        <Section title="6. Data Security">
          <P>We implement industry-standard security measures to protect your data:</P>
          <UL items={[
            'All data is encrypted in transit using TLS 1.2 or higher.',
            'Data at rest is encrypted using AES-256 encryption.',
            'Access to production systems is restricted to authorized personnel.',
            'We conduct regular security reviews and vulnerability assessments.',
            'Authentication requires strong passwords and supports multi-factor authentication.',
          ]} />
          <P>No system is 100% secure. We encourage you to use a strong, unique password and to contact us immediately if you suspect unauthorized access to your account.</P>
        </Section>

        <Section title="7. Data Retention">
          <P>We retain your account data for as long as your account is active. If you cancel your account, we retain your data for 90 days before deletion, giving you time to export your data. Call recordings and transcripts are retained for the life of your account unless you request deletion.</P>
          <P>Some data may be retained longer if required by legal obligations.</P>
        </Section>

        <Section title="8. Your Rights">
          <P>Depending on your location, you may have the following rights regarding your personal data:</P>
          <UL items={[
            'Access: Request a copy of the personal data we hold about you.',
            'Correction: Request correction of inaccurate or incomplete data.',
            'Deletion: Request deletion of your personal data, subject to legal retention requirements.',
            'Portability: Request a machine-readable export of your data.',
            'Objection: Object to certain processing of your data.',
          ]} />
          <P>To exercise these rights, contact us at <a href="mailto:support@veori.net" style={{ color: GREEN }}>support@veori.net</a>. We will respond within 30 days.</P>
        </Section>

        <Section title="9. Cookies">
          <P>We use essential cookies to maintain your login session and platform functionality. We do not use advertising or tracking cookies. You can disable cookies in your browser settings, but this may affect Platform functionality.</P>
        </Section>

        <Section title="10. Children's Privacy">
          <P>The Platform is not intended for individuals under the age of 18. We do not knowingly collect personal information from minors. If you believe a minor has provided us with personal information, contact us immediately.</P>
        </Section>

        <Section title="11. Changes to This Policy">
          <P>We may update this Privacy Policy from time to time. We will notify you of material changes by email or in-platform notification at least 30 days before they take effect. Your continued use of the Platform after changes take effect constitutes acceptance of the updated policy.</P>
        </Section>

        <Section title="12. Contact Us">
          <P>For privacy-related questions, requests, or concerns, contact us at:</P>
          <P>
            VEORI AI<br />
            Email: <a href="mailto:support@veori.net" style={{ color: GREEN }}>support@veori.net</a>
          </P>
        </Section>
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: T3 }}>© 2026 VEORI AI. All rights reserved.</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/terms" style={{ fontSize: 12, color: T3, textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/privacy" style={{ fontSize: 12, color: T3, textDecoration: 'none' }}>Privacy Policy</Link>
        </div>
      </div>
    </div>
  )
}
