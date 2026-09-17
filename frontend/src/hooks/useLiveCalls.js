import { useState, useEffect } from 'react'
import { calls } from '../services/api'

// One shared poller for every component that shows live calls (rail, status bar,
// intel panel, dashboard, monitor). Each used to poll on its own every 1.5s, so a
// single open tab sent several requests a second. Polling stops when nothing is
// subscribed and pauses while the tab is hidden.
const POLL_ACTIVE_MS = 1500   // a call is in progress: keep the monitor live
const POLL_IDLE_MS = 10000    // nothing is running: check far less often
const subscribers = new Set()
let state = { calls: [], isLoading: true }
let timer = null
let timerMs = 0
let inFlight = false

function publish(next) {
  state = next
  subscribers.forEach(fn => fn(state))
}

async function fetchLive() {
  if (inFlight) return
  inFlight = true
  try {
    const res = await calls.getLiveCalls()
    const raw = res.data?.calls ?? res.data?.data ?? res.data
    const list = Array.isArray(raw) ? raw : []
    publish({ calls: list, isLoading: false })
    retime(list.length ? POLL_ACTIVE_MS : POLL_IDLE_MS)
  } catch {
    if (state.isLoading) publish({ ...state, isLoading: false })
  } finally {
    inFlight = false
  }
}

// Switch cadence without dropping a beat: only restart when it actually changes.
function retime(ms) {
  if (!timer || timerMs === ms) return
  clearInterval(timer);
  timerMs = ms;
  timer = setInterval(fetchLive, ms)
}

function start() {
  if (timer || typeof document === 'undefined' || document.hidden) return
  fetchLive()
  timerMs = state.calls.length ? POLL_ACTIVE_MS : POLL_IDLE_MS
  timer = setInterval(fetchLive, timerMs)
}
function stop() {
  clearInterval(timer)
  timer = null
  timerMs = 0
}
function onVisibility() {
  if (document.hidden) stop()
  else if (subscribers.size) start()
}

export function useLiveCalls() {
  const [snapshot, setSnapshot] = useState(state)

  useEffect(() => {
    subscribers.add(setSnapshot)
    setSnapshot(state)
    if (subscribers.size === 1) {
      document.addEventListener('visibilitychange', onVisibility)
      start()
    }
    return () => {
      subscribers.delete(setSnapshot)
      if (!subscribers.size) {
        stop()
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [])

  return snapshot
}
