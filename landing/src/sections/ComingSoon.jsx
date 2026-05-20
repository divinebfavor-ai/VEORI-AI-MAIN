import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const items = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    title: 'Automatic Lead Sourcing',
    body: 'VEORI pulls motivated sellers directly from county public records. Distressed, pre-foreclosure, probate, absentee. No manual searching.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: 'Expired Listing Auto-Contact',
    body: 'VEORI detects expired MLS listings and reaches out within 60 minutes. Before any other investor gets there.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Buyer Matching and Deal Automation',
    body: 'VEORI matches your contracts to buyers in your network automatically. Assignment fees calculated. Deals move without you coordinating manually.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
      transition={{ duration: 0.6, delay: index * 0.09, ease: [0.22,1,0.36,1] }}
      style={{ background: 'rgba(201,168,76,0.03)', border: '1px dashed rgba(201,168,76,0.22)', borderRadius: 14, padding: '26px 24px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {item.icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#C9A84C', background: 'rgba(201,168,76,0.10)', padding: '3px 9px', borderRadius: 100 }}>Coming Soon</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10, color: '#fff' }}>{item.title}</div>
      <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65 }}>{item.body}</div>
    </motion.div>
  )
}

export default function ComingSoon() {
  const { ref, visible } = useReveal()
  return (
    <section style={{ padding: '100px 24px', background: 'rgba(255,255,255,0.012)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
          style={{ textAlign: 'center', marginBottom: 56 }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 14 }}>Coming soon</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,42px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.1, marginBottom: 14 }}>
            The roadmap is already built.<br />Founding operators get it all free.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 }}>
            These features are in active development. Every founding operator gets them automatically at no extra cost.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          {items.map((item, i) => <Card key={item.title} item={item} index={i} />)}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.4 }}
          style={{ textAlign: 'center', marginTop: 40, fontSize: 14, color: 'rgba(255,255,255,0.38)' }}
        >
          Founding operators get every future feature unlocked automatically. <strong style={{ color: '#C9A84C' }}>No upgrade fees. Ever.</strong>
        </motion.div>
      </div>
    </section>
  )
}
