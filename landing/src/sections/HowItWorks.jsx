import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const steps = [
  {
    num: '01',
    title: 'Pay $197 today',
    body: 'Lock in founding operator pricing permanently. Standard pricing is $297/month after beta closes. Your rate never changes — not when we add features, not when we raise prices.',
  },
  {
    num: '02',
    title: 'Account activates in 48 hours',
    body: 'Create your own login inside the VEORI platform. We send you a setup link. No waiting on someone to onboard you manually.',
  },
  {
    num: '03',
    title: 'Upload your lead list',
    body: 'Drop in a CSV with your leads. Names, numbers, addresses. That\'s all VEORI needs to get to work. No complex setup. No API integrations required.',
  },
  {
    num: '04',
    title: 'VEORI starts calling immediately',
    body: 'AI begins working through your list automatically. Natural conversations. Handles objections. Books callbacks. Scores every interaction in real time.',
  },
  {
    num: '05',
    title: 'Review scored leads and contracts daily',
    body: 'Every morning you see exactly who is ready to move. Hot leads flagged. Motivation scores visible. Your only job is to close the ones VEORI brings you.',
  },
]

function Step({ step, index }) {
  const { ref, visible } = useReveal()
  const isLast = index === steps.length - 1

  return (
    <div ref={ref} style={{ display: 'flex', gap: 24, position: 'relative' }}>
      {/* Left: number + line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 52 }}>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={visible ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: index * 0.12, ease: [0.22,1,0.36,1] }}
          style={{ width: 52, height: 52, borderRadius: '50%', border: '1px solid rgba(201,168,76,0.30)', background: 'rgba(201,168,76,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: '#C9A84C', flexShrink: 0, zIndex: 2 }}
        >
          {step.num}
        </motion.div>
        {!isLast && (
          <motion.div
            initial={{ scaleY: 0, opacity: 0 }}
            animate={visible ? { scaleY: 1, opacity: 1 } : {}}
            transition={{ duration: 0.8, delay: index * 0.12 + 0.3, ease: 'easeOut' }}
            style={{ width: 1, flex: 1, minHeight: 40, background: 'linear-gradient(to bottom, rgba(0,196,123,0.5), rgba(0,196,123,0.08))', marginTop: 8, transformOrigin: 'top' }}
          />
        )}
      </div>

      {/* Right: content */}
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={visible ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.65, delay: index * 0.12 + 0.08, ease: [0.22,1,0.36,1] }}
        style={{ paddingBottom: isLast ? 0 : 48, paddingTop: 12 }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.025em', color: '#fff', marginBottom: 10 }}>{step.title}</div>
        <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.52)', lineHeight: 1.7, maxWidth: 480 }}>{step.body}</div>
      </motion.div>
    </div>
  )
}

export default function HowItWorks() {
  const { ref, visible } = useReveal()

  return (
    <section id="how" style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
          style={{ marginBottom: 64 }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14 }}>How it works</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14 }}>
            You pay today.<br />Leads get called tonight.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.52)', lineHeight: 1.65 }}>
            Five steps from signup to your first scored lead. Most of it happens automatically.
          </p>
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((s, i) => <Step key={s.num} step={s} index={i} />)}
        </div>
      </div>
    </section>
  )
}
