import { useEffect, useRef } from 'react'

/**
 * useRingback(active) — plays a synthesized US ringback tone while `active` is true.
 *
 * The Dialer showed a "Ringing…" state visually but played no sound. Rather than
 * ship an audio asset, we synthesize the standard North-American ringback with the
 * Web Audio API: a 440 Hz + 480 Hz dual tone, 2 seconds on / 4 seconds off. Pure
 * math, no file, no network.
 *
 * Autoplay policy: the AudioContext is created and resumed inside the effect that
 * runs on the state change caused by the user's "Dial" click, so it's within the
 * user-gesture window and browsers allow it. If resume() is still blocked we fail
 * silent (no throw) — the visual ringing state is unaffected.
 */
export default function useRingback(active) {
  const ctxRef = useRef(null)
  const nodesRef = useRef(null)
  const cycleRef = useRef(null)

  useEffect(() => {
    if (!active) return

    let stopped = false
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return

    let ctx
    try {
      ctx = new AudioCtx()
    } catch {
      return
    }
    ctxRef.current = ctx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    // Master gain we ramp on/off so tones don't click.
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    const makeOsc = (freq) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq
      o.connect(master)
      o.start()
      return o
    }
    const o1 = makeOsc(440)
    const o2 = makeOsc(480)
    nodesRef.current = { o1, o2, master }

    const RING_ON_MS = 2000
    const RING_OFF_MS = 4000
    const PEAK = 0.12 // gentle — this plays near the user's ear expectation

    const ringOnce = () => {
      if (stopped) return
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(0.0001, now)
      master.gain.exponentialRampToValueAtTime(PEAK, now + 0.05)
      master.gain.setValueAtTime(PEAK, now + RING_ON_MS / 1000 - 0.05)
      master.gain.exponentialRampToValueAtTime(0.0001, now + RING_ON_MS / 1000)
    }

    ringOnce()
    cycleRef.current = setInterval(ringOnce, RING_ON_MS + RING_OFF_MS)

    return () => {
      stopped = true
      if (cycleRef.current) clearInterval(cycleRef.current)
      try { o1.stop(); o2.stop() } catch { /* already stopped */ }
      try { ctx.close() } catch { /* noop */ }
      ctxRef.current = null
      nodesRef.current = null
    }
  }, [active])
}
