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
        <clipPath id="rp-clip"><circle cx={cx} cy={cy} r={size * 0.485}/></clipPath>
        <filter id="rp-gd" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={size * 0.015} result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={size / 2} fill="#050A14"/>
      <g clipPath="url(#rp-clip)" transform={`rotate(20, ${cx}, ${cy})`}>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#00C37A" strokeWidth={sw} fill="none" transform={`rotate(30, ${cx}, ${cy})`}/>
        <rect x={x} y={x} width={rectSize} height={rectSize} rx={rx} stroke="#C9A84C" strokeWidth={sw} fill="none" transform={`rotate(-30, ${cx}, ${cy})`}/>
      </g>
      <circle cx={cx} cy={cy} r={dotGlowR} fill="white" filter="url(#rp-gd)"/>
      <circle cx={cx} cy={cy} r={dotR} fill="#00C37A"/>
    </svg>
  )
}

export default function RefundPolicy() {
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
    page:    { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter, sans-serif' },
    nav:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 40px', borderBottom: '1px solid rgba(255,255,255,0.07)' },
    logo:    { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textDecoration: 'none' },
    back:    { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '8px 16px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
    wrap:    { maxWidth: 760, margin: '0 auto', padding: '60px 40px 100px' },
    h1:      { fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 },
    date:    { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 48 },
    h2:      { fontSize: 18, fontWeight: 700, color: '#00C37A', margin: '40px 0 12px' },
    p:       { fontSize: 15, color: 'rgba(255,255,255,0.70)', lineHeight: 1.75, marginBottom: 16 },
    box:     { background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.20)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 },
    li:      { fontSize: 15, color: 'rgba(255,255,255,0.70)', lineHeight: 1.75, marginBottom: 8 },
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <div style={s.logo} onClick={() => navigate('/')}>
          <VeoriLogo size={32} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>Veori</span>
        </div>
        <button style={s.back} onClick={() => navigate(-1)}>Back</button>
      </nav>

      <div style={s.wrap}>
        <h1 style={s.h1}>Refund Policy</h1>
        <p style={s.date}>Effective Date: June 1, 2025 &nbsp;|&nbsp; Last Updated: June 1, 2025</p>

        <div style={s.box}>
          <p style={{ ...s.p, marginBottom: 0, color: 'rgba(255,255,255,0.85)' }}>
            <strong style={{ color: '#00C37A' }}>Summary:</strong> We offer a 7-day free trial. Subscriptions can be cancelled anytime. We provide prorated refunds for annual plans cancelled within 30 days of billing. Monthly plans are non-refundable after the billing date.
          </p>
        </div>

        <h2 style={s.h2}>1. Free Trial</h2>
        <p style={s.p}>
          Veori AI offers a 7-day free trial for new accounts. No charge is made during the trial period. You may cancel at any time before the trial ends and you will not be billed. If you do not cancel before the trial ends, your subscription will begin and your payment method will be charged.
        </p>

        <h2 style={s.h2}>2. Monthly Subscriptions</h2>
        <p style={s.p}>
          Monthly subscriptions are billed on a recurring basis on the same day each month. Monthly subscription fees are non-refundable once the billing cycle has begun. You may cancel your subscription at any time and you will continue to have access until the end of your current billing period.
        </p>

        <h2 style={s.h2}>3. Annual Subscriptions</h2>
        <p style={s.p}>
          Annual subscriptions are eligible for a prorated refund if you cancel within 30 days of your annual billing date. To request a refund for an annual plan, contact our support team at <a href="mailto:support@veori.net" style={{ color: '#00C37A' }}>support@veori.net</a> within 30 days of your charge. After 30 days, annual subscriptions are non-refundable.
        </p>

        <h2 style={s.h2}>4. Eligibility for Refunds</h2>
        <p style={s.p}>Refunds may be issued in the following circumstances:</p>
        <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
          {[
            'You were charged in error (duplicate charge, wrong amount)',
            'A technical issue on our end prevented you from accessing the platform for more than 72 consecutive hours',
            'You are requesting a refund on an annual plan within the 30-day window',
            'You cancelled during the free trial period before being charged',
          ].map((item, i) => <li key={i} style={s.li}>{item}</li>)}
        </ul>

        <h2 style={s.h2}>5. Non-Refundable Situations</h2>
        <p style={s.p}>Refunds will not be issued in the following situations:</p>
        <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
          {[
            'Monthly subscription fees after the billing date',
            'Annual subscription fees after the 30-day refund window',
            'Accounts that have violated our Terms of Service',
            'Requests citing a change of mind or not using the platform',
            'Third-party costs incurred through the platform (e.g. phone call minutes, direct mail postage)',
          ].map((item, i) => <li key={i} style={s.li}>{item}</li>)}
        </ul>

        <h2 style={s.h2}>6. How to Request a Refund</h2>
        <p style={s.p}>
          To request a refund, email us at <a href="mailto:support@veori.net" style={{ color: '#00C37A' }}>support@veori.net</a> with the subject line "Refund Request" and include:
        </p>
        <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
          {[
            'Your account email address',
            'The date you were charged',
            'The amount charged',
            'The reason for the refund request',
          ].map((item, i) => <li key={i} style={s.li}>{item}</li>)}
        </ul>
        <p style={s.p}>
          We will respond within 3 business days. Approved refunds are processed within 5-10 business days and returned to your original payment method.
        </p>

        <h2 style={s.h2}>7. Subscription Cancellation</h2>
        <p style={s.p}>
          You can cancel your subscription at any time from your account Settings page. Cancellation takes effect at the end of your current billing period. You will not be charged again after cancellation, and you will retain full access until your billing period ends.
        </p>

        <h2 style={s.h2}>8. Changes to This Policy</h2>
        <p style={s.p}>
          We reserve the right to update this Refund Policy at any time. Changes will be posted on this page with an updated effective date. Continued use of the platform after changes constitutes acceptance of the revised policy.
        </p>

        <h2 style={s.h2}>9. Contact Us</h2>
        <p style={s.p}>
          Questions about this Refund Policy? Contact us at:<br />
          <a href="mailto:support@veori.net" style={{ color: '#00C37A' }}>support@veori.net</a><br />
          Veori AI &mdash; veori.net
        </p>
      </div>
    </div>
  )
}
