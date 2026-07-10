import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const items = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94741F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    title: 'Automatic Lead Sourcing',
    body: 'VEORI pulls motivated sellers directly from county public records. Distressed, pre-foreclosure, probate, absentee. No manual searching.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94741F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: 'Expired Listing Auto-Contact',
    body: 'VEORI detects expired MLS listings and reaches out within 60 minutes. Before any other investor gets there.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94741F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Buyer Matching and Deal Automation',
    body: 'VEORI matches your contracts to buyers in your network automatically. Assignment fees calculated. Deals move without you coordinating manually.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94741F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
    title: 'Contract Generation in 4 Minutes',
    body: 'The moment a seller agrees, VEORI drafts, populates, and sends a compliant contract. No delays. No lost deals.',
  },
]

function Card({ item, index }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.09, ease: [0.28,0.11,0.32,1] }}
      style={{ background: '#fff', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 18, padding: '28px 26px', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(201,168,76,0.06)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {item.icon}
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-gold-ink)', background: 'rgba(201,168,76,0.12)', padding: '3px 10px', borderRadius: 980 }}>Coming Soon</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 10, color: '#1D1D1F' }}>{item.title}</div>
      <div style={{ fontSize: 14, color: '#6E6E73', lineHeight: 1.62 }}>{item.body}</div>
    </motion.div>
  )
}

export default function ComingSoon() {
  const { ref, visible } = useReveal()
  return (
    <section style={{ padding: '120px 24px', background: '#F5F5F7' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.28,0.11,0.32,1] }}
          style={{ textAlign: 'center', marginBottom: 64 }}
        >
          <div className="eyebrow-gold" style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Coming soon</div>
          <h2 className="headline" style={{ fontSize: 'clamp(30px,4.2vw,48px)', color: '#1D1D1F', marginBottom: 18 }}>
            The roadmap is already built.<br />Every operator gets it all.
          </h2>
          <p style={{ fontSize: 'clamp(17px,1.6vw,20px)', fontWeight: 400, color: '#6E6E73', maxWidth: 520, margin: '0 auto', lineHeight: 1.55 }}>
            These features are in active development. Every plan gets them automatically at no extra cost.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          {items.map((item, i) => <Card key={item.title} item={item} index={i} />)}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.4 }}
          style={{ textAlign: 'center', marginTop: 48, fontSize: 15, color: '#6E6E73' }}
        >
          Every operator gets every future feature unlocked automatically. <strong style={{ color: 'var(--color-gold-ink)' }}>No upgrade fees. Ever.</strong>
        </motion.div>
      </div>
    </section>
  )
}
