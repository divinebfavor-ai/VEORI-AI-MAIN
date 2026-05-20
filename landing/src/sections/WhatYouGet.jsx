import { motion } from 'framer-motion'
import { useReveal } from '../components/useReveal'

const features = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.88a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
    title: 'Voice AI Calling',
    body: 'Upload your leads. VEORI calls them automatically with a natural, conversational voice. No robotic scripts. No dead air. Every call sounds like a trained acquisitions rep.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: 'Real-Time Qualification',
    body: 'Every call is scored 0 to 100 based on seller motivation, timeline, and equity. Hot leads are flagged immediately so you never waste time on the wrong conversations.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    title: 'Automated Offers',
    body: 'VEORI makes cash offers based on your criteria. Sellers hear a confident, consistent pitch every single time. No variance. No emotion. Just execution.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: '24/7 Operation',
    body: 'Works while you sleep. No time zones. No weekends off. Calls happen around the clock without you touching a thing. Your pipeline never goes quiet.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C47B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
    title: 'CRM Dashboard',
    body: 'Every call recording, note, score, and transcript stored in your dashboard. Nothing falls through the cracks. Your entire pipeline visible in one place.',
  },
]

function Card({ feature, index }) {
  const { ref, visible } = useReveal()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, delay: index * 0.08, ease: [0.22,1,0.36,1] }}
      whileHover={{ y: -4, transition: { duration: 0.25 } }}
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
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.52)', lineHeight: 1.68 }}>{feature.body}</div>
    </motion.div>
  )
}

export default function WhatYouGet() {
  const { ref: labelRef, visible: labelVis } = useReveal()

  return (
    <section id="platform" style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      <div className="grid-pattern" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
        <motion.div
          ref={labelRef}
          initial={{ opacity: 0, y: 16 }}
          animate={labelVis ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22,1,0.36,1] }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00C47B', marginBottom: 14 }}>What you get today</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,46px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.08, marginBottom: 14 }}>
            Everything a full acquisitions<br />team does. For $197/month.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', maxWidth: 500, lineHeight: 1.65, marginBottom: 56 }}>
            These are live features available to founding operators right now. Not roadmap promises.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16 }}>
          {features.map((f, i) => <Card key={f.title} feature={f} index={i} />)}
        </div>
      </div>
    </section>
  )
}
