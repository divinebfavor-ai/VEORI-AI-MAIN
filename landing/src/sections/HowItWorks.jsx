import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const steps = [
  {
    num: '01',
    title: 'Pay $197 today',
    body: 'Lock in founding operator pricing permanently. Standard pricing is $297/month after beta closes. Your rate never changes.',
  },
  {
    num: '02',
    title: 'Account activates in 48 hours',
    body: 'Create your own login inside the VEORI platform. We send you a setup link. No waiting on someone to manually onboard you.',
  },
  {
    num: '03',
    title: 'Upload your seller list',
    body: 'Drop in a CSV with your leads. Names, numbers, addresses. VEORI starts calling automatically. Natural conversations, handles objections, scores every seller 0 to 100.',
  },
  {
    num: '04',
    title: 'VEORI qualifies and makes offers',
    body: 'Hot sellers are flagged by motivation score. VEORI makes cash offers based on your criteria. Consistent pitch every time. No variance, no emotion, just execution.',
  },
  {
    num: '05',
    title: 'Contract sent for e-sign automatically',
    body: 'The moment a seller agrees, VEORI generates the contract and sends it for e-signature. Once signed, it forwards it directly to your agent. No manual steps.',
  },
  {
    num: '06',
    title: 'Upload your buyer list',
    body: 'VEORI calls your buyers, qualifies them for budget, criteria, and timeline, then presents the deal. Both sides worked. Both sides qualified. All automated.',
  },
  {
    num: '07',
    title: 'Title company booked and called',
    body: 'Select your preferred title company inside VEORI. The AI calls them, delivers the contract, follows up on schedule, and tracks every step through to closing.',
  },
  {
    num: '08',
    title: 'Deal closes. You collect.',
    body: 'VEORI managed the full cycle. You reviewed the dashboard. That is the only job you had. Scale by uploading more lists.',
  },
]

function Step({ step, index }) {
  const { ref, visible } = useReveal()
  const isLast = index === steps.length - 1

  return (
    <div ref={ref} style={{ display: 'flex', gap: 24, position: 'relative' }}>
      {/* Left: number + connecting line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 52 }}>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={visible ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22,1,0.36,1] }}
          style={{
            width: 52, height: 52, borderRadius: '50%',
            border: '1px solid rgba(201,168,76,0.30)',
            background: 'rgba(201,168,76,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600,
            color: '#C9A84C', flexShrink: 0, zIndex: 2,
          }}
        >
          {step.num}
        </motion.div>
        {!isLast && (
          <motion.div
            initial={{ scaleY: 0, opacity: 0 }}
            animate={visible ? { scaleY: 1, opacity: 1 } : {}}
            transition={{ duration: 0.9, delay: index * 0.06 + 0.3, ease: 'easeOut' }}
            style={{ width: 1, flex: 1, minHeight: 32, background: 'linear-gradient(to bottom, rgba(0,196,123,0.5), rgba(0,196,123,0.06))', marginTop: 8, transformOrigin: 'top' }}
          />
        )}
      </div>

      {/* Right: content */}
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={visible ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.6, delay: index * 0.06 + 0.08, ease: [0.22,1,0.36,1] }}
        style={{ paddingBottom: isLast ? 0 : 44, paddingTop: 12 }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.025em', color: '#fff', marginBottom: 8 }}>{step.title}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.50)', lineHeight: 1.70, maxWidth: 480 }}>{step.body}</div>
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
            Seller to buyer to signed.<br />VEORI runs the whole thing.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.50)', lineHeight: 1.65 }}>
            From first outbound call to closed title. Eight steps. Your only job is to review the dashboard.
          </p>
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((s, i) => <Step key={s.num} step={s} index={i} />)}
        </div>
      </div>
    </section>
  )
}
