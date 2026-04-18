import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Headphones, Mic, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { calls as callsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'

function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}

// ─── Waveform bars ────────────────────────────────────────────────────────────
function Waveform({ color = '#00C37A', bars = 20 }) {
  return (
    <div className="flex items-center gap-0.5 h-8">
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} className="w-1 rounded-full waveform-bar"
          style={{
            background: color,
            height: `${20 + Math.random() * 80}%`,
            animationDelay: `${(i * 40) % 800}ms`,
            animationDuration: `${600 + (i * 37) % 600}ms`,
          }}
        />
      ))}
    </div>
  )
}

// ─── Duration timer ───────────────────────────────────────────────────────────
function Duration({ startedAt }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const update = () => setSecs(Math.floor((Date.now() - start) / 1000))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return <span className="tabular-nums">{m}:{String(s).padStart(2,'0')}</span>
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const color = score >= 70 ? '#00C37A' : score >= 40 ? '#FF9500' : '#FF4444'
  const pct   = score / 100
  const r     = 36
  const circ  = 2 * Math.PI * r
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="96" height="96">
        <circle cx="48" cy="48" r={r} stroke="#242424" strokeWidth="3" fill="none" />
        <circle cx="48" cy="48" r={r} stroke={color} strokeWidth="3" fill="none"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className={`text-[28px] font-bold leading-none ${scoreColor(score)}`}>{score ?? '—'}</span>
    </div>
  )
}

// ─── Call Panel ───────────────────────────────────────────────────────────────
function CallPanel({ call, isTakeover, onListen, onTakeover, onEnd, onReturn }) {
  const [transcript, setTranscript] = useState([])
  const txRef = useRef(null)

  useEffect(() => {
    if (call.transcript) {
      const lines = call.transcript.split('\n').filter(Boolean).map(l => {
        const isAlex = l.toLowerCase().startsWith('alex:') || l.toLowerCase().startsWith('agent:')
        return { speaker: isAlex ? 'Alex' : 'Seller', text: l.replace(/^(alex|agent|seller):\s*/i, '') }
      })
      setTranscript(lines.slice(-8))
    }
  }, [call.transcript])

  useEffect(() => { txRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }) }, [transcript])

  return (
    <div className={`bg-card border rounded-lg p-6 flex flex-col gap-5 transition-all ${
      isTakeover ? 'border-primary shadow-lg shadow-primary/10 animate-pulse-slow' : 'border-border-subtle'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[16px] font-medium text-white">{call.lead_name || 'Unknown Seller'}</h3>
          <p className="text-[12px] text-text-muted mt-0.5">{call.property_address || 'Address unknown'}</p>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-mono font-medium text-text-primary">
            <Duration startedAt={call.started_at} />
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">{call.phone_number || '—'}</p>
        </div>
      </div>

      {/* Waveforms */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="label-caps w-10">Alex</span>
          <Waveform color="#00C37A" bars={24} />
        </div>
        <div className="flex items-center gap-3">
          <span className="label-caps w-10">Seller</span>
          <Waveform color="#555555" bars={24} />
        </div>
      </div>

      {/* Transcript */}
      <div ref={txRef} className="space-y-1.5 max-h-[140px] overflow-y-auto scrollbar-hide">
        {transcript.length === 0
          ? <p className="text-[12px] text-text-muted italic">Waiting for transcript…</p>
          : transcript.map((line, i) => (
            <div key={i} className={`flex gap-2 pl-2 border-l-2 ${line.speaker === 'Alex' ? 'border-primary' : 'border-border-default'}`}>
              <p className={`text-[12px] leading-relaxed ${line.speaker === 'Alex' ? 'text-text-secondary' : 'text-text-primary'}`}>
                {line.text}
              </p>
            </div>
          ))
        }
      </div>

      {/* Score + Signals */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="label-caps mb-2">Motivation Score</p>
          <ScoreRing score={call.motivation_score ?? 0} />
          {/* Signals */}
          {(call.key_signals || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {(call.key_signals || []).map(s => (
                <span key={s} className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-[3px]">{s}</span>
              ))}
            </div>
          )}
        </div>
        {call.offer_made && (
          <div className="text-right">
            <p className="label-caps mb-1">Current MAO</p>
            <p className="text-[22px] font-bold text-gold">${Number(call.offer_made).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Coaching panel when in takeover */}
      {isTakeover && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <p className="label-caps text-primary mb-2">Coaching</p>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            Seller seems motivated. Acknowledge their situation first. Then anchor at your MAO and give them space to respond.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {['Anchor offer', 'Build rapport', 'Address objection', 'Request decision'].map(s => (
              <span key={s} className="text-[10px] bg-elevated border border-border-subtle text-text-muted px-2 py-0.5 rounded-[3px] cursor-pointer hover:border-primary/40 hover:text-primary transition-colors">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        {!isTakeover ? (
          <>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => onListen(call)}>
              <Headphones size={13} /> Listen
            </Button>
            <Button size="sm" className="flex-1" onClick={() => onTakeover(call)}>
              <Mic size={13} /> Takeover
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" className="flex-1" style={{ borderColor:'#FF9500', color:'#FF9500' }} onClick={() => onReturn(call)}>
            Return to AI
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={() => onEnd(call)}>
          <X size={13} />
        </Button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LiveMonitor() {
  const { calls: liveCalls } = useLiveCalls()
  const [takeovers, setTakeovers] = useState({})

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
      setTakeovers(t => { const n = {...t}; delete n[call.id]; return n })
      toast.success('Returned to AI')
    } catch { toast.error('Failed to return to AI') }
  }

  const handleEnd = async (call) => {
    toast.info('End call functionality requires Vapi integration')
  }

  const gridClass = liveCalls.length === 1 ? 'max-w-2xl mx-auto'
    : liveCalls.length === 2 ? 'grid grid-cols-2 gap-4'
    : 'grid grid-cols-2 gap-4'

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-medium text-white">Live Monitor</h1>
          {liveCalls.length > 0 && (
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary text-[12px] font-medium px-3 py-1 rounded-full">
              <span className="dot-live" />
              {liveCalls.length} active {liveCalls.length === 1 ? 'call' : 'calls'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <RefreshCw size={12} />
          Auto-refreshing every 3s
        </div>
      </div>

      {liveCalls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-full bg-elevated border border-border-subtle flex items-center justify-center mb-5">
            <Radio size={24} className="text-text-muted" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-medium text-text-primary mb-2">No active calls</h2>
          <p className="text-[14px] text-text-muted mb-6">Start a campaign to begin dialing</p>
          <Link to="/campaigns">
            <Button variant="secondary">Go to Campaigns</Button>
          </Link>
        </div>
      ) : (
        <div className={gridClass}>
          {liveCalls.map(call => (
            <CallPanel
              key={call.id || call.vapi_call_id}
              call={call}
              isTakeover={!!takeovers[call.id]}
              onListen={() => toast.info('Listening mode — you can hear the call')}
              onTakeover={handleTakeover}
              onEnd={handleEnd}
              onReturn={handleReturn}
            />
          ))}
        </div>
      )}
    </div>
  )
}
