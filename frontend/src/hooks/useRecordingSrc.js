import { useEffect, useState } from 'react'
import api from '../services/api'

// Call audio sits in a private bucket. calls.recording_url holds a storage reference
// ("storage:call-recordings/...") that can't be played directly, so we ask the API
// for a short-lived signed link for this call. Other links (old hosts) pass through.
export function isStoredRecording(value) {
  return typeof value === 'string' && value.startsWith('storage:')
}

export default function useRecordingSrc(callId, value) {
  const stored = isStoredRecording(value)
  const [state, setState] = useState({ src: stored ? null : (value || null), loading: stored, failed: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!stored) { setState({ src: value || null, loading: false, failed: false }); return }
    if (!callId) { setState({ src: null, loading: false, failed: true }); return }
    let cancelled = false
    setState(s => ({ ...s, loading: true, failed: false }))
    api.get(`/api/calls/${callId}/recording`)
      .then(r => { if (!cancelled) setState({ src: r.data?.url || null, loading: false, failed: !r.data?.url }) })
      .catch(() => { if (!cancelled) setState({ src: null, loading: false, failed: true }) })
    return () => { cancelled = true }
  }, [callId, value, stored, attempt])

  // A signed link expires after an hour; a player left open that long can ask again.
  const refresh = () => { if (stored) setAttempt(a => a + 1) }
  return { ...state, refresh, stored }
}
