import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Headphones, HeadphonesOff, Mic, X, Volume2, PhoneCall, PhoneOff, PhoneIncoming, Clock, CheckCircle, AlertCircle, ChevronRight, Search, Plus, UserCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { calls as callsApi, leads as leadsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'

const GREEN = '#00C37A'
const BLUE  = '#4D9EFF'
const RED   = '#FF4444'
const AMBER = '#FF9500'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs && secs !== 0) return '—'
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
  return { label: status?.toUpperCase() || '—', color: 'var(--t4)', icon: Clock }
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

// ─── WebSocket Listen Mode ────────────────────────────────────────────────────
function useListenMode() {
  const wsRefs      = useRef({})
  const ctxRefs     = useRef({})
  const gainRefs    = useRef({})
  const nextTimeRef = useRef({})
  const [listening, setListening] = useState({})
  const [volumes, setVolumes]     = useState({})

  const connectListen = useCallback(async (callId, dbCallId) => {
    try {
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

      const ctx  = new AudioContext({ sampleRate: 16000 })
      const gain = ctx.createGain()
      gain.gain.value = (volumes[callId] ?? 100) / 100
      gain.connect(ctx.destination)
      ctxRefs.current[callId]     = ctx
      gainRefs.current[callId]    = gain
      nextTimeRef.current[callId] = ctx.currentTime

      const ws = new WebSocket(listen_url)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        setListening(l => ({ ...l, [callId]: true }))
        toast.success('Listening — seller cannot hear you')
      }
      ws.onmessage = (ev) => {
        try {
          const int16  = new Int16Array(ev.data)
          const f32    = new Float32Array(int16.length)
          for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768
          const buf = ctx.createBuffer(1, f32.length, 16000)
          buf.getChannelData(0).set(f32)
          const src  = ctx.createBufferSource()
          src.buffer = buf; src.connect(gain)
          const when = Math.max(nextTimeRef.current[callId], ctx.currentTime + 0.05)
          src.start(when)
          nextTimeRef.current[callId] = when + buf.duration
        } catch { }
      }
      ws.onerror = () => toast.error('Audio stream error')
      ws.onclose = () => setListening(l => { const n = { ...l }; delete n[callId]; return n })
      wsRefs.current[callId] = ws
    } catch (err) {
      toast.error(err.message || 'Could not connect to call audio')
    }
  }, [volumes])

  const disconnectListen = useCallback((callId) => {
    wsRefs.current[callId]?.close()
    ctxRefs.current[callId]?.close()
    delete wsRefs.current[callId]; delete ctxRefs.current[callId]
    delete gainRefs.current[callId]; delete nextTimeRef.current[callId]
    setListening(l => { const n = { ...l }; delete n[callId]; return n })
  }, [])

  const setVolume = useCallback((callId, vol) => {
    if (gainRefs.current[callId]) gainRefs.current[callId].gain.value = vol / 100
    setVolumes(v => ({ ...v, [callId]: vol }))
  }, [])

  useEffect(() => () => Object.keys(wsRefs.current).forEach(disconnectListen), [disconnectListen])
  return { listening, volumes, connectListen, disconnectListen, setVolume }
}

// ─── Live Call Card ───────────────────────────────────────────────────────────
function LiveCallCard({ call, isListening, volume, takeover, onListen, onStopListen, onSetVolume, onTakeover, onReturn, onEnd, isSelected, onClick }) {
  const initials = (call.lead_name || 'UN').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 14,
        border: `1px solid ${isSelected ? 'rgba(0,195,122,0.40)' : 'rgba(0,195,122,0.15)'}`,
        background: isSelected ? 'rgba(0,195,122,0.06)' : 'rgba(0,195,122,0.03)',
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: 'rgba(0,195,122,0.12)', border: '1.5px solid rgba(0,195,122,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: GREEN,
          }}>{initials}</div>
          <span style={{
            position: 'absolute', bottom: 0, right: -2,
            width: 10, height: 10, borderRadius: '50%',
            background: GREEN, border: '2px solid var(--card-bg)',
            animation: 'pulse-live 2s ease-in-out infinite',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.lead_name || 'Unknown Seller'}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.property_address || 'Address unknown'}
          </p>
        </div>
        <Duration startedAt={call.started_at} />
      </div>

      {/* Waveform */}
      <div style={{ marginBottom: 14 }}>
        <Waveform active bars={18} color={isListening ? BLUE : GREEN} />
      </div>

      {/* Action buttons — always visible */}
      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
        {/* LISTEN — primary prominent button */}
        <button
          onClick={isListening ? onStopListen : onListen}
          style={{
            flex: 1, height: 36, borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: isListening ? BLUE : GREEN,
            border: 'none', color: '#000',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontFamily: 'inherit', letterSpacing: '-0.01em',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          {isListening ? <HeadphonesOff size={13} /> : <Headphones size={13} />}
          {isListening ? 'Stop' : 'Listen Live'}
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
function CallRow({ call, isSelected, onClick }) {
  const isLive = ['initiated','ringing','in-progress'].includes(call.status)
  const { label, color, icon: Icon } = statusMeta(call.status, call.outcome)
  const name = call.leads
    ? `${call.leads.first_name || ''} ${call.leads.last_name || ''}`.trim() || 'Unknown'
    : call.lead_name || 'Unknown Seller'

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
        borderBottom: '1px solid var(--border)',
        background: isSelected ? 'var(--surface-bg-2)' : 'transparent',
        cursor: 'pointer', transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-bg)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Status dot */}
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
        boxShadow: isLive ? `0 0 6px ${color}` : 'none',
        animation: isLive ? 'pulse-live 2s ease-in-out infinite' : 'none',
      }} />

      {/* Name + address */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {call.leads?.phone || call.phone_numbers?.number || '—'}
        </p>
      </div>

      {/* Duration */}
      <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'Geist Mono, monospace', flexShrink: 0 }}>
        {call.duration_seconds ? fmt(call.duration_seconds) : isLive ? 'live' : '—'}
      </span>

      {/* Status badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color, background: `${color}15`, border: `1px solid ${color}28`,
        borderRadius: 5, padding: '2px 6px', flexShrink: 0,
      }}>{label}</span>

      {/* Time */}
      <span style={{ fontSize: 10, color: 'var(--t4)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
        {timeAgo(call.started_at || call.created_at)}
      </span>
    </div>
  )
}

// ─── Call Detail Panel ────────────────────────────────────────────────────────
function CallDetailPanel({ call }) {
  const navigate = useNavigate()
  if (!call) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        <PhoneCall size={36} style={{ color: 'var(--t4)' }} strokeWidth={1.3} />
        <p style={{ fontSize: 14, color: 'var(--t3)', textAlign: 'center' }}>Select a call to see details</p>
      </div>
    )
  }

  const { label, color } = statusMeta(call.status, call.outcome)
  const name = call.leads
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
          <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{call.leads?.phone || '—'}</p>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color, background: `${color}15`, border: `1px solid ${color}28`, borderRadius: 5, padding: '2px 7px', display: 'inline-block', marginTop: 6 }}>{label}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        {[
          { label: 'Duration', value: call.duration_seconds ? fmt(call.duration_seconds) : isLive ? 'Live now' : '—' },
          { label: 'Outcome', value: call.outcome?.replace(/_/g,' ') || '—' },
          { label: 'Called from', value: call.phone_numbers?.number || call.phone_numbers?.friendly_name || '—' },
          { label: 'Called at', value: call.started_at ? new Date(call.started_at).toLocaleString() : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--t4)', letterSpacing: '0.06em', marginBottom: 3 }}>{label.toUpperCase()}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)', fontWeight: 500, textTransform: label === 'Outcome' ? 'capitalize' : 'none' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* AI Summary */}
      {call.ai_summary && (
        <div style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, color: GREEN, fontWeight: 600, letterSpacing: '0.06em' }}>AI SUMMARY</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>{call.ai_summary}</p>
        </div>
      )}

      {/* Transcript */}
      {call.transcript && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, color: 'var(--t4)', fontWeight: 600, letterSpacing: '0.06em' }}>TRANSCRIPT</p>
          <div style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {call.transcript.split('\n').filter(Boolean).map((line, i) => {
              const isAI = /^(alex|agent):/i.test(line)
              return (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: isAI ? GREEN : BLUE, flexShrink: 0, width: 36, letterSpacing: '0.06em', marginTop: 2 }}>{isAI ? 'ALEX' : 'SELL'}</span>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{line.replace(/^(alex|agent|seller):\s*/i, '')}</p>
                </div>
              )
            })}
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
      <div style={{ width: 440, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
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
  const [history, setHistory]  = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [takeovers, setTakeovers] = useState({})
  const [showDialer, setShowDialer] = useState(false)
  const { listening, volumes, connectListen, disconnectListen, setVolume } = useListenMode()

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
  // Refresh history every 15s
  useEffect(() => { const t = setInterval(loadHistory, 15000); return () => clearInterval(t) }, [loadHistory])

  // Auto-select first live call
  useEffect(() => {
    if (liveCalls.length > 0 && !selected) setSelected(liveCalls[0])
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
    } catch { toast.error('Failed') }
  }

  const handleEnd = async (call) => {
    try {
      await callsApi.endCall(call.id)
      toast.success('Call ended')
      loadHistory()
    } catch { toast.error('Failed to end call') }
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
                  isListening={!!listening[callId]}
                  volume={volumes[callId]}
                  takeover={!!takeovers[call.id]}
                  isSelected={selected?.id === call.id}
                  onClick={() => setSelected(call)}
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
