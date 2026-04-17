import React, { useState, useEffect } from 'react'
import { Activity, Headphones, Mic, ArrowLeft, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { calls as callsApi } from '../services/api'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

// Waveform animation component
function Waveform({ active = true, color = '#3B82F6' }) {
  const bars = [0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 1, 0.7, 0.4]
  return (
    <div className="flex items-end gap-0.5 h-8">
      {bars.map((h, i) => (
        <div
          key={i}
          className={active ? 'waveform-bar' : ''}
          style={{
            width: '3px',
            height: `${h * 100}%`,
            backgroundColor: color,
            borderRadius: '2px',
            animationDelay: `${i * 0.1}s`,
            opacity: active ? 1 : 0.3,
            transform: active ? undefined : 'scaleY(0.3)',
            transformOrigin: 'bottom',
          }}
        />
      ))}
    </div>
  )
}

function scoreStyle(score) {
  if (score == null) return { bg: 'bg-text-muted/20', text: 'text-text-secondary', glow: false }
  if (score >= 85) return { bg: 'bg-hot/20', text: 'text-hot', glow: true }
  if (score >= 70) return { bg: 'bg-success/20', text: 'text-success', glow: false }
  if (score >= 40) return { bg: 'bg-warning/20', text: 'text-warning', glow: false }
  return { bg: 'bg-text-muted/20', text: 'text-text-secondary', glow: false }
}

function emotionVariant(emotion) {
  const map = { Motivated: 'green', Interested: 'blue', Calm: 'gray', Anxious: 'yellow', Resistant: 'red' }
  return map[emotion] || 'gray'
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Coaching Panel
function CoachingPanel({ call, onReturnToAI, onClose }) {
  const [returning, setReturning] = useState(false)

  const handleReturn = async () => {
    setReturning(true)
    try {
      await callsApi.returnToAI(call.id)
      toast.success('Returned to AI')
      onReturnToAI?.()
    } catch {
      toast.error('Failed to return to AI')
    } finally {
      setReturning(false)
    }
  }

  const suggestions = [
    "I understand, selling a home is a big decision.",
    "What would make this work for you?",
    "We can close in as little as 14 days, all cash.",
    "I'd love to make you a fair offer — can I ask a few questions?",
    "We handle all the repairs, you don't need to fix anything.",
  ]

  const objectionResponses = {
    "Not interested": "I totally understand. Can I ask — is there any situation where selling quickly would help you?",
    "Too low": "I hear you. The offer accounts for our repair costs — but tell me, what number would work for you?",
    "Need to think": "Of course, no rush. Can I call you back tomorrow morning?",
    "Have an agent": "Great! We can actually work with agents. Would your agent be open to an as-is cash offer?",
  }

  return (
    <div className="w-80 bg-surface border-l border-border-subtle flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div>
          <h3 className="font-bold text-text-primary text-sm">Live Coaching</h3>
          <p className="text-xs text-text-muted">{call.seller_name || 'Seller'}</p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <ArrowLeft size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Suggested Lines */}
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Suggested Lines</h4>
          <div className="space-y-2">
            {suggestions.map((line, i) => (
              <button
                key={i}
                className="w-full text-left text-sm text-text-secondary bg-elevated hover:bg-card border border-border-subtle hover:border-primary/40 rounded-lg p-3 transition-all"
                onClick={() => {
                  navigator.clipboard.writeText(line)
                  toast.success('Copied!')
                }}
              >
                {line}
              </button>
            ))}
          </div>
        </div>

        {/* Objection Handlers */}
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Objection Responses</h4>
          <div className="space-y-2">
            {Object.entries(objectionResponses).map(([obj, response]) => (
              <div key={obj} className="bg-elevated border border-border-subtle rounded-lg p-3">
                <p className="text-xs font-medium text-danger mb-1">"{obj}"</p>
                <p className="text-xs text-text-secondary leading-relaxed">{response}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-border-subtle">
        <Button
          variant="secondary"
          className="w-full"
          loading={returning}
          onClick={handleReturn}
        >
          <RefreshCw size={14} /> Return to AI
        </Button>
      </div>
    </div>
  )
}

// Single Call Panel
function CallPanel({ call, tick }) {
  const [takingOver, setTakingOver] = useState(false)
  const [takenOver, setTakenOver] = useState(false)
  const [showCoaching, setShowCoaching] = useState(false)

  const elapsed = call.started_at
    ? Math.floor((Date.now() - new Date(call.started_at)) / 1000)
    : call.duration || 0

  const score = call.motivation_score ?? call.score
  const style = scoreStyle(score)
  const transcript = call.transcript_lines || call.messages || []

  const handleTakeover = async () => {
    setTakingOver(true)
    try {
      await callsApi.callTakeover(call.id)
      setTakenOver(true)
      setShowCoaching(true)
      toast.success('You have taken over the call')
    } catch {
      toast.error('Takeover failed')
    } finally {
      setTakingOver(false)
    }
  }

  return (
    <div className={clsx(
      'bg-card border rounded-xl overflow-hidden flex',
      takenOver ? 'border-danger' : 'border-border-subtle'
    )}>
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-text-primary truncate">
                {call.seller_name || call.lead_name || 'Unknown Seller'}
              </h3>
              <p className="text-xs text-text-muted truncate">
                {call.address || 'No address'}
              </p>
            </div>
            {takenOver && (
              <Badge variant="red" className="flex-shrink-0 ml-2">LIVE</Badge>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">{call.phone || call.to_number || '—'}</span>
            <span className="text-sm font-mono font-bold text-text-primary">
              {formatDuration(elapsed + tick * 0)}
            </span>
          </div>
        </div>

        {/* Waveform */}
        <div className="px-5 py-3 border-b border-border-subtle/50">
          <Waveform active={!takenOver} color={takenOver ? '#EF4444' : '#3B82F6'} />
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto px-5 py-3 max-h-40 space-y-1.5">
          {transcript.length === 0 ? (
            <p className="text-xs text-text-muted italic">Waiting for transcript...</p>
          ) : (
            transcript.slice(-8).map((msg, i) => (
              <div key={i} className="text-xs leading-relaxed">
                <span className={`font-semibold mr-1 ${msg.role === 'assistant' || msg.speaker === 'AI' || msg.speaker === 'Alex' ? 'text-primary' : 'text-text-primary'}`}>
                  {msg.speaker || (msg.role === 'assistant' ? 'Alex' : 'Seller')}:
                </span>
                <span className="text-text-secondary">{msg.text || msg.content}</span>
              </div>
            ))
          )}
        </div>

        {/* Score + Emotion */}
        <div className="px-5 py-3 border-t border-border-subtle/50 flex items-center gap-3">
          <div className={clsx('rounded-xl px-4 py-2 text-center', style.bg, style.glow && 'animate-glow')}>
            <div className={clsx('text-3xl font-black leading-none', style.text)}>
              {score ?? '—'}
            </div>
            <div className="text-xs text-text-muted mt-0.5">Score</div>
          </div>
          <div className="flex-1 space-y-2">
            {call.emotion && (
              <Badge variant={emotionVariant(call.emotion)}>{call.emotion}</Badge>
            )}
            {/* Key signals */}
            <div className="flex flex-wrap gap-1">
              {(call.signals || call.key_signals || []).slice(0, 4).map((sig, i) => (
                <span key={i} className="text-xs bg-elevated text-text-secondary border border-border-subtle rounded px-1.5 py-0.5">
                  {sig}
                </span>
              ))}
            </div>
            {/* Offer */}
            {call.suggested_offer && (
              <div className="text-xs font-semibold text-success">
                Offer: ${Number(call.suggested_offer).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-5 pb-5 flex gap-3 mt-1">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 border-primary/40 text-primary"
            onClick={() => {}}
          >
            <Headphones size={14} /> Listen
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            loading={takingOver}
            onClick={handleTakeover}
          >
            <Mic size={14} /> Take Over
          </Button>
        </div>
      </div>

      {/* Coaching Panel */}
      {showCoaching && (
        <CoachingPanel
          call={call}
          onReturnToAI={() => setTakenOver(false)}
          onClose={() => setShowCoaching(false)}
        />
      )}
    </div>
  )
}

export default function LiveMonitor() {
  const [liveCalls, setLiveCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  // Second ticker for duration display
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch live calls every 3s
  useEffect(() => {
    let mounted = true
    const fetch = async () => {
      try {
        const res = await callsApi.getLiveCalls()
        if (mounted) {
          setLiveCalls(res.data?.calls || res.data || [])
          setLoading(false)
        }
      } catch {
        if (mounted) setLoading(false)
      }
    }
    fetch()
    const interval = setInterval(fetch, 3000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Live Monitor</h1>
            {liveCalls.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-danger/10 border border-danger/30 rounded-full">
                <span className="w-2 h-2 bg-danger rounded-full animate-pulse" />
                <span className="text-xs text-danger font-semibold">{liveCalls.length} LIVE</span>
              </div>
            )}
          </div>
          <p className="text-text-secondary text-sm mt-1">Real-time call supervision and takeover</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : liveCalls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="relative mb-6">
            <Activity size={56} className="text-text-muted" />
            <div className="absolute inset-0 flex items-center justify-center">
              {/* wave bars */}
              <div className="flex items-end gap-0.5">
                {[3, 5, 8, 5, 3].map((h, i) => (
                  <div
                    key={i}
                    style={{
                      width: '4px',
                      height: `${h * 4}px`,
                      background: '#243550',
                      borderRadius: '2px',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">No Active Calls</h2>
          <p className="text-text-secondary text-sm">Start a campaign to begin calling</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
          {liveCalls.map((call) => (
            <CallPanel key={call.id} call={call} tick={tick} />
          ))}
        </div>
      )}
    </div>
  )
}
