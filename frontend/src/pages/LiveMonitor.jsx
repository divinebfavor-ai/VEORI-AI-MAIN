import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Headphones, Mic, X, Volume2, VolumeX } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { calls as callsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useIntelStore from '../store/intelStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'rgba(255,255,255,0.35)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function Waveform({ color = '#00C37A', bars = 20, active = true }) {
  const heights = useRef(Array.from({ length: bars }, () => 20 + Math.random() * 80))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32 }}>
      {heights.current.map((h, i) => (
        <div
          key={i}
          className={active ? 'wave-bar' : ''}
          style={{
            width: 3, borderRadius: 2,
            background: active ? color : 'rgba(255,255,255,0.10)',
            height: active ? `${h}%` : '20%',
            animationDelay: `${(i * 40) % 800}ms`,
            animationDuration: `${600 + (i * 37) % 600}ms`,
            transformOrigin: 'bottom',
            transition: active ? undefined : 'height 0.4s ease',
          }}
        />
      ))}
    </div>
  )
}

// ─── Live duration counter ─────────────────────────────────────────────────────
function Duration({ startedAt }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => setSecs(Math.floor((Date.now() - start) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <span style={{
      fontFamily: 'Geist Mono, monospace', fontSize: 22, fontWeight: 600,
      color: '#00C37A', letterSpacing: '0.02em',
    }}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}

// ─── Score Ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const s = score ?? 0
  const radius = 32
  const circ   = 2 * Math.PI * radius
  const offset = circ - (s / 100) * circ
  const color  = s >= 70 ? '#00C37A' : s >= 40 ? '#FF9500' : '#FF4444'

  return (
    <div style={{ position: 'relative', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} width="80" height="80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={color} strokeWidth="3.5"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
            filter: `drop-shadow(0 0 6px ${color})`,
          }}
        />
      </svg>
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <span style={{
          fontSize: 22, fontWeight: 700, color,
          fontFamily: 'Geist Mono, monospace', letterSpacing: '-0.02em',
          display: 'block', lineHeight: 1,
        }}>
          {score ?? '—'}
        </span>
      </div>
    </div>
  )
}

// ─── WebSocket Listen Mode (Vapi listenUrl is wss://) ─────────────────────────
function useListenMode() {
  const wsRefs      = useRef({})   // callId → WebSocket
  const ctxRefs     = useRef({})   // callId → AudioContext
  const gainRefs    = useRef({})   // callId → GainNode
  const nextTimeRef = useRef({})   // callId → next scheduled time
  const [listening, setListening] = useState({})
  const [volumes, setVolumes]     = useState({})

  const connectListen = useCallback(async (callId, dbCallId) => {
    try {
      // Fetch the wss:// listen URL from backend
      const token = localStorage.getItem('veori_token')
      const BASE  = import.meta.env.VITE_API_URL || 'http://localhost:3001'
      const r     = await fetch(`${BASE}/api/calls/${dbCallId}/listen`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || 'Could not get listen URL')
      }
      const { listen_url } = await r.json()
      if (!listen_url) throw new Error('Listen URL not ready — call may still be connecting')

      // Set up Web Audio
      const ctx  = new AudioContext({ sampleRate: 16000 })
      const gain = ctx.createGain()
      gain.gain.value = (volumes[callId] ?? 100) / 100
      gain.connect(ctx.destination)
      ctxRefs.current[callId]    = ctx
      gainRefs.current[callId]   = gain
      nextTimeRef.current[callId] = ctx.currentTime

      // Connect WebSocket directly to Vapi's wss endpoint
      const ws = new WebSocket(listen_url)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        setListening(l => ({ ...l, [callId]: true }))
        setVolumes(v => ({ ...v, [callId]: v[callId] ?? 100 }))
        toast.success('Listening live — seller cannot hear you.')
      }

      ws.onmessage = (event) => {
        try {
          // Vapi sends raw PCM-16 mono @ 16kHz
          const int16 = new Int16Array(event.data)
          const float32 = new Float32Array(int16.length)
          for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
          const buf = ctx.createBuffer(1, float32.length, 16000)
          buf.getChannelData(0).set(float32)
          const src = ctx.createBufferSource()
          src.buffer = buf
          src.connect(gain)
          const when = Math.max(nextTimeRef.current[callId], ctx.currentTime + 0.05)
          src.start(when)
          nextTimeRef.current[callId] = when + buf.duration
        } catch { /* ignore decode errors */ }
      }

      ws.onerror = () => toast.error('Audio stream error — call may have ended.')
      ws.onclose = () => {
        setListening(l => { const n = { ...l }; delete n[callId]; return n })
      }

      wsRefs.current[callId] = ws
    } catch (err) {
      console.error('Listen error:', err)
      toast.error(err.message || 'Could not connect to call audio.')
    }
  }, [volumes])

  const disconnectListen = useCallback((callId) => {
    const ws  = wsRefs.current[callId]
    const ctx = ctxRefs.current[callId]
    if (ws)  { ws.close(); delete wsRefs.current[callId] }
    if (ctx) { ctx.close(); delete ctxRefs.current[callId] }
    delete gainRefs.current[callId]
    delete nextTimeRef.current[callId]
    setListening(l => { const n = { ...l }; delete n[callId]; return n })
  }, [])

  const setVolume = useCallback((callId, vol) => {
    const gain = gainRefs.current[callId]
    if (gain) gain.gain.value = vol / 100
    setVolumes(v => ({ ...v, [callId]: vol }))
  }, [])

  useEffect(() => {
    return () => Object.keys(wsRefs.current).forEach(id => disconnectListen(id))
  }, [disconnectListen])

  return { listening, volumes, connectListen, disconnectListen, setVolume }
}

// ─── Call Row — compact, expandable ──────────────────────────────────────────
function CallCard({ call, takeover, listening, volume, onListen, onStopListen, onSetVolume, onTakeover, onReturn, onEnd }) {
  const [expanded, setExpanded] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [speaker, setSpeaker] = useState('idle') // 'ai' | 'seller' | 'idle'
  const txRef = useRef(null)

  useEffect(() => {
    if (!call.transcript) return
    const lines = call.transcript.split('\n').filter(Boolean).map(l => {
      const isAI = /^(alex|agent):/i.test(l)
      return { speaker: isAI ? 'ai' : 'seller', text: l.replace(/^(alex|agent|seller):\s*/i, '') }
    })
    setTranscript(lines.slice(-20))
    if (lines.length > 0) setSpeaker(lines[lines.length - 1].speaker)
  }, [call.transcript])

  useEffect(() => {
    txRef.current?.scrollTo({ top: 9999, behavior: 'smooth' })
  }, [transcript])

  const speakerColor = speaker === 'ai' ? '#00C37A' : speaker === 'seller' ? '#4D9EFF' : 'rgba(255,255,255,0.15)'
  const initials = (call.lead_name || 'UN').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${takeover ? 'rgba(0,195,122,0.40)' : speakerColor === 'rgba(255,255,255,0.15)' ? 'rgba(255,255,255,0.08)' : speakerColor + '44'}`,
      background: 'rgba(255,255,255,0.03)',
      overflow: 'hidden',
      transition: 'border-color 0.4s ease',
    }}>

      {/* ── Compact row ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {/* Speaker indicator dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: speakerColor,
          boxShadow: speaker !== 'idle' ? `0 0 8px ${speakerColor}` : 'none',
          transition: 'background 0.3s ease, box-shadow 0.3s ease',
        }} />

        {/* Avatar */}
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)',
        }}>
          {initials}
        </div>

        {/* Name + address */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.lead_name || 'Unknown Seller'}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.property_address || 'Address unknown'}
          </p>
        </div>

        {/* Speaker label */}
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: speakerColor, minWidth: 44, textAlign: 'center',
        }}>
          {speaker === 'ai' ? 'Alex' : speaker === 'seller' ? 'Seller' : 'Ringing'}
        </span>

        {/* Mini waveform */}
        <Waveform color={speakerColor} bars={10} active={speaker !== 'idle'} />

        {/* Duration */}
        <Duration startedAt={call.started_at} />

        {/* End button always visible */}
        <button
          onClick={e => { e.stopPropagation(); onEnd() }}
          style={{
            width: 30, height: 30, borderRadius: 6, flexShrink: 0,
            background: 'rgba(255,68,68,0.12)', border: '1px solid rgba(255,68,68,0.25)',
            color: '#FF4444', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 16px 14px' }}>

          {/* Transcript */}
          <div ref={txRef} style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '10px 12px',
            maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5,
            marginBottom: 12,
          }}>
            {transcript.length === 0 ? (
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', margin: 0 }}>Waiting for transcript...</p>
            ) : transcript.map((line, i) => {
              const isAI = line.speaker === 'ai'
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: isAI ? '#00C37A' : '#4D9EFF', flexShrink: 0, width: 34, marginTop: 2 }}>
                    {isAI ? 'Alex' : 'Seller'}
                  </span>
                  <p style={{ margin: 0, fontSize: 12, color: isAI ? 'rgba(255,255,255,0.65)' : '#fff', lineHeight: 1.5 }}>
                    {line.text}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={listening ? onStopListen : onListen}
              style={{
                flex: 1, height: 34, borderRadius: 7, fontSize: 12, fontWeight: 500,
                background: listening ? 'rgba(0,195,122,0.12)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${listening ? 'rgba(0,195,122,0.35)' : 'rgba(255,255,255,0.10)'}`,
                color: listening ? '#00C37A' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                fontFamily: 'inherit',
              }}
            >
              <Headphones size={12} /> {listening ? 'Listening' : 'Listen'}
            </button>

            {listening && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <Volume2 size={11} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                <input type="range" min={0} max={100} value={volume ?? 100}
                  onChange={e => onSetVolume(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#00C37A' }} />
              </div>
            )}

            <button
              onClick={takeover ? onReturn : onTakeover}
              style={{
                flex: 1, height: 34, borderRadius: 7, fontSize: 12, fontWeight: 500,
                background: takeover ? 'rgba(255,149,0,0.12)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${takeover ? 'rgba(255,149,0,0.35)' : 'rgba(255,255,255,0.10)'}`,
                color: takeover ? '#FF9500' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                fontFamily: 'inherit',
              }}
            >
              <Mic size={12} /> {takeover ? 'Return to AI' : 'Takeover'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main: Mission Control ────────────────────────────────────────────────────
export default function LiveMonitor() {
  const { calls: liveCalls }  = useLiveCalls()
  const [takeovers, setTakeovers] = useState({})
  const { listening, volumes, connectListen, disconnectListen, setVolume } = useListenMode()
  const setIntel = useIntelStore(s => s.setIntel)

  useEffect(() => {
    if (liveCalls.length > 0) setIntel('call', liveCalls[0])
  }, [liveCalls])

  const handleListen = async (call) => {
    const callId = call.id || call.vapi_call_id
    if (listening[callId]) { disconnectListen(callId); return }
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
    } catch { toast.error('Failed to return to AI') }
  }

  const handleEnd = async (call) => {
    try {
      await callsApi.endCall(call.id)
      toast.success('Call ended')
    } catch { toast.error('Failed to end call') }
  }

  const listeningCount = Object.keys(listening).length

  return (
    <div className="monitor-bg" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div className="glass" style={{
        borderRadius: 0, border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '18px 24px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.02em', margin: 0 }}>
            Live Call System
          </h1>
          {liveCalls.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.20)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 12, fontWeight: 600, color: '#00C37A',
            }}>
              <span className="live-dot" />
              {liveCalls.length} active {liveCalls.length === 1 ? 'call' : 'calls'}
            </div>
          )}
          {listeningCount > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 20, padding: '4px 10px',
              fontSize: 11, color: 'rgba(255,255,255,0.60)',
            }}>
              <Headphones size={11} strokeWidth={1.8} />
              Listening to {listeningCount} call{listeningCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Auto-refresh · 3s · Desktop only
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {liveCalls.length === 0 ? (
          /* ── Empty state ── */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', textAlign: 'center', padding: '60px 0',
          }}>
            {/* Animated radar */}
            <div style={{ position: 'relative', width: 80, height: 80, marginBottom: 24 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '1px solid rgba(0,195,122,0.15)',
                animation: 'pulse-live 3s ease-in-out infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 8, borderRadius: '50%',
                border: '1px solid rgba(0,195,122,0.10)',
                animation: 'pulse-live 3s ease-in-out infinite 0.5s',
              }} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%', background: 'rgba(0,195,122,0.06)',
              }}>
                <Radio size={28} style={{ color: '#00C37A' }} strokeWidth={1.5} />
              </div>
            </div>
            <p style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.70)', marginBottom: 6 }}>
              Command Center Ready
            </p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
              No active calls
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', marginBottom: 28 }}>
              Start a campaign to begin dialing
            </p>
            <Link to="/campaigns" style={{ textDecoration: 'none' }}>
              <button style={{
                height: 42, padding: '0 20px', borderRadius: 8,
                background: '#00C37A', border: 'none',
                color: '#000', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                boxShadow: '0 0 20px rgba(0,195,122,0.25)',
                fontFamily: 'inherit',
              }}>
                Launch Campaign
              </button>
            </Link>
          </div>
        ) : (
          /* ── Call cards ── */
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            maxWidth: 760, margin: '0 auto', width: '100%',
          }}>
            {liveCalls.map(call => {
              const callId = call.id || call.vapi_call_id
              return (
                <CallCard
                  key={callId}
                  call={call}
                  takeover={!!takeovers[call.id]}
                  listening={!!listening[callId]}
                  volume={volumes[callId]}
                  onListen={() => handleListen(call)}
                  onStopListen={() => disconnectListen(callId)}
                  onSetVolume={vol => setVolume(callId, vol)}
                  onTakeover={() => handleTakeover(call)}
                  onReturn={() => handleReturn(call)}
                  onEnd={() => handleEnd(call)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
