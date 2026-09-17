import { useState, useEffect } from 'react'
import { calls } from '../services/api'

// One shared poller for every component that shows live calls (rail, status bar,
// intel panel, dashboard, monitor). Each used to poll on its own every 1.5s, so a
// single open tab sent several requests a second. Polling stops when nothing is
// subscribed and pauses while the tab is hidden.
const POLL_MS = 1500
const subscribers = new Set()
let state = { calls: [], isLoading: true }
let timer = null
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
    publish({ calls: Array.isArray(raw) ? raw : [], isLoading: false })
  } catch {
    if (state.isLoading) publish({ ...state, isLoading: false })
  } finally {
    inFlight = false
  }
}

function start() {
  if (timer || typeof document === 'undefined' || document.hidden) return
  fetchLive()
  timer = setInterval(fetchLive, POLL_MS)
}
function stop() {
  clearInterval(timer)
  timer = null
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
