import { useEffect, useRef } from 'react'

/**
 * Poll a function on an interval, but only while the tab is visible.
 *
 * A background tab used to keep polling forever: with thousands of operators
 * signed in, idle tabs alone were most of the API traffic. This runs the work
 * when the tab is visible, pauses on hide, and refreshes once on return so the
 * screen is never stale when someone comes back.
 *
 * @param {Function} fn            work to run (may be async)
 * @param {number}   intervalMs    delay between runs while visible
 * @param {object}  [opts]
 * @param {boolean} [opts.enabled]        false pauses entirely (default true)
 * @param {boolean} [opts.runOnFocus]     run once when the tab becomes visible (default true)
 * @param {boolean} [opts.skipWhileBusy]  don't start a run while the previous one is in flight (default true)
 */
export default function usePolling(fn, intervalMs, { enabled = true, runOnFocus = true, skipWhileBusy = true } = {}) {
  const saved = useRef(fn)
  const busy = useRef(false)
  saved.current = fn

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined
    let timer = null

    const run = async () => {
      if (skipWhileBusy && busy.current) return
      busy.current = true
      try { await saved.current() } catch { /* callers surface their own errors */ }
      finally { busy.current = false }
    }
    const start = () => { if (!timer) timer = setInterval(run, intervalMs) }
    const stop = () => { clearInterval(timer); timer = null }

    const onVisibility = () => {
      if (document.hidden) { stop(); return }
      if (runOnFocus) run()
      start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [intervalMs, enabled, runOnFocus, skipWhileBusy])
}
