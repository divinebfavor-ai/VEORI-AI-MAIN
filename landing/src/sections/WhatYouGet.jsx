import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const features = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.88a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
    title: 'AI Calls Sellers and Buyers',
    body: 'Upload your seller list and VEORI calls every one automatically. Upload your buyer list and VEORI calls them too. Natural conversations on both sides. No robotic scripts.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: 'Qualifies Both Sides',
    body: 'Every seller call is scored 0 to 100 for motivation. Every buyer is qualified for criteria, budget, and timeline. VEORI surfaces who is ready to move on both ends of the deal.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      </svg>
    ),
    title: 'Makes and Presents Offers',
    body: 'VEORI makes cash offers to sellers based on your criteria. When a deal is locked, it presents the opportunity to buyers in your network. Confident, consistent pitches every time.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
    title: 'E-Sign and Contract Delivery',
    body: 'Contracts are generated and sent for e-signature automatically the moment a seller agrees. Once signed, VEORI sends the contract to your agent without you touching a thing.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    title: 'Title Company Coordination',
    body: 'Book your preferred title company inside VEORI. The AI calls them, delivers the contract, follows up on the schedule, and tracks the closing. You stay out of the admin loop.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
    title: 'Property Photo Requests',
    body: 'VEORI automatically requests property photos from sellers during or after a call. Photos are stored directly in your deal dashboard alongside call recordings and notes.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: '24/7 Operation',
    body: 'Works while you sleep. No time zones, no weekends off, no sick days. Calls happen around the clock across your full pipeline — sellers, buyers, and title — without you touching it.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
    ),
    title: 'Full Deal CRM',
    body: 'Every call recording, motivation score, transcript, photo, contract, and status update lives in one dashboard. Your entire pipeline — from first contact to closing — visible in one place.',
  },
]

function Card({ feature, index }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, delay: index * 0.07, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
      style={{
        background: '#0A1526',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: '2px solid #00C47B',
        borderRadius: 14,
        padding: '28px 26px',
        cursor: 'default',
      }}
    >
      <div style={{ marginBottom: 16 }}>{feature.icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: '#fff', letterSpacing: '-0.02em' }}>{feature.title}</div>
      <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.50)', lineHeight: 1.68 }}>{feature.body}</div>
    </motion.div>
  )
}

export default function WhatYouGet() {
  const { ref, visible } = useReveal()

  return (
    <section id="platform" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      <div className="grid-pattern" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14 }}>What you get today</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14 }}>
            From first call to closed deal.<br />All of it. Automated.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.52)', maxWidth: 560, lineHeight: 1.65, marginBottom: 56 }}>
            VEORI doesn't just call sellers. It works both sides of every deal — sellers, buyers, agents, and title companies — from first contact to closing.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16 }}>
          {features.map((f, i) => <Card key={f.title} feature={f} index={i} />)}
        </div>
      </div>
    </section>
  )
}
