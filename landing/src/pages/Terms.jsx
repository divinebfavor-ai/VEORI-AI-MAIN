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

export default function Terms() {
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
          <h1 style={{ fontSize: 36, fontWeight: 900, color: T1, margin: '8px 0 12px', letterSpacing: '-0.03em' }}>Terms of Service</h1>
          <p style={{ fontSize: 13, color: T3 }}>Last updated: May 22, 2026</p>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 40 }}>
          <p style={{ fontSize: 13, color: T2, margin: 0, lineHeight: 1.7 }}>
            Please read these Terms of Service carefully before using VEORI AI. By accessing or using our platform, you agree to be bound by these terms. If you do not agree, do not use the platform.
          </p>
        </div>

        <Section title="1. Acceptance of Terms">
          <P>By creating an account or using any part of the VEORI AI platform ("Platform"), you agree to these Terms of Service ("Terms") and our Privacy Policy. These Terms form a binding legal agreement between you ("Operator") and VEORI AI ("Company," "we," "us," or "our").</P>
          <P>If you are using the Platform on behalf of a business entity, you represent that you have the authority to bind that entity to these Terms.</P>
        </Section>

        <Section title="2. Description of Service">
          <P>VEORI AI provides an AI-powered real estate acquisition platform that includes automated calling, lead management, deal tracking, contract management, and related tools ("Services"). The Platform uses AI to assist Operators in contacting property sellers and managing their real estate investment business.</P>
        </Section>

        <Section title="3. Eligibility and Account Requirements">
          <UL items={[
            'You must be at least 18 years of age to use the Platform.',
            'You must provide accurate and complete information when creating your account.',
            'You are responsible for maintaining the security of your account credentials.',
            'You must notify us immediately of any unauthorized access to your account.',
            'One person or entity may not maintain more than one active account without express written permission.',
          ]} />
        </Section>

        <Section title="4. TCPA Compliance and Calling Regulations">
          <P>Use of the Platform's calling features is subject to strict legal compliance requirements. By using these features, you represent and warrant that:</P>
          <UL items={[
            'You will comply with the Telephone Consumer Protection Act (TCPA), the Telemarketing Sales Rule (TSR), and all applicable federal, state, and local telemarketing laws.',
            'You will only call leads during legally permitted hours (8:00 AM to 9:00 PM local time in the recipient\'s time zone, per federal TCPA rules).',
            'You will honor all Do Not Call (DNC) requests immediately and maintain your own DNC list.',
            'You understand that AI-generated calls may be subject to disclosure requirements in certain states.',
            'You take full responsibility for the calls made using your account.',
          ]} />
          <P>The Platform includes built-in TCPA safeguards (calling hour enforcement, DNC checks, audit logging). However, these tools do not guarantee legal compliance. You are solely responsible for ensuring your calling practices comply with all applicable laws.</P>
          <P>VEORI AI is not a law firm and nothing in this Platform constitutes legal advice. Consult a licensed attorney regarding telemarketing compliance in your jurisdiction.</P>
        </Section>

        <Section title="5. Real Estate Regulations">
          <P>Real estate wholesaling and investment activities are subject to state and local laws that vary significantly. You are solely responsible for:</P>
          <UL items={[
            'Complying with real estate licensing requirements in your state.',
            'Making required disclosures to sellers (the Platform provides state-specific disclosure language as a reference only).',
            'Ensuring your business practices comply with consumer protection laws.',
            'Obtaining appropriate legal and professional advice for your specific situation.',
          ]} />
          <P>The state compliance information provided in the Platform is for general informational purposes only and may not reflect the most current laws. Always verify compliance requirements with a licensed real estate attorney.</P>
        </Section>

        <Section title="6. Acceptable Use">
          <P>You agree NOT to use the Platform to:</P>
          <UL items={[
            'Contact individuals on the National Do Not Call Registry without proper exemption.',
            'Make calls outside of legally permitted hours.',
            'Misrepresent your identity, company, or intentions to sellers.',
            'Engage in fraudulent, deceptive, or misleading practices.',
            'Harass, threaten, or intimidate any person.',
            'Violate any applicable law or regulation.',
            'Attempt to reverse engineer, hack, or compromise the Platform.',
            'Share, resell, or transfer your account to any third party.',
          ]} />
        </Section>

        <Section title="7. Fees and Payment">
          <P>Access to the Platform requires a paid subscription. Subscription fees are billed monthly or annually as selected at the time of signup. All fees are non-refundable except as required by applicable law or as explicitly stated in our refund policy.</P>
          <P>We reserve the right to change pricing with 30 days written notice. Continued use of the Platform after a price change constitutes acceptance of the new pricing.</P>
        </Section>

        <Section title="8. Data and Privacy">
          <P>You retain ownership of your data (leads, calls, deals, etc.) uploaded to or created within the Platform. By using the Platform, you grant us a limited license to process and store your data to provide the Services.</P>
          <P>We do not sell your data to third parties. See our Privacy Policy for full details on how we handle your data and the data of individuals you contact.</P>
        </Section>

        <Section title="9. Limitation of Liability">
          <P>TO THE MAXIMUM EXTENT PERMITTED BY LAW, VEORI AI AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE PLATFORM.</P>
          <P>OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING FROM THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM.</P>
        </Section>

        <Section title="10. Indemnification">
          <P>You agree to indemnify, defend, and hold harmless VEORI AI and its officers, directors, employees, and agents from any claim, liability, damages, costs, or expenses (including attorneys' fees) arising from: (a) your use of the Platform; (b) your violation of these Terms; (c) your violation of any law or the rights of any third party; or (d) any calls made using your account.</P>
        </Section>

        <Section title="11. Termination">
          <P>We reserve the right to suspend or terminate your account at any time for violation of these Terms, non-payment, or at our discretion with 30 days notice. You may cancel your account at any time. Upon termination, your access to the Platform will cease and we will retain your data for 90 days before deletion unless otherwise required by law.</P>
        </Section>

        <Section title="12. Governing Law">
          <P>These Terms are governed by the laws of the State of North Carolina, without regard to conflict of law principles. Any disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, with proceedings conducted in North Carolina.</P>
        </Section>

        <Section title="13. Changes to Terms">
          <P>We may update these Terms at any time. We will notify you of material changes by email or in-platform notification. Continued use of the Platform after changes take effect constitutes your acceptance of the new Terms.</P>
        </Section>

        <Section title="14. Contact">
          <P>For questions about these Terms, contact us at: <a href="mailto:support@veori.net" style={{ color: GREEN }}>support@veori.net</a></P>
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
