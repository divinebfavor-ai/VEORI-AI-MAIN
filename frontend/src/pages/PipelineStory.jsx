import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion'
import { useRef, useState } from 'react'

/* ══════════════════════════════════════════════════════════════════════════
   PipelineStory — scroll-driven narrative.
   One seller ("Maria, Dallas") travels the whole machine as you scroll:
   Finds → Calls → Texts → Scores → Closes. A persistent glass device
   transforms per act; a progress rail lights node by node.
   Fully re-choreographed for mobile via .ps-* classes in index.css.
   ══════════════════════════════════════════════════════════════════════════ */

const GREEN = '#00C47B'
const GOLD  = '#C9A84C'
const EASE   = [0.16, 1, 0.3, 1]

const ACTS = [
  { num: '01', kicker: 'Calling',   title: 'It dials every lead in 60 seconds.',            body: 'Upload your leads and VEORI calls each one — a real conversation, not a robocall. It handles objections and keeps the seller talking while every word is transcribed live.' },
  { num: '02', kicker: 'Following', title: 'No answer? It follows up by text.',              body: 'The moment a call goes unanswered, VEORI sends a natural SMS and keeps the thread warm until the seller replies. Nothing slips.' },
  { num: '03', kicker: 'Scoring',   title: 'It scores motivation in real time.',            body: 'Every response moves a motivation score. The instant a seller crosses the line, VEORI flags them hot and books the appointment on your calendar.' },
  { num: '04', kicker: 'Closing',   title: 'It sends the contract and coordinates title.',  body: 'VEORI drafts a compliant contract, sends it for e-signature, and hands off to title — so the deal closes while you sleep.' },
]

/* ── Act 1 · Sourcing ─────────────────────────────────────────────────── */
function FindsVisual() {
  const tags = ['Pre-foreclosure', 'Absentee owner', 'High equity']
  return (
    <div style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)', fontFamily: 'Inter,sans-serif' }}>
        Sourced from county records
      </div>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,196,123,0.22)', borderRadius: 16, padding: '20px 20px 18px', boxShadow: '0 0 40px rgba(0,196,123,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(135deg, rgba(0,196,123,0.25), rgba(0,196,123,0.08))', border: '1px solid rgba(0,196,123,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif', fontWeight: 800, color: GREEN, fontSize: 17 }}>MG</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'Inter,sans-serif', letterSpacing: '-0.01em' }}>Maria Gonzales</div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter,sans-serif' }}>Elmwood Drive · Dallas, TX</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.25)', borderRadius: 100, padding: '5px 12px', fontFamily: 'Inter,sans-serif' }}>New</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {tags.map((t, i) => (
            <motion.span key={t}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.35 + i * 0.12, ease: EASE }}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.72)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: '5px 11px', fontFamily: 'Inter,sans-serif' }}>{t}</motion.span>
          ))}
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.9 }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: GREEN, fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, boxShadow: `0 0 10px ${GREEN}` }} />
        Queued for outreach — calling now
      </motion.div>
    </div>
  )
}

/* ── Act 2 · Calling ──────────────────────────────────────────────────── */
function CallVisual() {
  const lines = [
    { role: 'ai',     text: "Hi, is this Maria? I'm calling about the property on Elmwood Drive." },
    { role: 'seller', text: "Yes… who is this?" },
    { role: 'ai',     text: "I work with local cash buyers. Would you consider an offer if the price was right?" },
    { role: 'seller', text: "Honestly, maybe. It needs more work than I can handle." },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, boxShadow: `0 0 10px ${GREEN}` }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: GREEN, fontFamily: 'Inter,sans-serif' }}>Live AI Call</span>
          <span className="lp-eq"><i style={{ height: 6 }} /><i style={{ height: 12 }} /><i style={{ height: 8 }} /><i style={{ height: 14 }} /><i style={{ height: 7 }} /></span>
        </div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>1:12</span>
      </div>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {lines.map((m, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.15 + i * 0.28, ease: EASE }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'ai' ? 'flex-start' : 'flex-end' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: m.role === 'ai' ? GREEN : 'rgba(255,255,255,0.35)', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>{m.role === 'ai' ? 'VEORI AI' : 'Seller'}</span>
            <div style={{ maxWidth: '86%', padding: '9px 13px', borderRadius: m.role === 'ai' ? '4px 13px 13px 13px' : '13px 4px 13px 13px', background: m.role === 'ai' ? 'rgba(0,196,123,0.10)' : 'rgba(255,255,255,0.05)', border: m.role === 'ai' ? '1px solid rgba(0,196,123,0.18)' : '1px solid rgba(255,255,255,0.07)', fontSize: 12.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.82)', fontFamily: 'Inter,sans-serif' }}>{m.text}</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ── Act 3 · Following (SMS) ──────────────────────────────────────────── */
function TextVisual() {
  const msgs = [
    { role: 'ai',     text: 'Hi Maria, this is VEORI following up on Elmwood Dr. Still open to a no-repair cash offer?' },
    { role: 'seller', text: 'Sorry I missed the call. Yes, what can you offer?' },
    { role: 'ai',     text: 'Great — I can have a number to you today. Does a 14-day close work?' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(0,196,123,0.12)', border: '1px solid rgba(0,196,123,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: GREEN, fontSize: 14 }}>✓</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'Inter,sans-serif' }}>Maria Gonzales</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter,sans-serif' }}>SMS · auto follow-up</div>
        </div>
      </div>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.map((m, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.4, ease: EASE }}
            style={{ alignSelf: m.role === 'ai' ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '10px 14px', borderRadius: m.role === 'ai' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'ai' ? GREEN : 'rgba(255,255,255,0.06)', color: m.role === 'ai' ? '#04140D' : 'rgba(255,255,255,0.85)', fontSize: 12.5, lineHeight: 1.5, fontWeight: m.role === 'ai' ? 600 : 400, fontFamily: 'Inter,sans-serif', border: m.role === 'ai' ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>
            {m.text}
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.4 }}
          style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '4px 2px' }}>
          <span className="lp-typing"><span /><span /><span /></span>
        </motion.div>
      </div>
    </div>
  )
}

/* ── Act 4 · Scoring ──────────────────────────────────────────────────── */
function ScoreVisual() {
  const score = 94
  const R = 52, C = 2 * Math.PI * R
  return (
    <div style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
          <motion.circle cx="70" cy="70" r={R} fill="none" stroke={GREEN} strokeWidth="9" strokeLinecap="round"
            transform="rotate(-90 70 70)" strokeDasharray={C}
            initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - score / 100) }}
            transition={{ duration: 1.2, ease: EASE, delay: 0.2 }}
            style={{ filter: `drop-shadow(0 0 8px ${GREEN})` }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            style={{ fontSize: 40, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em', fontFamily: 'Inter,sans-serif', lineHeight: 1 }}>{score}</motion.span>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginTop: 4, fontFamily: 'Inter,sans-serif' }}>Motivation</span>
        </div>
      </div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.5, ease: EASE }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(0,196,123,0.10)', border: '1px solid rgba(0,196,123,0.30)', borderRadius: 100, padding: '9px 18px' }}>
        <span style={{ color: GREEN, fontWeight: 800, fontSize: 13 }}>✓</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: GREEN, fontFamily: 'Inter,sans-serif' }}>Hot lead — appointment booked Thu 2:00 PM</span>
      </motion.div>
    </div>
  )
}

/* ── Act 5 · Closing ──────────────────────────────────────────────────── */
function CloseVisual() {
  const fields = [
    ['Property', 'Elmwood Dr, Dallas TX'],
    ['Seller', 'Maria Gonzales'],
    ['Offer price', '$142,000'],
    ['Close date', '14 days · as-is'],
  ]
  return (
    <div style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter,sans-serif' }}>Purchase agreement</span>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace' }}>generated in 4m</span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(([k, v], i) => (
          <motion.div key={k}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.15 + i * 0.22 }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: i < fields.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', paddingBottom: i < fields.length - 1 ? 12 : 0 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter,sans-serif' }}>{k}</span>
            <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.28 + i * 0.22, ease: EASE }}
              style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', fontFamily: 'Inter,sans-serif' }}>{v}</motion.span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.8, rotate: -6 }} animate={{ opacity: 1, scale: 1, rotate: -4 }}
        transition={{ duration: 0.5, delay: 1.1, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ alignSelf: 'center', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 8, border: `2px solid ${GREEN}`, color: GREEN, borderRadius: 10, padding: '8px 18px', fontWeight: 800, fontSize: 15, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'Inter,sans-serif', boxShadow: '0 0 30px rgba(0,196,123,0.2)' }}>
        ✓ Signed
      </motion.div>
    </div>
  )
}

const VISUALS = [CallVisual, TextVisual, ScoreVisual, CloseVisual]

export default function PipelineStory() {
  const outerRef = useRef(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: outerRef, offset: ['start start', 'end end'] })

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const idx = Math.max(0, Math.min(ACTS.length - 1, Math.floor(v * ACTS.length)))
    setActive(idx)
  })

  const Visual = VISUALS[active]
  const act = ACTS[active]

  return (
    <section id="how" ref={outerRef} className="ps-outer" style={{ position: 'relative', background: 'linear-gradient(180deg, #060E1A 0%, #05101E 100%)' }}>
      <div className="ps-sticky" style={{ position: 'sticky', top: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        {/* ambient */}
        <div style={{ position: 'absolute', top: '10%', right: '-5%', width: '55%', height: '70%', background: 'radial-gradient(ellipse at center, rgba(0,196,123,0.08) 0%, transparent 65%)', filter: 'blur(50px)', pointerEvents: 'none' }} />

        <div className="ps-inner" style={{ position: 'relative', zIndex: 2, maxWidth: 1180, margin: '0 auto', width: '100%', padding: '80px 32px', display: 'grid', gap: 56, alignItems: 'center' }}>

          {/* Left — progress rail + narration */}
          <div className="ps-narr">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: GREEN, marginBottom: 30, fontFamily: 'Inter,sans-serif' }}>
              Watch VEORI work a deal — start to close
            </div>

            {/* progress rail */}
            <div className="ps-rail" style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 34 }}>
              {ACTS.map((a, i) => {
                const state = i === active ? 'active' : i < active ? 'done' : 'todo'
                return (
                  <div key={a.num} className="ps-rail-item" style={{ display: 'flex', alignItems: 'center', gap: 14, height: 34 }}>
                    <div style={{ position: 'relative', width: 12, display: 'flex', justifyContent: 'center' }}>
                      {i < ACTS.length - 1 && <span style={{ position: 'absolute', top: 16, width: 1.5, height: 34, background: state === 'done' ? GREEN : 'rgba(255,255,255,0.10)', transition: 'background 0.4s' }} />}
                      <span style={{ width: state === 'active' ? 12 : 8, height: state === 'active' ? 12 : 8, borderRadius: '50%', background: state === 'todo' ? 'rgba(255,255,255,0.14)' : GREEN, boxShadow: state === 'active' ? `0 0 12px ${GREEN}` : 'none', transition: 'all 0.4s', zIndex: 1 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: state === 'active' ? 700 : 500, color: state === 'active' ? '#fff' : state === 'done' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.30)', fontFamily: 'Inter,sans-serif', transition: 'all 0.4s', letterSpacing: '-0.01em' }}>{a.kicker}</span>
                  </div>
                )
              })}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={act.num}
                initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.45, ease: EASE }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: GREEN, marginBottom: 14, letterSpacing: '0.05em' }}>{act.num}</div>
                <h2 className="ps-title" style={{ fontSize: 'clamp(26px,3.2vw,40px)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.08, color: '#fff', marginBottom: 18, fontFamily: "'Space Grotesk',Inter,sans-serif" }}>{act.title}</h2>
                <p style={{ fontSize: 'clamp(15px,1.5vw,17px)', color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, maxWidth: 440, fontFamily: 'Inter,sans-serif' }}>{act.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right — persistent device */}
          <div className="ps-device-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="ps-device" style={{ position: 'relative', width: '100%', maxWidth: 400, minHeight: 380, background: 'rgba(9,19,36,0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 22, boxShadow: '0 0 0 1px rgba(0,196,123,0.06), 0 0 90px rgba(0,196,123,0.10), 0 40px 90px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
              <div className="lp-scanline" />
              <AnimatePresence mode="wait">
                <motion.div key={act.num}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  style={{ minHeight: 380, display: 'flex', flexDirection: 'column' }}>
                  <Visual />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
