import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'
import { useState } from 'react'

const API_URL = 'https://veori-ai-main.up.railway.app/api/billing'

const foundingIncluded = [
  '500 AI calls/month (sellers and buyers)',
  'Real-time motivation scoring (0–100)',
  'Automated offer delivery to sellers',
  'Buyer list calling and qualification',
  'E-sign and automatic agent delivery',
  'Title company booking and follow-up',
  'Property photo requests',
  'Full CRM dashboard with recordings',
  '24/7 automated operation',
  'Rate locked permanently',
  'All future features, no upgrade fees',
]

const otherPlans = [
  {
    name: 'Standard',
    price: '$297',
    cycle: '/month',
    note: 'After beta closes',
    calls: '500 AI calls/month',
    features: [
      '500 AI calls/month',
      'Seller and buyer calling',
      'Motivation scoring',
      'E-sign and agent delivery',
      'Title company coordination',
      'Full CRM dashboard',
    ],
  },
  {
    name: 'Grind',
    price: '$697',
    cycle: '/month',
    note: 'Most popular at scale',
    calls: '2,000 AI calls/month',
    features: [
      '2,000 AI calls/month',
      'All Standard features',
      'Advanced scoring model',
      'Multi-list management',
      'Priority support',
    ],
  },
  {
    name: 'Empire',
    price: '$1,497',
    cycle: '/month',
    note: 'Multi-market operators',
    calls: '5,000 AI calls/month',
    features: [
      '5,000 AI calls/month',
      'All Grind features',
      'Multi-market campaigns',
      'Dedicated success manager',
      'Custom integrations',
    ],
  },
  {
    name: 'Dynasty',
    price: '$4,997',
    cycle: '/month',
    note: 'Enterprise operations',
    calls: '15,000 AI calls/month',
    features: [
      '15,000 AI calls/month',
      'All Empire features',
      'White-label option',
      'SLA guarantee',
      'Custom build-outs',
    ],
  },
]

// Waitlist modal
function WaitlistModal({ plan, onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true)
    try {
      await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, plan: plan.name.toLowerCase(), type: 'waitlist' }),
      })
    } catch {}
    setLoading(false)
    setDone(true)
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,10,20,0.88)', backdropFilter: 'blur(14px)', display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22,1,0.36,1] }}
        style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '40px 36px', maxWidth: 420, width: '100%', position: 'relative' }}
      >
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}
          onMouseEnter={e => e.target.style.color = '#fff'}
          onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}
        >&times;</button>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 10 }}>Join the waitlist</div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 6 }}>{plan.name} Plan</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 1.6 }}>
          {plan.price}/month · {plan.calls}.<br />
          We'll reach out when this plan opens.
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            <input
              type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '13px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 15, fontWeight: 700, borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.10)'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.06)'; }}
            >
              {loading ? 'Saving...' : `Join ${plan.name} Waitlist →`}
            </button>
          </form>
        ) : (
          <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', borderRadius: 10, padding: '18px', fontSize: 15, color: '#00C47B', fontWeight: 600, textAlign: 'center' }}>
            You're on the list. We'll reach out when {plan.name} opens.
          </div>
        )}
      </motion.div>
    </div>
  )
}

function OtherPlanCard({ plan, index, onSelect }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -3, transition: { duration: 0.22 } }}
      style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{plan.note}</div>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>{plan.name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{plan.price}</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>{plan.cycle}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#00C47B', fontWeight: 600, marginBottom: 20 }}>{plan.calls}</div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 18, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {plan.features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'rgba(0,196,123,0.7)', flexShrink: 0, marginTop: 1 }}>✓</span>
            <span style={{ color: 'rgba(255,255,255,0.60)' }}>{f}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSelect(plan)}
        style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.80)', fontSize: 14, fontWeight: 700, borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
        onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.09)'; e.target.style.borderColor = 'rgba(255,255,255,0.18)'; e.target.style.color = '#fff'; }}
        onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.05)'; e.target.style.borderColor = 'rgba(255,255,255,0.10)'; e.target.style.color = 'rgba(255,255,255,0.80)'; }}
      >
        Join Waitlist →
      </button>
    </motion.div>
  )
}

export default function Pricing() {
  const { ref, visible } = useReveal()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [waitlistPlan, setWaitlistPlan] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.includes('@')) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, plan: 'founding' }),
      })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
    } catch {}
    setLoading(false)
    setDone(true)
  }

  return (
    <section id="pricing" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      {waitlistPlan && <WaitlistModal plan={waitlistPlan} onClose={() => setWaitlistPlan(null)} />}

      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 500, background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.06) 0%, transparent 70%)', pointerEvents: 'none', animation: 'glow-breathe 5s ease-in-out infinite' }} />

      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
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
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 }}>
            Founding operators lock in $197/month permanently. All other plans open when beta closes.
          </p>
        </motion.div>

        {/* Founding card — full width, featured */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22,1,0.36,1] }}
          style={{ background: '#0A1526', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 0 80px rgba(201,168,76,0.07), 0 32px 80px rgba(0,0,0,0.35)', position: 'relative', marginBottom: 20 }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.7), transparent)' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {/* Left */}
            <div style={{ padding: '40px 44px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#000', background: '#C9A84C', padding: '4px 14px', borderRadius: 100, marginBottom: 24 }}>Founding · Beta Only</div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginTop: 10 }}>$</span>
                <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>197</span>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 12 }}>
                  <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)' }}>/month</span>
                  <span style={{ fontSize: 12, color: '#C9A84C', fontWeight: 700 }}>locked forever</span>
                </div>
              </div>

              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.32)', marginBottom: 28 }}>
                <span style={{ textDecoration: 'line-through', textDecorationColor: 'rgba(255,80,80,0.5)' }}>$297/mo</span>
                <span style={{ marginLeft: 8 }}>standard rate after beta</span>
              </div>

              {!done ? (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required
                    style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <input
                    type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} required
                    style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(0,196,123,0.38)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <button
                    type="submit" disabled={loading}
                    style={{ width: '100%', padding: '14px', background: '#00C47B', color: '#000', fontSize: 15, fontWeight: 800, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.target.style.background = '#00d986'; e.target.style.boxShadow = '0 10px 32px rgba(0,196,123,0.40)'; }}
                    onMouseLeave={e => { e.target.style.background = '#00C47B'; e.target.style.boxShadow = 'none'; }}
                  >
                    {loading ? 'Redirecting...' : 'Lock In $197/Month Forever →'}
                  </button>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 2, textAlign: 'center' }}>First 50 operators only. Rate never changes.</p>
                </form>
              ) : (
                <div style={{ background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', borderRadius: 10, padding: '18px', fontSize: 15, color: '#00C47B', fontWeight: 600, textAlign: 'center' }}>
                  You're in. We'll reach out within 24 hours.
                </div>
              )}
            </div>

            {/* Right — features */}
            <div style={{ padding: '40px 44px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 20 }}>Everything included</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {foundingIncluded.map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                    <span style={{ color: '#00C47B', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Other plans grid */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', textAlign: 'center', marginBottom: 20 }}>
            Other plans, join the waitlist
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {otherPlans.map((plan, i) => (
              <OtherPlanCard key={plan.name} plan={plan} index={i} onSelect={setWaitlistPlan} />
            ))}
          </div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(255,255,255,0.25)', marginTop: 24 }}
        >
          All plans billed monthly. Cancel anytime. Founding operator rate ($197/month) is locked permanently and never increases.
        </motion.p>
      </div>
    </section>
  )
}
