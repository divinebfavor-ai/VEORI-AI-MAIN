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
      transition={{ duration: 0.7, delay, ease: [0.28,0.11,0.32,1] }}
      style={{
        flex: 1,
        background: '#fff',
        border: highlighted ? '1px solid rgba(0,196,123,0.35)' : '1px solid rgba(0,0,0,0.06)',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: highlighted ? '0 2px 4px rgba(0,196,123,0.04), 0 20px 48px rgba(0,196,123,0.12)' : '0 1px 2px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.05)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '22px 26px', borderBottom: `1px solid ${highlighted ? 'rgba(0,196,123,0.14)' : 'rgba(0,0,0,0.06)'}`, display: 'flex', alignItems: 'center', gap: 10, background: highlighted ? 'rgba(0,196,123,0.04)' : 'transparent' }}>
        {highlighted && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C47B', position: 'relative' }}><div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: 'rgba(0,196,123,0.3)', animation: 'pulse-ring 2s ease-out infinite' }} /></div>}
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: highlighted ? 'var(--color-green-ink)' : '#86868B' }}>{title}</div>
      </div>
      {/* Rows */}
      {rows.map((row, i) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 26px', borderBottom: i < rows.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
          <span style={{ fontSize: 14, color: '#6E6E73' }}>{row.label}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: row.good ? 'var(--color-green-ink)' : row.bad ? '#C7362F' : '#1D1D1F', fontFamily: 'JetBrains Mono, monospace' }}>{row.value}</span>
        </div>
      ))}
    </motion.div>
  )
}

export default function Comparison() {
  const { ref, visible } = useReveal()

  return (
    <section style={{ padding: '120px 24px', background: '#fff' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.28,0.11,0.32,1] }}
          style={{ textAlign: 'center', marginBottom: 64 }}
        >
          <div className="eyebrow" style={{ marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>The math</div>
          <h2 className="headline" style={{ fontSize: 'clamp(30px,4.2vw,50px)', color: '#1D1D1F', marginBottom: 18 }}>
            One VA. 80 calls a day.<br />VEORI does 500 — and never quits.
          </h2>
          <p style={{ fontSize: 'clamp(17px,1.6vw,20px)', fontWeight: 400, color: '#6E6E73', maxWidth: 540, margin: '0 auto', lineHeight: 1.55 }}>
            For about what one human VA costs, VEORI works 24/7, stays perfectly consistent, and never needs training. Then it scales.
          </p>
        </motion.div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <SideCard title="Human VA" rows={humanRows} highlighted={false} delay={0.05} />

          {/* Divider */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 28, padding: '20px 0' }}>
            <div style={{ width: 1, flex: 1, background: 'linear-gradient(to bottom, transparent, rgba(0,196,123,0.5), transparent)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: '#00C47B', boxShadow: '0 0 12px rgba(0,196,123,0.6)', animation: 'pulse-ring 2s ease-out infinite' }} />
            </div>
          </div>

          <SideCard title="VEORI AI" rows={veoriRows} highlighted={true} delay={0.12} />
        </div>
      </div>
    </section>
  )
}
