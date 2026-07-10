import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

// Marketing site → routes to the in-app billing page, where the live
// Flutterwave checkout runs (?plan= auto-launches checkout — see Billing.jsx).
const APP_URL = 'https://veori.net'

// 5 board-approved plans. "outreach" = operator-facing monthly volume label.
const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$1,499',
    cycle: '/month',
    note: 'Solo operators getting started',
    outreach: '10,000 outreach/month',
    features: [
      '10,000 outreach/month',
      'Seller and buyer calling',
      'Real-time motivation scoring (0–100)',
      'Automated offer delivery',
      'E-sign and agent delivery',
      'Full CRM dashboard',
      'Email support',
    ],
  },
  {
    key: 'solo',
    name: 'Solo',
    price: '$2,999',
    cycle: '/month',
    note: 'Growing single-market operators',
    outreach: '25,000 outreach/month',
    features: [
      '25,000 outreach/month',
      'All Starter features',
      'Title company coordination',
      'Property photo requests',
      'Priority support',
    ],
  },
  {
    key: 'operator',
    name: 'Operator',
    price: '$4,999',
    cycle: '/month',
    note: 'Most popular',
    outreach: '50,000 outreach/month',
    popular: true,
    features: [
      '50,000 outreach/month',
      'All Solo features',
      'Custom calling sequences',
      'Advanced scoring model',
      'Priority support',
    ],
  },
  {
    key: 'scale',
    name: 'Scale',
    price: '$8,999',
    cycle: '/month',
    note: 'Multi-market teams',
    outreach: '100,000 outreach/month',
    features: [
      '100,000 outreach/month',
      'All Operator features',
      'Multi-market campaigns',
      'Custom sequences',
      'Dedicated support',
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: '$14,999',
    cycle: '/month',
    note: 'High-volume operations',
    outreach: '200,000 outreach/month',
    features: [
      '200,000 outreach/month',
      'All Scale features',
      'White-glove setup',
      'Dedicated account manager',
      'Custom integrations',
    ],
  },
]

function startCheckout(planKey) {
  // Hand off to the in-app billing page, which runs the live checkout.
  window.location.href = `${APP_URL}/billing?plan=${planKey}`
}

function PlanCard({ plan, index }) {
  const { ref, visible } = useReveal()
  const popular = !!plan.popular
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.22,1,0.36,1] }}
      style={{
        background: '#fff',
        border: popular ? '1px solid rgba(0,196,123,0.40)' : '1px solid rgba(0,0,0,0.06)',
        borderRadius: 20, padding: '30px 24px', display: 'flex', flexDirection: 'column', gap: 0,
        position: 'relative',
        boxShadow: popular ? '0 2px 4px rgba(0,196,123,0.05), 0 20px 48px rgba(0,196,123,0.12)' : '0 1px 2px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.05)',
        transition: 'transform 0.35s var(--ease-apple), box-shadow 0.35s var(--ease-apple)',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = '' }}
    >
      {popular && (
        <div style={{ position: 'absolute', top: -11, left: 22, fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#000', background: '#00C47B', padding: '4px 12px', borderRadius: 980 }}>
          Most Popular
        </div>
      )}
      <div style={{ fontSize: 11, color: '#86868B', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{plan.note}</div>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: '#1D1D1F', marginBottom: 6 }}>{plan.name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.04em', color: '#1D1D1F', fontVariantNumeric: 'tabular-nums' }}>{plan.price}</span>
        <span style={{ fontSize: 13, color: '#86868B' }}>{plan.cycle}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-green-ink)', fontWeight: 600, marginBottom: 22 }}>{plan.outreach}</div>

      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 20, marginBottom: 26, display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        {plan.features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5 }}>
            <span style={{ color: 'var(--color-green-ink)', flexShrink: 0, marginTop: 1, fontWeight: 700 }}>✓</span>
            <span style={{ color: '#6E6E73' }}>{f}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => startCheckout(plan.key)}
        className="btn-apple"
        style={{ width: '100%', padding: '13px', background: popular ? '#00C47B' : '#F5F5F7', border: popular ? 'none' : '1px solid rgba(0,0,0,0.08)', color: popular ? '#000' : '#1D1D1F', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
        onMouseEnter={e => { if (popular) { e.currentTarget.style.background = '#00d986'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,196,123,0.32)' } else { e.currentTarget.style.background = '#EBEBED' } }}
        onMouseLeave={e => { if (popular) { e.currentTarget.style.background = '#00C47B'; e.currentTarget.style.boxShadow = 'none' } else { e.currentTarget.style.background = '#F5F5F7' } }}
      >
        Get {plan.name} →
      </button>
    </motion.div>
  )
}

export default function Pricing() {
  const { ref, visible } = useReveal()

  return (
    <section id="pricing" style={{ padding: '120px 24px', position: 'relative', background: '#fff' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.28,0.11,0.32,1] }}
          style={{ textAlign: 'center', marginBottom: 64 }}
        >
          <div className="eyebrow" style={{ marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pricing</div>
          <h2 className="headline" style={{ fontSize: 'clamp(32px,4.4vw,52px)', color: '#1D1D1F', marginBottom: 18 }}>
            Simple. No surprises.
          </h2>
          <p style={{ fontSize: 'clamp(17px,1.6vw,20px)', fontWeight: 400, color: '#6E6E73', maxWidth: 560, margin: '0 auto', lineHeight: 1.55 }}>
            Pick the plan that fits your deal volume. Every plan includes every feature. Cancel anytime.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18 }}>
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.key} plan={plan} index={i} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center', fontSize: 13, color: '#86868B', marginTop: 32 }}
        >
          All plans billed monthly. Cancel anytime. Every plan includes the full platform — no feature gates, no upgrade fees.
        </motion.p>
      </div>
    </section>
  )
}
