import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Headphones, Mic, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { calls as callsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useIntelStore from '../store/intelStore'

function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return 'var(--green)'
  if (s >= 40) return 'var(--amber)'
  return 'var(--red)'
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function Waveform({ color = 'var(--green)', bars = 22 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="waveform-bar"
          style={{
            width: 3,
            borderRadius: 2,
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

// ─── Live duration counter ────────────────────────────────────────────────────
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
  return (
    <span style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace', fontSize: 18, fontWeight: 600, color: 'var(--t1)', letterSpacing: '0.02em' }}>
      {m}:{String(s).padStart(2,'0')}
    </span>
  )
}

// ─── Score arc ────────────────────────────────────────────────────────────────
function ScoreArc({ score }) {
  const s = score ?? 0
  const color = s >= 70 ? 'var(--green)' : s >= 40 ? 'var(--amber)' : 'var(--red)'
  const r = 30
  const circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} width="80" height="80">
        <circle cx="40" cy="40" r={r} stroke="var(--s3)" strokeWidth="3" fill="none" />
        <circle
          cx="40" cy="40" r={r}
          stroke={color} strokeWidth="3" fill="none"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - s / 100)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
        {score ?? '—'}
      </span>
    </div>
  )
}

// ─── Call Mission Card ────────────────────────────────────────────────────────
function CallCard({ call, takeover, onListen, onTakeover, onReturn, onEnd }) {
  const [transcript, setTranscript] = useState([])
  const txRef = useRef(null)

  useEffect(() => {
    if (!call.transcript) return
    const lines = call.transcript.split('\n').filter(Boolean).map(l => {
      const isAI = /^(alex|agent):/i.test(l)
      return { speaker: isAI ? 'AI' : 'Seller', text: l.replace(/^(alex|agent|seller):\s*/i, '') }
    })
    setTranscript(lines.slice(-6))
  }, [call.transcript])

  useEffect(() => {
    txRef.current?.scrollTo({ top: 9999, behavior: 'smooth' })
  }, [transcript])

  return (
    <div style={{
      background: 'var(--s1)',
      border: `1px solid ${takeover ? 'rgba(0,229,122,0.35)' : 'var(--border-rest)'}`,
      borderRadius: 10,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      boxShadow: takeover ? '0 0 0 4px rgba(0,229,122,0.06)' : 'none',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="dot-live" />
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>
              {call.lead_name || 'Unknown Seller'}
            </p>
            {takeover && <Badge variant="green" dot>You're Live</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--t3)' }}>
            {call.property_address || 'Address unknown'}
          </p>
          {call.phone_number && (
            <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 2 }}>
              {call.phone_number}
            </p>
          )}
        </div>
        <Duration startedAt={call.started_at} />
      </div>

      {/* Waveforms */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t4)', width: 36, flexShrink: 0 }}>
            AI
          </span>
          <Waveform color="rgba(0,229,122,0.7)" bars={24} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t4)', width: 36, flexShrink: 0 }}>
            Seller
          </span>
          <Waveform color="rgba(255,255,255,0.20)" bars={24} />
        </div>
      </div>

      {/* Live transcript */}
      <div
        ref={txRef}
        style={{
          maxHeight: 120,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {transcript.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--t4)', fontStyle: 'italic' }}>
            Waiting for transcript…
          </p>
        ) : transcript.map((line, i) => (
          <div
            key={i}
            style={{
              paddingLeft: 8,
              borderLeft: `2px solid ${line.speaker === 'AI' ? 'var(--green)' : 'var(--border-active)'}`,
            }}
          >
            <p style={{
              fontSize: 12,
              color: line.speaker === 'AI' ? 'var(--t3)' : 'var(--t1)',
              lineHeight: 1.5,
            }}>
              {line.text}
            </p>
          </div>
        ))}
      </div>

      {/* Score + signals */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 8 }}>
            Motivation
          </p>
          <ScoreArc score={call.motivation_score} />
          {(call.key_signals || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
              {call.key_signals.map(s => (
                <span
                  key={s}
                  style={{
                    fontSize: 10, fontWeight: 500,
                    background: 'rgba(0,229,122,0.08)',
                    color: 'var(--green)',
                    border: '1px solid rgba(0,229,122,0.18)',
                    padding: '2px 6px', borderRadius: 3,
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {call.offer_made && (
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4 }}>
              Offer on table
            </p>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--gold)', letterSpacing: '-0.02em' }}>
              ${Number(call.offer_made).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Coaching (takeover mode) */}
      {takeover && (
        <div style={{
          background: 'rgba(0,229,122,0.04)',
          border: '1px solid rgba(0,229,122,0.18)',
          borderRadius: 6,
          padding: '12px 14px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 6 }}>
            Coaching
          </p>
          <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
            Seller seems motivated. Acknowledge their situation first, then anchor at your MAO and give them space to respond.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {['Anchor offer', 'Build rapport', 'Address objection', 'Request decision'].map(s => (
              <span
                key={s}
                style={{
                  fontSize: 10,
                  background: 'var(--s2)',
                  border: '1px solid var(--border-rest)',
                  color: 'var(--t3)',
                  padding: '3px 7px', borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!takeover ? (
          <>
            <Button variant="secondary" size="sm" style={{ flex: 1 }} onClick={() => onListen(call)}>
              <Headphones size={12} /> Listen
            </Button>
            <Button variant="primary" size="sm" style={{ flex: 1 }} onClick={() => onTakeover(call)}>
              <Mic size={12} /> Takeover
            </Button>
          </>
        ) : (
          <button
            onClick={() => onReturn(call)}
            style={{
              flex: 1, height: 36, borderRadius: 6,
              background: 'rgba(255,140,0,0.08)',
              border: '1px solid rgba(255,140,0,0.30)',
              color: 'var(--amber)',
              fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Return to AI
          </button>
        )}
        <Button variant="danger" size="sm" onClick={() => onEnd(call)} style={{ width: 36, padding: 0 }}>
          <X size={13} />
        </Button>
      </div>
    </div>
  )
}

// ─── Main: Mission Control ────────────────────────────────────────────────────
export default function LiveMonitor() {
  const { calls: liveCalls } = useLiveCalls()
  const [takeovers, setTakeovers] = useState({})
  const setIntel = useIntelStore(s => s.setIntel)

  // Push active call data into IntelPanel
  useEffect(() => {
    if (liveCalls.length > 0) {
      setIntel('call', liveCalls[0])
    }
  }, [liveCalls])

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
    toast.info('End call functionality requires Vapi integration')
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border-rest)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
              Live Call System
            </h1>
            {liveCalls.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(0,229,122,0.08)',
                border: '1px solid rgba(0,229,122,0.20)',
                borderRadius: 20,
                padding: '3px 10px',
                fontSize: 11, fontWeight: 600, color: 'var(--green)',
              }}>
                <span className="dot-live" />
                {liveCalls.length} active {liveCalls.length === 1 ? 'call' : 'calls'}
              </div>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--t4)',
          }}>
            Auto-refresh · 3s
          </span>
        </div>
        {liveCalls.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>
            Mission control — monitor and intervene in active AI calls
          </p>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {liveCalls.length === 0 ? (

          /* Empty state */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', padding: '60px 0', textAlign: 'center',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'var(--s2)', border: '1px solid var(--border-rest)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <Radio size={22} style={{ color: 'var(--t4)' }} strokeWidth={1.5} />
            </div>
            <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--t2)', marginBottom: 6 }}>
              No active calls
            </p>
            <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 24 }}>
              Start a campaign to begin dialing
            </p>
            <Link to="/campaigns" style={{ textDecoration: 'none' }}>
              <Button variant="secondary" size="sm">Go to Campaigns</Button>
            </Link>
          </div>

        ) : (

          /* Call cards grid */
          <div style={{
            display: 'grid',
            gridTemplateColumns: liveCalls.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 16,
            maxWidth: liveCalls.length === 1 ? 640 : 'none',
            margin: liveCalls.length === 1 ? '0 auto' : 0,
          }}>
            {liveCalls.map(call => (
              <CallCard
                key={call.id || call.vapi_call_id}
                call={call}
                takeover={!!takeovers[call.id]}
                onListen={() => toast.info('Listening mode — you can hear the call')}
                onTakeover={handleTakeover}
                onEnd={handleEnd}
                onReturn={handleReturn}
              />
            ))}
          </div>

        )}
      </div>
    </div>
  )
}
