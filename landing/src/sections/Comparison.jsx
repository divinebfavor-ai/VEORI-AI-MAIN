import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const humanRows = [
  { label: 'Cost', value: '$1,500/month', bad: true },
  { label: 'Availability', value: '8 hours/day', bad: true },
  { label: 'Consistency', value: 'Varies daily', bad: true },
  { label: 'Sick days', value: 'Yes', bad: true },
  { label: 'Training required', value: 'Always', bad: true },
  { label: 'Quits after 6 months', value: 'Usually', bad: true },
  { label: 'Calls per day', value: '80–120', bad: true },
]

const veoriRows = [
  { label: 'Cost', value: 'From $1,499/mo', good: true },
  { label: 'Availability', value: '24/7/365', good: true },
  { label: 'Consistency', value: 'Perfect every call', good: true },
  { label: 'Sick days', value: 'Never', good: true },
  { label: 'Training required', value: 'None', good: true },
  { label: 'Quits', value: 'Never', good: true },
  { label: 'Calls per day', value: '500', good: true },
]

function SideCard({ title, rows, highlighted, delay = 0 }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: highlighted ? 24 : -24 }}
      animate={visible ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22,1,0.36,1] }}
      style={{
        flex: 1,
        background: highlighted ? 'linear-gradient(160deg, rgba(0,196,123,0.08), rgba(0,196,123,0.03))' : 'rgba(255,255,255,0.015)',
        border: highlighted ? '1px solid rgba(0,196,123,0.28)' : '1px solid rgba(255,255,255,0.05)',
        borderRadius: 16,
        overflow: 'hidden',
        opacity: highlighted ? 1 : 0.55,
        transition: 'opacity 0.3s',
      }}
      whileHover={{ opacity: 1, transition: { duration: 0.2 } }}
    >
      {/* Header */}
      <div style={{ padding: '20px 26px', borderBottom: `1px solid ${highlighted ? 'rgba(0,196,123,0.16)' : 'rgba(255,255,255,0.05)'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        {highlighted && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C47B', position: 'relative' }}><div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: 'rgba(0,196,123,0.3)', animation: 'pulse-ring 2s ease-out infinite' }} /></div>}
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em', color: highlighted ? '#00C47B' : 'rgba(255,255,255,0.50)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11 }}>{title}</div>
      </div>
      {/* Rows */}
      {rows.map((row, i) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 26px', borderBottom: i < rows.length - 1 ? `1px solid ${highlighted ? 'rgba(0,196,123,0.08)' : 'rgba(255,255,255,0.04)'}` : 'none' }}>
          <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.45)' }}>{row.label}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: row.good ? '#00C47B' : row.bad ? 'rgba(255,80,80,0.75)' : '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{row.value}</span>
        </div>
      ))}
    </motion.div>
  )
}

export default function Comparison() {
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
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14 }}>The math</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,44px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14 }}>
            One VA. 80 calls a day.<br />VEORI does 500 — and never quits.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', maxWidth: 460, margin: '0 auto', lineHeight: 1.65 }}>
            For about what one human VA costs, VEORI works 24/7, stays perfectly consistent, and never needs training. Then it scales.
          </p>
        </motion.div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <SideCard title="Human VA" rows={humanRows} highlighted={false} delay={0.05} />

          {/* Divider */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 28, padding: '20px 0' }}>
            <div style={{ width: 1, flex: 1, background: 'linear-gradient(to bottom, transparent, rgba(0,196,123,0.6), transparent)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: '#00C47B', boxShadow: '0 0 12px rgba(0,196,123,0.7)', animation: 'pulse-ring 2s ease-out infinite' }} />
            </div>
          </div>

          <SideCard title="VEORI AI" rows={veoriRows} highlighted={true} delay={0.12} />
        </div>
      </div>
    </section>
  )
}
