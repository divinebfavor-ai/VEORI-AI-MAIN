import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/* ══════════════════════════════════════════════════════════════════════════
   Hero — light editorial.
   The split-face figure (human ⇄ android) sits as a full-bleed background on
   ALL screen sizes, with VEORI copy overlaid on top. Typewriter headline.
   Subtle mouse-parallax on desktop. VEORI voice — no lead-sourcing claims.
   ══════════════════════════════════════════════════════════════════════════ */

const HERO_IMG = '/hero-split.webp'

function useTypewriter(text, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    setDisplayed(''); setDone(false)
    let i = 0
    let interval
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setDisplayed(text.slice(0, i))
        if (i >= text.length) { clearInterval(interval); setDone(true) }
      }, speed)
    }, startDelay)
    return () => { clearTimeout(start); clearInterval(interval) }
  }, [text, speed, startDelay])
  return { displayed, done }
}

export default function VideoHero() {
  const parallaxRef = useRef(null)
  const { displayed, done } = useTypewriter('Your leads, worked\nstart to close.')

  // Subtle desktop mouse-parallax on the figure
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.innerWidth < 1024) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const onMove = (e) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = parallaxRef.current
        if (!el) return
        const cx = e.clientX / window.innerWidth - 0.5
        const cy = e.clientY / window.innerHeight - 0.5
        el.style.transform = `scale(1.08) translate(${cx * -18}px, ${cy * -12}px)`
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf) }
  }, [])

  return (
    <section id="top" className="relative min-h-[100svh] bg-[#ECEDF1] text-neutral-900 overflow-hidden">

      {/* Full-bleed figure (behind the copy on every screen size) */}
      <div ref={parallaxRef} className="absolute inset-0" style={{ transform: 'scale(1.08)', transition: 'transform 0.35s cubic-bezier(0.16,1,0.3,1)' }}>
        <img src={HERO_IMG} alt="A real-estate investor fused with a humanoid AI android"
             className="hero-img w-full h-full object-cover select-none" draggable="false" />
      </div>
      <div className="hero-veil absolute inset-0 pointer-events-none" />

      {/* Copy overlay */}
      <div className="relative z-10 min-h-[100svh] max-w-7xl mx-auto px-6 sm:px-8 flex flex-col justify-start lg:justify-center pt-28 lg:pt-0 pb-14">
        <div className="max-w-xl">

          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="mb-6">
            <span className="inline-flex items-center gap-2.5 rounded-full border border-[#1C2E1E]/12 bg-white/70 px-4 py-1.5 text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1C2E1E]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#00A768] opacity-70 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00A768]" />
              </span>
              AI Acquisitions Platform
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-[42px] leading-[1.05] sm:text-6xl lg:text-[76px] font-normal tracking-tight text-black lg:leading-[1.06] mb-6 select-none w-full whitespace-pre-wrap"
                style={{ fontFamily: "'Space Grotesk','Inter',sans-serif", letterSpacing: '-0.03em' }}>
              {displayed}
              {!done && <span className="inline-block w-[3px] h-[0.92em] bg-black align-middle ml-[3px] animate-blink" />}
            </h1>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
            <p className="text-base sm:text-lg md:text-xl text-[#41493F] leading-relaxed font-normal mb-8 max-w-lg">
              VEORI calls every lead in 60 seconds, qualifies them in real conversations,
              scores motivation, sends contracts for e-signature, and coordinates title —
              around the clock, without you on the phone.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-3.5 mb-5">
              <a href="#pricing"
                className="inline-flex items-center justify-center rounded-full bg-[#00C47B] px-8 py-4 text-[15px] font-bold text-[#04140D] transition-all hover:bg-[#00d986] hover:-translate-y-0.5"
                style={{ boxShadow: '0 10px 30px rgba(0,196,123,0.28)' }}>
                Start calling sellers
              </a>
              <a href="#how"
                className="inline-flex items-center justify-center rounded-full border border-[#1C2E1E]/20 bg-white/70 px-8 py-4 text-[15px] font-semibold text-[#1C2E1E] transition-all hover:bg-white">
                See how it works →
              </a>
            </div>
            <div className="text-[13px] text-[#41493F]">
              From <strong className="font-semibold text-[#1C2E1E]">$1,499/mo</strong> · No setup fees · Cancel anytime
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
