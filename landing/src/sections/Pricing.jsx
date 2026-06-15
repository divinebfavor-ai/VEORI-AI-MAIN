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
      whileHover={{ y: -3, transition: { duration: 0.22 } }}
      style={{
        background: popular ? 'linear-gradient(160deg, rgba(0,196,123,0.10), rgba(0,196,123,0.03))' : '#0A1526',
        border: popular ? '1px solid rgba(0,196,123,0.40)' : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 0,
        position: 'relative', boxShadow: popular ? '0 0 60px rgba(0,196,123,0.06)' : 'none',
      }}
    >
      {popular && (
        <div style={{ position: 'absolute', top: -11, left: 22, fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#000', background: '#00C47B', padding: '3px 11px', borderRadius: 100 }}>
          Most Popular
        </div>
      )}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{plan.note}</div>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>{plan.name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{plan.price}</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>{plan.cycle}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#00C47B', fontWeight: 600, marginBottom: 20 }}>{plan.outreach}</div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 18, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {plan.features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'rgba(0,196,123,0.7)', flexShrink: 0, marginTop: 1 }}>✓</span>
            <span style={{ color: 'rgba(255,255,255,0.60)' }}>{f}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => startCheckout(plan.key)}
        style={{ width: '100%', padding: '12px', background: popular ? '#00C47B' : 'rgba(255,255,255,0.05)', border: popular ? 'none' : '1px solid rgba(255,255,255,0.10)', color: popular ? '#000' : 'rgba(255,255,255,0.80)', fontSize: 14, fontWeight: 700, borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
        onMouseEnter={e => { if (popular) { e.target.style.background = '#00d986'; } else { e.target.style.background = 'rgba(255,255,255,0.09)'; e.target.style.borderColor = 'rgba(255,255,255,0.18)'; e.target.style.color = '#fff'; } }}
        onMouseLeave={e => { if (popular) { e.target.style.background = '#00C47B'; } else { e.target.style.background = 'rgba(255,255,255,0.05)'; e.target.style.borderColor = 'rgba(255,255,255,0.10)'; e.target.style.color = 'rgba(255,255,255,0.80)'; } }}
      >
        Get {plan.name} →
      </button>
    </motion.div>
  )
}

export default function Pricing() {
  const { ref, visible } = useReveal()

  return (
    <section id="pricing" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 500, background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.06) 0%, transparent 70%)', pointerEvents: 'none', animation: 'glow-breathe 5s ease-in-out infinite' }} />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
          style={{ textAlign: 'center', marginBottom: 56 }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14 }}>Pricing</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14 }}>
            Simple. No surprises.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 520, margin: '0 auto', lineHeight: 1.65 }}>
            Pick the plan that fits your deal volume. Every plan includes every feature. Cancel anytime.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.key} plan={plan} index={i} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(255,255,255,0.25)', marginTop: 28 }}
        >
          All plans billed monthly. Cancel anytime. Every plan includes the full platform — no feature gates, no upgrade fees.
        </motion.p>
      </div>
    </section>
  )
}
