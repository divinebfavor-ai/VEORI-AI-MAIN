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

// ─── WebRTC Listen Mode ────────────────────────────────────────────────────────
function useListenMode() {
  const peerRefs = useRef({})    // callId → RTCPeerConnection
  const audioRefs = useRef({})   // callId → HTMLAudioElement
  const [listening, setListening] = useState({})   // callId → bool
  const [volumes, setVolumes]     = useState({})   // callId → 0-100

  const connectListen = useCallback(async (callId, listenUrl) => {
    if (!listenUrl) {
      toast.error('Listen URL not available — call must be active with Vapi integration')
      return
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })

      pc.ontrack = (event) => {
        const audio = new Audio()
        audio.srcObject = event.streams[0]
        audio.autoplay  = true
        audio.volume    = (volumes[callId] ?? 100) / 100
        document.body.appendChild(audio)
        audioRefs.current[callId] = audio
      }

      const offer = await pc.createOffer({ offerToReceiveAudio: true })
      await pc.setLocalDescription(offer)

      const res = await fetch(listenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })

      if (!res.ok) throw new Error(`Listen connect failed: ${res.status}`)

      const answerSdp = await res.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      peerRefs.current[callId] = pc
      setListening(l => ({ ...l, [callId]: true }))
      setVolumes(v => ({ ...v, [callId]: v[callId] ?? 100 }))
      toast.success('Connected — you can hear the call. Seller cannot hear you.')
    } catch (err) {
      console.error('Listen connect error:', err)
      toast.error('Failed to connect audio stream. Check Vapi integration.')
    }
  }, [volumes])

  const disconnectListen = useCallback((callId) => {
    const pc    = peerRefs.current[callId]
    const audio = audioRefs.current[callId]
    if (pc)    { pc.close(); delete peerRefs.current[callId] }
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); delete audioRefs.current[callId] }
    setListening(l => { const n = { ...l }; delete n[callId]; return n })
  }, [])

  const setVolume = useCallback((callId, vol) => {
    const audio = audioRefs.current[callId]
    if (audio) audio.volume = vol / 100
    setVolumes(v => ({ ...v, [callId]: vol }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.keys(peerRefs.current).forEach(id => disconnectListen(id))
    }
  }, [disconnectListen])

  return { listening, volumes, connectListen, disconnectListen, setVolume }
}

// ─── Call Mission Card ─────────────────────────────────────────────────────────
function CallCard({ call, takeover, listening, volume, onListen, onStopListen, onSetVolume, onTakeover, onReturn, onEnd }) {
  const [transcript, setTranscript] = useState([])
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now())
  const [transcriptActive, setTranscriptActive] = useState(true)
  const txRef = useRef(null)

  useEffect(() => {
    if (!call.transcript) return
    const lines = call.transcript.split('\n').filter(Boolean).map(l => {
      const isAI = /^(alex|agent):/i.test(l)
      return { speaker: isAI ? 'AI' : 'Seller', text: l.replace(/^(alex|agent|seller):\s*/i, '') }
    })
    setTranscript(lines.slice(-8))
    setLastUpdateTime(Date.now())
  }, [call.transcript])

  // Detect silence — if no transcript update in 3s, flatten waveform
  useEffect(() => {
    const t = setInterval(() => {
      setTranscriptActive(Date.now() - lastUpdateTime < 3000)
    }, 500)
    return () => clearInterval(t)
  }, [lastUpdateTime])

  useEffect(() => {
    txRef.current?.scrollTo({ top: 9999, behavior: 'smooth' })
  }, [transcript])

  return (
    <div className="glass-elevated glass-refraction" style={{
      borderRadius: 20,
      padding: 24,
      display: 'flex', flexDirection: 'column', gap: 18,
      border: takeover
        ? '1px solid rgba(0,195,122,0.40)'
        : listening
        ? '1px solid rgba(255,255,255,0.18)'
        : '1px solid rgba(255,255,255,0.10)',
      boxShadow: takeover
        ? '0 0 0 0.5px rgba(255,255,255,0.08) inset, 0 16px 48px rgba(0,0,0,0.5), 0 0 40px rgba(0,195,122,0.12)'
        : '0 0 0 0.5px rgba(255,255,255,0.08) inset, 0 16px 48px rgba(0,0,0,0.5)',
      animation: takeover ? 'pulse-slow 3s ease-in-out infinite' : 'none',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(0,195,122,0.10)', border: '1px solid rgba(0,195,122,0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#00C37A',
          }}>
            {(call.lead_name || 'UN').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="live-dot" />
              <p style={{ fontSize: 15, fontWeight: 600, color: '#FFFFFF', margin: 0 }}>
                {call.lead_name || 'Unknown Seller'}
              </p>
              {takeover && <Badge variant="green" dot>You&apos;re Live</Badge>}
              {listening && !takeover && <Badge variant="white">Listening</Badge>}
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', margin: 0 }}>
              {call.property_address || 'Address unknown'}
            </p>
            {call.phone_number && (
              <span style={{
                display: 'inline-block', marginTop: 4,
                fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.30)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4, padding: '2px 6px',
                fontFamily: 'Geist Mono, monospace',
              }}>
                {call.phone_number}
              </span>
            )}
          </div>
        </div>
        <Duration startedAt={call.started_at} />
      </div>

      {/* Waveforms */}
      <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: '#00C37A', width: 40, flexShrink: 0, textTransform: 'uppercase' }}>AI</span>
          <Waveform color="rgba(0,195,122,0.80)" bars={22} active={transcriptActive} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.35)', width: 40, flexShrink: 0, textTransform: 'uppercase' }}>Seller</span>
          <Waveform color="rgba(255,255,255,0.35)" bars={22} active={transcriptActive} />
        </div>
      </div>

      {/* Transcript */}
      <div ref={txRef} style={{
        background: 'rgba(0,0,0,0.30)', borderRadius: 10, padding: '12px 14px',
        maxHeight: 148, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {transcript.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', fontFamily: 'Geist Mono, monospace' }}>
            Waiting for transcript…
          </p>
        ) : transcript.map((line, i) => {
          const isAI    = line.speaker === 'AI'
          const isLast  = i === transcript.length - 1
          return (
            <div key={i} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              paddingLeft: 8,
              borderLeft: `2px solid ${isAI ? '#00C37A' : 'rgba(255,255,255,0.25)'}`,
              background: isLast ? 'rgba(255,255,255,0.03)' : 'transparent',
              borderRadius: '0 4px 4px 0',
              padding: '2px 6px',
              transition: 'background 0.3s ease',
            }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: isAI ? '#00C37A' : 'rgba(255,255,255,0.35)',
                flexShrink: 0, marginTop: 2, width: 34,
                fontFamily: 'Geist Mono, monospace',
              }}>
                {isAI ? 'Alex' : 'Seller'}
              </span>
              <p style={{
                fontSize: 12, color: isAI ? 'rgba(255,255,255,0.70)' : '#FFFFFF',
                lineHeight: 1.5, margin: 0, flex: 1,
              }}>
                {line.text}
              </p>
            </div>
          )
        })}
      </div>

      {/* Score + signals + offer */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <p className="label-caps" style={{ marginBottom: 10 }}>Motivation Score</p>
          <ScoreRing score={call.motivation_score} />
          {(call.key_signals || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
              {call.key_signals.map(s => (
                <span key={s} style={{
                  fontSize: 10, fontWeight: 500,
                  background: 'rgba(0,195,122,0.08)', color: '#00C37A',
                  border: '1px solid rgba(0,195,122,0.20)',
                  padding: '3px 6px', borderRadius: 4,
                }}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        {call.offer_made && (
          <div style={{ textAlign: 'right' }}>
            <p className="label-caps" style={{ marginBottom: 8 }}>Calculated Offer</p>
            <p style={{
              fontSize: 26, fontWeight: 700, color: '#C9A84C', margin: 0,
              fontFamily: 'Geist Mono, monospace', letterSpacing: '-0.02em',
              filter: 'drop-shadow(0 0 12px rgba(201,168,76,0.3))',
            }}>
              ${Number(call.offer_made).toLocaleString()}
            </p>
            <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.30)', marginTop: 3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>MAO</p>
          </div>
        )}
      </div>

      {/* Takeover coaching */}
      {takeover && (
        <div style={{
          background: 'rgba(0,195,122,0.04)',
          border: '1px solid rgba(0,195,122,0.18)',
          borderRadius: 10, padding: '14px 16px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#00C37A', marginBottom: 8 }}>
            AI Coaching
          </p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.70)', lineHeight: 1.7, marginBottom: 10 }}>
            Seller seems motivated. Acknowledge their situation first, then anchor at your MAO and give them space to respond.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['Anchor offer', 'Build rapport', 'Address objection', 'Request decision'].map(s => (
              <span key={s} style={{
                fontSize: 10, cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.55)', padding: '4px 8px', borderRadius: 5,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,195,122,0.4)'; e.currentTarget.style.color = '#00C37A' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)' }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Listen volume slider */}
      {listening && !takeover && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Volume2 size={12} style={{ color: 'rgba(255,255,255,0.40)', flexShrink: 0 }} />
          <input
            type="range" min={0} max={100} value={volume ?? 100}
            onChange={e => onSetVolume(Number(e.target.value))}
            style={{ flex: 1, height: 3, accentColor: '#00C37A' }}
          />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 28, textAlign: 'right', fontFamily: 'Geist Mono, monospace' }}>
            {volume ?? 100}%
          </span>
        </div>
      )}

      {/* Control buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!listening ? (
          <button
            onClick={onListen}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(255,255,255,0.70)', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.18s ease', fontFamily: 'inherit',
              backdropFilter: 'blur(12px)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; e.currentTarget.style.color = '#FFFFFF' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = 'rgba(255,255,255,0.70)' }}
          >
            <Headphones size={13} strokeWidth={1.8} /> Listen
          </button>
        ) : (
          <button
            onClick={onStopListen}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)',
              color: '#FFFFFF', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <Headphones size={13} strokeWidth={1.8} /> Listening
          </button>
        )}

        {!takeover ? (
          <button
            onClick={onTakeover}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(255,255,255,0.70)', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.18s ease', fontFamily: 'inherit',
              backdropFilter: 'blur(12px)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.10)'; e.currentTarget.style.borderColor = 'rgba(255,68,68,0.30)'; e.currentTarget.style.color = '#FF4444' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = 'rgba(255,255,255,0.70)' }}
          >
            <Mic size={13} strokeWidth={1.8} /> Takeover
          </button>
        ) : (
          <button
            onClick={onReturn}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              background: 'rgba(255,149,0,0.10)', border: '1px solid rgba(255,149,0,0.30)',
              color: '#FF9500', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            Return to AI
          </button>
        )}

        <button
          onClick={onEnd}
          style={{
            width: 38, height: 38, borderRadius: 8, flexShrink: 0,
            background: 'rgba(255,68,68,0.10)', border: '1px solid rgba(255,68,68,0.22)',
            color: '#FF4444', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.20)'; e.currentTarget.style.borderColor = 'rgba(255,68,68,0.40)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.10)'; e.currentTarget.style.borderColor = 'rgba(255,68,68,0.22)' }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
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
    try {
      // Fetch live listen URL from backend (Vapi monitor.listenUrl)
      const res = await callsApi.getListenUrl(call.id)
      await connectListen(callId, res.listen_url)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not get listen URL')
    }
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

  const handleEnd = async () => {
    toast.info('End call — requires Vapi integration')
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
            display: 'grid',
            gridTemplateColumns: liveCalls.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 20,
            maxWidth: liveCalls.length === 1 ? 700 : 'none',
            margin: liveCalls.length === 1 ? '0 auto' : 0,
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
