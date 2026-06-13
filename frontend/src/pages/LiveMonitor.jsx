import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Headphones, Mic, X, Volume2, VolumeX, PhoneCall, PhoneOff, PhoneIncoming, Clock, CheckCircle, AlertCircle, ChevronRight, Search, Plus, UserCircle, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { calls as callsApi, leads as leadsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'

const GREEN = '#00C37A'
const BLUE  = '#4D9EFF'
const RED   = '#FF4444'
const AMBER = '#FF9500'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs && secs !== 0) return '-'
  const m = Math.floor(secs / 60), s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function statusMeta(status, outcome) {
  if (['initiated','ringing','in-progress'].includes(status)) return { label: 'LIVE', color: GREEN, icon: PhoneCall }
  if (status === 'completed' || status === 'ended') {
    if (['appointment','offer_made','verbal_yes'].includes(outcome)) return { label: 'HOT', color: GREEN, icon: CheckCircle }
    if (outcome === 'not_interested') return { label: 'NO', color: RED, icon: PhoneOff }
    if (outcome === 'callback_requested') return { label: 'CB', color: BLUE, icon: PhoneIncoming }
    return { label: 'DONE', color: 'var(--t4)', icon: CheckCircle }
  }
  if (status === 'failed') return { label: 'FAIL', color: RED, icon: AlertCircle }
  return { label: status?.toUpperCase() || '-', color: 'var(--t4)', icon: Clock }
}

// ─── IN / OUT direction badge ──────────────────────────────────────────────────
// Small pill prefixed to a call's name so operators instantly see whether a
// seller called in (IN, accent blue) or Veori dialed out (OUT, subdued).
function DirectionBadge({ direction }) {
  const inbound = direction === 'inbound'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      flexShrink: 0,
      fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
      padding: '1px 5px', borderRadius: 4, lineHeight: 1.4,
      color: inbound ? BLUE : 'var(--t4)',
      background: inbound ? 'rgba(77,158,255,0.14)' : 'var(--bg3)',
      border: `1px solid ${inbound ? 'rgba(77,158,255,0.35)' : 'var(--border)'}`,
    }}>
      {inbound ? <PhoneIncoming size={9} /> : <PhoneCall size={9} />}
      {inbound ? 'IN' : 'OUT'}
    </span>
  )
}

// ─── Live duration counter ─────────────────────────────────────────────────────
function Duration({ startedAt }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => setSecs(Math.floor((Date.now() - start) / 1000))
    tick(); const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const m = Math.floor(secs / 60), s = secs % 60
  return <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 20, fontWeight: 700, color: GREEN }}>{m}:{String(s).padStart(2, '0')}</span>
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function Waveform({ active = true, color = GREEN, bars = 16 }) {
  const heights = useRef(Array.from({ length: bars }, () => 20 + Math.random() * 80))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28 }}>
      {heights.current.map((h, i) => (
        <div key={i} className={active ? 'wave-bar' : ''} style={{
          width: 3, borderRadius: 2,
          background: active ? color : 'var(--border)',
          height: active ? `${h}%` : '20%',
          animationDelay: `${(i * 40) % 800}ms`,
          animationDuration: `${600 + (i * 37) % 600}ms`,
          transformOrigin: 'bottom',
          transition: active ? undefined : 'height 0.4s ease',
        }} />
      ))}
    </div>
  )
}

// ─── WebRTC Listen Mode ────────────────────────────────────────────────────────
function useListenMode() {
  const audioRefs  = useRef({})   // { ws, audioCtx, gainNode } per callId
  const cancelRefs = useRef({})   // set true to cancel an in-flight connect (per callId)
  const [listening, setListening] = useState({})
  const [pending,   setPending]   = useState({})   // tapped Listen, waiting for pickup
  const [volumes,   setVolumes]   = useState({})
  const ringRefs   = useRef({})   // ringback tone (AudioContext) per callId

  // Stop the ringback tone for a call (safe to call even if none is playing).
  const stopRingback = (callId) => {
    const r = ringRefs.current[callId]
    if (r) {
      clearInterval(r.timer)
      r.ctx.close().catch(() => {})
      delete ringRefs.current[callId]
    }
  }

  // Play a phone-style ringback tone (deep brrr...brrr...) until the seller picks up.
  const startRingback = (callId) => {
    try {
      stopRingback(callId)
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(ctx.destination)
      // US ringback = two tones (440Hz + 480Hz), 2s on / 4s off
      const o1 = ctx.createOscillator(); o1.frequency.value = 440; o1.connect(gain)
      const o2 = ctx.createOscillator(); o2.frequency.value = 480; o2.connect(gain)
      o1.start(); o2.start()
      const cadence = () => {
        const t = ctx.currentTime
        gain.gain.setValueAtTime(0.18, t)
        gain.gain.setValueAtTime(0,    t + 2)
      }
      cadence()
      const timer = setInterval(cadence, 6000)
      ringRefs.current[callId] = { ctx, timer }
    } catch { /* AudioContext unavailable — silent fallback */ }
  }

  const connectListen = useCallback(async (callId, dbCallId) => {
    if (!dbCallId) { toast.error('Call not ready yet - try again in a moment'); return }

    // Allow this attempt; tapping Listen again sets this true to cancel the retry loop.
    cancelRefs.current[callId] = false
    setPending(p => ({ ...p, [callId]: true }))

    try {
      const token = localStorage.getItem('veori_token')
      const BASE  = import.meta.env.VITE_API_URL || 'http://localhost:3001'

      // Vapi's monitor.listenUrl is a WebSocket (wss://) that streams raw 16-bit
      // little-endian PCM (mono). It is NOT a WebRTC/SDP endpoint — the old code
      // POSTed an SDP offer to it, which always failed ("something went wrong").
      // Correct path: fetch the wss URL, open a browser WebSocket, decode the PCM
      // frames, and play them through the Web Audio API.

      // The listen URL only exists AFTER the seller picks up — while the call is
      // still ringing the backend returns 404. Retry every 1.5s (up to ~90s).
      startRingback(callId)   // dial tone while the seller's phone is ringing
      const DEADLINE = Date.now() + 90_000
      let wsUrl = null

      while (Date.now() < DEADLINE) {
        if (cancelRefs.current[callId]) { stopRingback(callId); return }   // user tapped Listen again

        const res = await fetch(`${BASE}/api/calls/${dbCallId}/listen`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (res.ok) {
          const d = await res.json().catch(() => ({}))
          if (d.listen_url) { wsUrl = d.listen_url; break }
        } else if (res.status !== 404) {
          const e = await res.json().catch(() => ({}))
          stopRingback(callId)
          throw new Error(e.error || 'Could not connect to call audio')
        }
        await new Promise(r => setTimeout(r, 1500))
      }

      if (cancelRefs.current[callId]) { stopRingback(callId); return }
      if (!wsUrl) {
        stopRingback(callId)
        setPending(p => { const n = { ...p }; delete n[callId]; return n })
        toast.error('Call never connected — no audio to listen to')
        return
      }

      // ── Web Audio playback chain: ws → PCM16 → scheduled AudioBuffers → gain ──
      const Ctx = window.AudioContext || window.webkitAudioContext
      const audioCtx = new Ctx()
      const gainNode = audioCtx.createGain()
      gainNode.gain.value = (volumes[callId] ?? 100) / 100
      gainNode.connect(audioCtx.destination)

      // Vapi defaults to 16kHz mono PCM; if a JSON config frame arrives first it
      // may override the sample rate. We schedule chunks back-to-back to avoid gaps.
      let sampleRate = 16000
      let nextTime = 0
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      const playPcm = (arrayBuf) => {
        const pcm = new Int16Array(arrayBuf)
        if (!pcm.length) return
        const f32 = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768  // i16 → [-1,1]
        const buf = audioCtx.createBuffer(1, f32.length, sampleRate)
        buf.copyToChannel(f32, 0)
        const src = audioCtx.createBufferSource()
        src.buffer = buf
        src.connect(gainNode)
        const now = audioCtx.currentTime
        if (nextTime < now) nextTime = now + 0.05   // small lead-in / resync on underrun
        src.start(nextTime)
        nextTime += buf.duration
      }

      ws.onopen = () => {
        if (cancelRefs.current[callId]) { ws.close(); return }
        stopRingback(callId)   // connected — silence the dial tone
        audioRefs.current[callId] = { ws, audioCtx, gainNode }
        setPending(p => { const n = { ...p }; delete n[callId]; return n })
        setListening(l => ({ ...l, [callId]: true }))
        toast.success('Listening live - seller cannot hear you')
      }

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          // Optional JSON config frame (e.g. { sampleRate, channels }).
          try {
            const cfg = JSON.parse(ev.data)
            if (cfg.sampleRate) sampleRate = cfg.sampleRate
          } catch { /* ignore non-JSON text frames */ }
          return
        }
        playPcm(ev.data)
      }

      ws.onerror = () => {
        stopRingback(callId)
        setPending(p => { const n = { ...p }; delete n[callId]; return n })
        setListening(l => { const n = { ...l }; delete n[callId]; return n })
        toast.error('Live audio connection failed')
      }

      ws.onclose = () => {
        setListening(l => { const n = { ...l }; delete n[callId]; return n })
        setPending(p => { const n = { ...p }; delete n[callId]; return n })
        audioCtx.close().catch(() => {})
        delete audioRefs.current[callId]
      }
    } catch (err) {
      stopRingback(callId)
      setPending(p => { const n = { ...p }; delete n[callId]; return n })
      toast.error(err.message || 'Could not connect to call audio')
    }
  }, [volumes])

  const disconnectListen = useCallback((callId) => {
    cancelRefs.current[callId] = true   // cancel any in-flight retry loop (call still ringing)
    stopRingback(callId)                // silence the dial tone if it's still playing
    const a = audioRefs.current[callId]
    if (a) {
      try { a.ws?.close() } catch { /* already closed */ }
      a.audioCtx?.close().catch(() => {})
    }
    delete audioRefs.current[callId]
    setListening(l => { const n = { ...l }; delete n[callId]; return n })
    setPending(p => { const n = { ...p }; delete n[callId]; return n })
  }, [])

  const setVolume = useCallback((callId, vol) => {
    const a = audioRefs.current[callId]
    if (a?.gainNode) a.gainNode.gain.value = vol / 100
    setVolumes(v => ({ ...v, [callId]: vol }))
  }, [])

  useEffect(() => () => Object.keys(audioRefs.current).forEach(disconnectListen), [disconnectListen])
  return { listening, pending, volumes, connectListen, disconnectListen, setVolume }
}

// ─── Inbound call alert ────────────────────────────────────────────────────────
// Diffs successive live-call snapshots (from the existing 1.5s poll). When a NEW
// call with direction==='inbound' first appears, fire a toast + short tone so the
// operator knows a seller dialed in — without opening the Vapi dashboard. Tracks
// seen ids in a ref so each inbound call alerts exactly once.
function useInboundAlert(liveCalls) {
  const seen = useRef(new Set())
  const primed = useRef(false)

  useEffect(() => {
    if (!Array.isArray(liveCalls)) return

    // First snapshot only records what's already on screen — no alert on mount.
    if (!primed.current) {
      liveCalls.forEach(c => c?.id && seen.current.add(c.id))
      primed.current = true
      return
    }

    for (const c of liveCalls) {
      if (!c?.id || seen.current.has(c.id)) continue
      seen.current.add(c.id)
      if (c.direction === 'inbound') {
        const who = c.lead_name || c.from_number || c.customer_number || 'a seller'
        toast(`Incoming call from ${who}`, {
          icon: '📞',
          duration: 6000,
          style: { background: '#0b1220', color: '#fff', border: `1px solid ${BLUE}55` },
        })
        playInboundTone()
      }
    }

    // Forget ids that have dropped off the live list so a later call with a
    // recycled id (unlikely, but safe) can re-alert.
    const liveIds = new Set(liveCalls.map(c => c?.id).filter(Boolean))
    for (const id of seen.current) if (!liveIds.has(id)) seen.current.delete(id)
  }, [liveCalls])
}

// Short two-note ring using the Web Audio API — no asset file needed. Best-effort:
// browsers may block audio until the user has interacted with the page.
function playInboundTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const notes = [880, 1320]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = ctx.currentTime + i * 0.22
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.22)
    })
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch { /* audio blocked — toast still shows */ }
}

// ─── Live Call Card ───────────────────────────────────────────────────────────
// ─── Call sub-status label ─────────────────────────────────────────────────────
function callSubStatus(status) {
  if (status === 'initiated') return { label: 'Connecting...', color: AMBER, pulse: true }
  if (status === 'ringing')   return { label: 'Ringing...', color: BLUE, pulse: true }
  if (status === 'in-progress') return { label: 'Connected', color: GREEN, pulse: false }
  return { label: 'Live', color: GREEN, pulse: true }
}

function LiveCallCard({ call, isListening, isPending, volume, takeover, onListen, onStopListen, onSetVolume, onTakeover, onReturn, onEnd, isSelected, onClick }) {
  const initials  = (call.lead_name || 'UN').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const subStatus = callSubStatus(call.status)
  const isConnected = call.status === 'in-progress'

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 14,
        border: `1px solid ${isSelected ? `${subStatus.color}55` : `${subStatus.color}22`}`,
        background: isSelected ? `${subStatus.color}08` : `${subStatus.color}03`,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: `${subStatus.color}18`, border: `1.5px solid ${subStatus.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: subStatus.color,
          }}>{initials}</div>
          <span style={{
            position: 'absolute', bottom: 0, right: -2,
            width: 10, height: 10, borderRadius: '50%',
            background: subStatus.color, border: '2px solid var(--card-bg)',
            animation: subStatus.pulse ? 'pulse-live 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
            <DirectionBadge direction={call.direction} />
            {call.lead_name || (call.direction === 'inbound' ? 'Incoming Caller' : 'Unknown Seller')}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.property_address || 'Address unknown'}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <Duration startedAt={call.started_at} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: subStatus.color }}>
            {subStatus.label.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Waveform - only show when actually connected */}
      <div style={{ marginBottom: 14 }}>
        <Waveform active={isConnected} bars={18} color={isListening ? BLUE : subStatus.color} />
      </div>

      {/* Action buttons - always visible */}
      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
        {/* LISTEN - primary prominent button */}
        <button
          onClick={isListening ? onStopListen : onListen}
          style={{
            flex: 1, height: 36, borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: isListening ? BLUE : isPending ? AMBER : GREEN,
            border: 'none', color: '#000',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontFamily: 'inherit', letterSpacing: '-0.01em',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          {isListening ? <VolumeX size={13} /> : <Headphones size={13} />}
          {isListening ? 'Stop' : isPending ? 'Connecting…' : 'Listen Live'}
        </button>

        {/* Volume slider when listening */}
        {isListening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, background: 'var(--surface-bg)', borderRadius: 8, padding: '0 10px' }}>
            <Volume2 size={11} style={{ color: 'var(--t4)', flexShrink: 0 }} />
            <input type="range" min={0} max={100} value={volume ?? 100}
              onChange={e => onSetVolume(Number(e.target.value))}
              style={{ flex: 1, accentColor: BLUE }} />
          </div>
        )}

        {/* Takeover */}
        {!isListening && (
          <button
            onClick={takeover ? onReturn : onTakeover}
            style={{
              height: 36, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              background: takeover ? 'rgba(255,149,0,0.12)' : 'var(--surface-bg)',
              border: `1px solid ${takeover ? 'rgba(255,149,0,0.35)' : 'var(--border)'}`,
              color: takeover ? AMBER : 'var(--t3)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
            }}
          >
            <Mic size={12} /> {takeover ? 'Return' : 'Join'}
          </button>
        )}

        {/* End */}
        <button
          onClick={onEnd}
          style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: 'rgba(255,68,68,0.10)', border: '1px solid rgba(255,68,68,0.22)',
            color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><X size={13} /></button>
      </div>
    </div>
  )
}

// ─── Call History Row ─────────────────────────────────────────────────────────
function CallRow({ call, isSelected, onClick, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const isLive   = ['initiated','ringing','in-progress'].includes(call.status)
  const isFailed = call.status === 'failed'
  const { label, color, icon: Icon } = statusMeta(call.status, call.outcome)
  const name = call.leads
    ? `${call.leads.first_name || ''} ${call.leads.last_name || ''}`.trim() || 'Unknown'
    : call.lead_name || 'Unknown Seller'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
        borderBottom: '1px solid var(--border)',
        background: isSelected ? 'var(--surface-bg-2)' : hovered ? 'var(--surface-bg)' : 'transparent',
        cursor: 'pointer', transition: 'background 0.12s ease',
      }}
    >
      {/* Status dot */}
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
        boxShadow: isLive ? `0 0 6px ${color}` : 'none',
        animation: isLive ? 'pulse-live 2s ease-in-out infinite' : 'none',
      }} />

      {/* Name + address */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
          <DirectionBadge direction={call.direction} />
          {name}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {call.leads?.phone || call.phone_numbers?.number || '-'}
        </p>
      </div>

      {/* Duration */}
      <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'Geist Mono, monospace', flexShrink: 0 }}>
        {call.duration_seconds ? fmt(call.duration_seconds) : isLive ? 'live' : '-'}
      </span>

      {/* Status badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color, background: `${color}15`, border: `1px solid ${color}28`,
        borderRadius: 5, padding: '2px 6px', flexShrink: 0,
      }}>{label}</span>

      {/* Delete icon for failed calls - shown on hover */}
      {isFailed && hovered ? (
        <button
          onClick={e => { e.stopPropagation(); onDelete && onDelete(call) }}
          title="Delete failed call"
          style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: 'rgba(255,68,68,0.10)', border: '1px solid rgba(255,68,68,0.22)',
            color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={11} />
        </button>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--t4)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
          {timeAgo(call.started_at || call.created_at)}
        </span>
      )}
    </div>
  )
}

// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ src }) {
  const ref = useRef(null)
  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  const togglePlay = () => {
    const el = ref.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play().catch(() => {}); setPlaying(true) }
  }

  const seek = (e) => {
    const val = Number(e.target.value)
    if (ref.current) { ref.current.currentTime = val; setProgress(val) }
  }

  return (
    <div style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
      <p style={{ margin: '0 0 10px', fontSize: 10, color: BLUE, fontWeight: 600, letterSpacing: '0.06em' }}>RECORDING</p>
      <audio
        ref={ref}
        src={src}
        onTimeUpdate={() => setProgress(ref.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: BLUE, border: 'none', color: '#fff',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min={0} max={duration || 1} step={0.1} value={progress}
          onChange={seek}
          style={{ flex: 1, accentColor: BLUE, height: 3, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'Geist Mono, monospace', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
          {fmt(progress)} / {fmt(duration)}
        </span>
        <a
          href={src}
          download
          target="_blank"
          rel="noreferrer"
          title="Download recording"
          style={{ color: 'var(--t4)', display: 'flex', alignItems: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          <Mic size={13} />
        </a>
      </div>
    </div>
  )
}

// ─── Live transcript poller ────────────────────────────────────────────────────
function useLiveTranscript(call) {
  const [liveTranscript, setLiveTranscript] = useState(call?.transcript || '')
  const isLive = call && ['initiated','ringing','in-progress'].includes(call.status)

  useEffect(() => {
    setLiveTranscript(call?.transcript || '')
    if (!isLive || !call?.id) return
    const poll = async () => {
      try {
        const token = localStorage.getItem('veori_token')
        const BASE  = import.meta.env.VITE_API_URL || 'http://localhost:3001'
        const r = await fetch(`${BASE}/api/calls/${call.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (r.ok) {
          const d = await r.json()
          setLiveTranscript(d.data?.transcript || '')
        }
      } catch { }
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [call?.id, isLive])

  return liveTranscript
}

// ─── Call Detail Panel ────────────────────────────────────────────────────────
function CallDetailPanel({ call }) {
  const navigate = useNavigate()
  const liveTranscript = useLiveTranscript(call)

  // Transcript auto-scroll — but only when the operator is already at the bottom.
  // The old inline `ref={el => el.scrollTop = el.scrollHeight}` ran on EVERY render
  // (every 2s poll), yanking the view back down so you could never scroll up to
  // read from the start. Now: stick to the latest line only if you haven't
  // scrolled away; the moment you scroll up to read history, it leaves you there.
  const transcriptRef = useRef(null)
  const stickRef = useRef(true)
  const onTranscriptScroll = () => {
    const el = transcriptRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }
  useEffect(() => {
    const el = transcriptRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [liveTranscript])

  if (!call) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        <PhoneCall size={36} style={{ color: 'var(--t4)' }} strokeWidth={1.3} />
        <p style={{ fontSize: 14, color: 'var(--t3)', textAlign: 'center' }}>Select a call to see details</p>
      </div>
    )
  }

  const { label, color } = statusMeta(call.status, call.outcome)
  const name   = call.leads
    ? `${call.leads.first_name || ''} ${call.leads.last_name || ''}`.trim() || 'Unknown'
    : call.lead_name || 'Unknown Seller'
  const isLive = ['initiated','ringing','in-progress'].includes(call.status)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 20px 32px' }}>
      {/* Lead header */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
          background: `${color}12`, border: `1.5px solid ${color}28`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color,
        }}>
          {name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--t1)' }}>{name}</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{call.leads?.phone || '-'}</p>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color, background: `${color}15`, border: `1px solid ${color}28`, borderRadius: 5, padding: '2px 7px', display: 'inline-block', marginTop: 6 }}>{label}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        {[
          { label: 'Duration', value: call.duration_seconds ? fmt(call.duration_seconds) : isLive ? 'Live now' : '-' },
          { label: 'Outcome', value: call.outcome?.replace(/_/g,' ') || '-' },
          { label: 'Called from', value: call.phone_numbers?.number || call.phone_numbers?.friendly_name || '-' },
          { label: 'Called at', value: call.started_at ? new Date(call.started_at).toLocaleString() : '-' },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--t4)', letterSpacing: '0.06em', marginBottom: 3 }}>{label.toUpperCase()}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)', fontWeight: 500, textTransform: label === 'Outcome' ? 'capitalize' : 'none' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Recording audio player */}
      {call.recording_url && <AudioPlayer src={call.recording_url} />}

      {/* AI Summary */}
      {call.ai_summary && (
        <div style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, color: GREEN, fontWeight: 600, letterSpacing: '0.06em' }}>AI SUMMARY</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>{call.ai_summary}</p>
        </div>
      )}

      {/* Live / completed transcript */}
      {(liveTranscript || isLive) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 8px' }}>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--t4)', fontWeight: 600, letterSpacing: '0.06em' }}>TRANSCRIPT</p>
            {isLive && (
              <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.2)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.06em' }}>
                LIVE
              </span>
            )}
          </div>
          <div
            ref={transcriptRef}
            onScroll={onTranscriptScroll}
            style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {liveTranscript ? liveTranscript.split('\n').filter(Boolean).map((line, i) => {
              const isAI     = /^(alex|agent|ai|assistant):/i.test(line)
              const isSeller = /^(seller|user|customer|human):/i.test(line)
              const color    = isAI ? GREEN : BLUE
              const label    = isAI ? 'ALEX' : 'SELL'
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color, flexShrink: 0,
                    width: 32, letterSpacing: '0.06em', marginTop: 3,
                    background: `${color}15`, borderRadius: 3, padding: '1px 3px', textAlign: 'center',
                  }}>{label}</span>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
                    {line.replace(/^(alex|agent|ai|assistant|seller|user|customer|human):\s*/i, '')}
                  </p>
                </div>
              )
            }) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, animation: 'pulse-live 1.5s ease-in-out infinite' }} />
                <p style={{ margin: 0, fontSize: 12, color: 'var(--t4)' }}>Waiting for conversation to start...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Go to lead */}
      {call.lead_id && (
        <button
          onClick={() => navigate(`/leads?highlight=${call.lead_id}`)}
          style={{
            width: '100%', height: 36, borderRadius: 8,
            background: 'var(--surface-bg)', border: '1px solid var(--border)',
            color: 'var(--t2)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit',
          }}
        >
          <UserCircle size={13} /> View Lead Profile <ChevronRight size={12} />
        </button>
      )}
    </div>
  )
}

// ─── Initiate Call Modal ──────────────────────────────────────────────────────
function InitiateCallModal({ onClose }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [calling, setCalling] = useState(null)

  useEffect(() => {
    if (!search || search.length < 2) { setResults([]); return }
    setLoading(true)
    leadsApi.getLeads({ search, limit: 8 }).then(r => {
      setResults(r.data?.data || r.data?.leads || [])
    }).catch(() => setResults([])).finally(() => setLoading(false))
  }, [search])

  const handleCall = async (lead) => {
    setCalling(lead.id)
    try {
      await callsApi.initiateCall({ lead_id: lead.id })
      toast.success(`Calling ${lead.first_name || 'lead'}...`)
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Call failed')
    } finally {
      setCalling(null)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}>
      <div style={{ width: 440, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>Call a Lead</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t4)' }}>Search by name, phone, or address</p>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search leads..."
              style={{
                width: '100%', padding: '10px 12px 10px 34px',
                background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                borderRadius: 10, fontSize: 13, color: 'var(--input-text)', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(0,195,122,0.5)'}
              onBlur={e => e.target.style.borderColor = 'var(--input-border)'}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {loading && <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--t4)', padding: '20px 0' }}>Searching...</p>}
            {!loading && results.length === 0 && search.length >= 2 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--t4)', padding: '20px 0' }}>No leads found</p>
            )}
            {!loading && search.length < 2 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--t4)', padding: '20px 0' }}>Type at least 2 characters to search</p>
            )}
            {results.map(lead => (
              <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 4 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>{lead.first_name} {lead.last_name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)' }}>{lead.phone} · {lead.property_address || 'No address'}</p>
                </div>
                <button
                  onClick={() => handleCall(lead)}
                  disabled={!!calling}
                  style={{
                    height: 32, padding: '0 14px', borderRadius: 7,
                    background: calling === lead.id ? 'rgba(0,195,122,0.6)' : GREEN,
                    border: 'none', color: '#000', fontSize: 12, fontWeight: 600,
                    cursor: calling ? 'not-allowed' : 'pointer', flexShrink: 0,
                  }}
                >
                  {calling === lead.id ? '...' : 'Call'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LiveMonitor() {
  const { calls: liveCalls }   = useLiveCalls()
  useInboundAlert(liveCalls)   // toast + tone when a seller calls in
  const [history, setHistory]  = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [takeovers, setTakeovers] = useState({})
  const [showDialer, setShowDialer] = useState(false)
  const { listening, pending, volumes, connectListen, disconnectListen, setVolume } = useListenMode()

  // Load call history
  const loadHistory = useCallback(async () => {
    try {
      const res = await callsApi.getCalls({ limit: 60, offset: 0 })
      const raw = res.data?.data || res.data?.calls || []
      setHistory(raw)
    } catch { }
    finally { setHistLoading(false) }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])
  // Refresh history every 8s, and whenever live calls change (catches ended calls moving to history)
  useEffect(() => { const t = setInterval(loadHistory, 8000); return () => clearInterval(t) }, [loadHistory])
  const prevLiveCount = useRef(0)
  useEffect(() => {
    if (prevLiveCount.current > 0 && liveCalls.length < prevLiveCount.current) {
      // A call just ended - reload history immediately so it appears there
      setTimeout(loadHistory, 1000)
    }
    prevLiveCount.current = liveCalls.length
  }, [liveCalls.length, loadHistory])

  // Auto-select first live call (only when no call is selected yet)
  useEffect(() => {
    if (liveCalls.length > 0 && !selected) setSelected(liveCalls[0])
  }, [liveCalls, selected])

  const handleListen = async (call) => {
    const callId = call.id
    // Tapping again while listening OR while still connecting cancels/stops it.
    if (listening[callId] || pending[callId]) { disconnectListen(callId); return }
    await connectListen(callId, call.id)
  }

  const handleTakeover = async (call) => {
    try {
      await callsApi.callTakeover(call.id || call.vapi_call_id)
      setTakeovers(t => ({ ...t, [call.id]: true }))
      toast.success('You are now live on this call')
    } catch { toast.error('Takeover failed') }
  }

  const handleReturn = async (call) => {
    try {
      await callsApi.returnToAI(call.id || call.vapi_call_id)
      setTakeovers(t => { const n = { ...t }; delete n[call.id]; return n })
      toast.success('Returned to AI')
    } catch { toast.error('Failed') }
  }

  const handleEnd = async (call) => {
    try {
      await callsApi.endCall(call.id)
      toast.success('Call ended')
      loadHistory()
    } catch { toast.error('Failed to end call') }
  }

  const handleDelete = async (call) => {
    try {
      await callsApi.deleteCall(call.id)
      if (selected?.id === call.id) setSelected(null)
      setHistory(h => h.filter(c => c.id !== call.id))
      toast.success('Call log removed')
    } catch { toast.error('Failed to delete call') }
  }

  // Merge live calls with history for the list (live calls at top)
  const liveIds  = new Set(liveCalls.map(c => c.id))
  const combined = [
    ...liveCalls,
    ...history.filter(c => !liveIds.has(c.id)),
  ]

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: live + history ── */}
      <div style={{ width: 340, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={15} style={{ color: GREEN }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>Live Monitor</span>
              {liveCalls.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: GREEN, background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.2)', borderRadius: 20, padding: '2px 8px' }}>
                  {liveCalls.length} LIVE
                </span>
              )}
            </div>
            <button
              onClick={() => setShowDialer(true)}
              style={{
                height: 30, padding: '0 12px', borderRadius: 7,
                background: GREEN, border: 'none', color: '#000',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
              }}
            >
              <Plus size={12} /> Call Lead
            </button>
          </div>
        </div>

        {/* Live calls */}
        {liveCalls.length > 0 && (
          <div style={{ padding: '12px 14px 6px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {liveCalls.map(call => {
              const callId = call.id || call.vapi_call_id
              return (
                <LiveCallCard
                  key={callId}
                  call={call}
                  isListening={!!listening[call.id]}
                  isPending={!!pending[call.id]}
                  volume={volumes[call.id]}
                  takeover={!!takeovers[call.id]}
                  isSelected={selected?.id === call.id}
                  onClick={() => setSelected(call)}
                  onListen={() => handleListen(call)}
                  onStopListen={() => disconnectListen(call.id)}
                  onSetVolume={vol => setVolume(call.id, vol)}
                  onTakeover={() => handleTakeover(call)}
                  onReturn={() => handleReturn(call)}
                  onEnd={() => handleEnd(call)}
                />
              )
            })}
          </div>
        )}

        {/* Call history list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {combined.length === 0 ? (
            histLoading ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid var(--border)`, borderTopColor: GREEN, animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ fontSize: 12, color: 'var(--t4)' }}>Loading calls...</p>
              </div>
            ) : (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <PhoneOff size={32} style={{ color: 'var(--t4)', marginBottom: 12 }} strokeWidth={1.3} />
                <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 4 }}>No calls yet</p>
                <p style={{ fontSize: 11, color: 'var(--t4)' }}>Launch a campaign to start dialing</p>
              </div>
            )
          ) : (
            <>
              {liveCalls.length > 0 && combined.length > liveCalls.length && (
                <div style={{ padding: '8px 16px 4px' }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em' }}>RECENT CALLS</p>
                </div>
              )}
              {combined.filter(c => !['initiated','ringing','in-progress'].includes(c.status)).map(call => (
                <CallRow
                  key={call.id}
                  call={call}
                  isSelected={selected?.id === call.id}
                  onClick={() => setSelected(call)}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: detail ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Panel header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t3)' }}>
            {selected ? 'Call Details' : 'Select a call'}
          </span>
          {selected && (
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 0 }}>
              <X size={14} />
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CallDetailPanel call={selected} />
        </div>
      </div>

      {/* Initiate call modal */}
      {showDialer && <InitiateCallModal onClose={() => setShowDialer(false)} />}
    </div>
  )
}
