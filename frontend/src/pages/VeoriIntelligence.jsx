/**
 * AI Activity — per-lead view of what the AI has actually done.
 *
 * STYLING: every colour comes from the platform design tokens in index.css
 * (--app-bg, --card-bg, --border, --t1..--t4, --green, --gold, --red, --amber).
 * An earlier version hardcoded its own navy palette, which did not match any
 * other page and broke light mode entirely — tokens are the only correct source.
 *
 * ROBUSTNESS: this page previously crashed into the app-wide ErrorBoundary
 * ("Something went wrong / Reload App") whenever any part of the payload was
 * missing, because the render destructured the response and then walked into it
 * unguarded. Every field is now defaulted and every list is checked before use,
 * so a partial response degrades to an empty state instead of taking the app down.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Brain, Zap, Phone, MessageSquare, FileText, Calendar,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle,
  Clock, CheckCircle2, Circle, Loader2, Activity, TrendingUp,
  Target, Flame, DollarSign, MapPin, User, Radio, Search,
} from 'lucide-react'

const API = (import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app')
  .replace(/\/+$/, '').replace(/\/api$/, '') + '/api'

function authHeaders() {
  const t = localStorage.getItem('veori_token') || localStorage.getItem('token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Semantic accents, taken from the platform tokens so they stay in step with the
// rest of the product in both themes.
const ACCENT = {
  green: 'var(--green)',
  gold:  'var(--gold)',
  red:   'var(--red)',
  amber: 'var(--amber)',
  blue:  '#4D9EFF',
}

// ─── Score ring ───────────────────────────────────────────────────────────────
// A null score renders an em-dash, never a fabricated zero.
function ScoreRing({ score, size = 96 }) {
  const r = (size / 2) - 8
  const circ = 2 * Math.PI * r
  const known = score != null && !Number.isNaN(Number(score))
  const v = known ? Math.max(0, Math.min(100, Number(score))) : 0
  const color = !known ? 'var(--t4)' : v >= 70 ? ACCENT.green : v >= 40 ? ACCENT.amber : ACCENT.red
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-bg-3)" strokeWidth={7} />
      {known && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * circ} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 1s var(--ease-smooth)' }}
        />
      )}
      <text
        x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={size < 56 ? 15 : 22} fontWeight={800}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {known ? v : '—'}
      </text>
    </svg>
  )
}

// ─── PMI bar ──────────────────────────────────────────────────────────────────
const CONF_TEXT = { measured: 'measured', derived: 'derived', low: 'weak signal', none: 'no data' }

function PMIBar({ label, metric, color, icon: Icon, delay = 0 }) {
  const value = metric && metric.value != null ? Number(metric.value) : null
  const known = value != null && !Number.isNaN(value)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(known ? Math.max(0, Math.min(100, value)) : 0), 100 + delay)
    return () => clearTimeout(t)
  }, [value, known, delay])

  const barColor = known ? color : 'var(--t4)'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {Icon && <Icon size={12} style={{ color: barColor, flexShrink: 0 }} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {CONF_TEXT[metric?.confidence] || CONF_TEXT.none}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontVariantNumeric: 'tabular-nums' }}>
            {known ? value : '—'}
          </span>
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-bg-2)', borderRadius: 100, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${width}%`, borderRadius: 100,
          background: known ? color : 'transparent',
          transition: 'width 0.9s var(--ease-smooth)',
        }} />
      </div>
      {metric?.basis && (
        <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 5, lineHeight: 1.5 }}>{metric.basis}</div>
      )}
    </div>
  )
}

// ─── Agent chain ──────────────────────────────────────────────────────────────
const AGENT_ICONS = {
  import:   { Icon: User,          color: ACCENT.blue  },
  sms:      { Icon: MessageSquare, color: ACCENT.blue  },
  reply:    { Icon: MessageSquare, color: ACCENT.green },
  call:     { Icon: Phone,         color: ACCENT.gold  },
  analysis: { Icon: Brain,         color: ACCENT.amber },
  contract: { Icon: FileText,      color: ACCENT.green },
  calendar: { Icon: Calendar,      color: ACCENT.blue  },
  followup: { Icon: RefreshCw,     color: ACCENT.blue  },
  nurture:  { Icon: Clock,         color: 'var(--t4)'  },
  activity: { Icon: Activity,      color: 'var(--t3)'  },
}

function statusMeta(status) {
  if (status === 'active')    return { color: ACCENT.green, Icon: Radio,         pulse: true }
  if (status === 'failed')    return { color: ACCENT.red,   Icon: AlertTriangle, pulse: false }
  if (status === 'completed') return { color: ACCENT.green, Icon: CheckCircle2,  pulse: false }
  return { color: 'var(--t4)', Icon: Circle, pulse: false }
}

function timeStr(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

function AgentStep({ step, isLast }) {
  const [open, setOpen] = useState(false)
  const { Icon: AIcon, color: aColor } = AGENT_ICONS[step?.icon] || AGENT_ICONS.activity
  const { color: sColor, Icon: SIcon, pulse } = statusMeta(step?.status)

  const signals    = Array.isArray(step?.signals) ? step.signals : []
  const objections = Array.isArray(step?.objections) ? step.objections : []
  const hasDetail  = !!step?.transcript || signals.length > 0 || objections.length > 0
  const isLive     = step?.status === 'active'

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0, position: 'relative',
          background: 'var(--surface-bg-2)', border: `1px solid ${isLive ? ACCENT.green : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AIcon size={14} style={{ color: aColor }} />
          {pulse && (
            <span style={{
              position: 'absolute', inset: -3, borderRadius: '50%',
              border: `2px solid ${ACCENT.green}`, animation: 'veoriPing 1.4s ease-out infinite',
            }} />
          )}
        </div>
        {!isLast && <div style={{ width: 1, flex: 1, minHeight: 18, background: 'var(--border)', marginTop: 4 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
        <div
          onClick={() => hasDetail && setOpen(o => !o)}
          style={{
            background: 'var(--card-bg)',
            border: `1px solid ${isLive ? ACCENT.green : 'var(--card-border)'}`,
            borderRadius: 10, padding: '11px 13px',
            cursor: hasDetail ? 'pointer' : 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: aColor, background: 'var(--surface-bg-2)',
                  padding: '2px 7px', borderRadius: 100, whiteSpace: 'nowrap',
                }}>
                  {step?.agent || 'System'}
                </span>
                {isLive && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT.green }}>● LIVE</span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>
                {step?.action || 'Activity'}
              </div>
              {step?.detail && (
                <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, wordBreak: 'break-word' }}>
                  {step.detail}
                </div>
              )}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <SIcon size={13} style={{ color: sColor }} />
              {hasDetail && (open
                ? <ChevronUp size={12} style={{ color: 'var(--t4)' }} />
                : <ChevronDown size={12} style={{ color: 'var(--t4)' }} />)}
            </span>
          </div>

          {step?.at && (
            <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
              {timeStr(step.at)}
            </div>
          )}

          {open && hasDetail && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              {signals.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT.green, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    Key signals
                  </div>
                  {signals.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 2 }}>· {String(s)}</div>
                  ))}
                </div>
              )}
              {objections.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    Objections
                  </div>
                  {objections.map((o, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 2 }}>· {String(o)}</div>
                  ))}
                </div>
              )}
              {step?.transcript && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                    Transcript
                  </div>
                  <div style={{
                    maxHeight: 220, overflowY: 'auto', fontSize: 12, lineHeight: 1.65,
                    color: 'var(--t2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: 'var(--surface-bg-2)', borderRadius: 8, padding: '10px 12px',
                  }}>
                    {step.transcript}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Next action ──────────────────────────────────────────────────────────────
const URGENCY = {
  live:     { color: ACCENT.green, label: '● LIVE' },
  critical: { color: ACCENT.red,   label: 'CRITICAL' },
  high:     { color: ACCENT.amber, label: 'HIGH' },
  medium:   { color: ACCENT.blue,  label: 'MEDIUM' },
  low:      { color: 'var(--t3)',  label: 'LOW' },
  none:     { color: 'var(--t4)',  label: 'NONE' },
}

function NextAction({ next }) {
  if (!next) return null
  const u = URGENCY[next.urgency] || URGENCY.low
  return (
    <div style={{
      background: 'var(--card-bg)', border: `1px solid ${u.color}`,
      borderRadius: 12, padding: '13px 15px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <Target size={13} style={{ color: u.color }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          Next action
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: u.color }}>{u.label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 3 }}>{next.action}</div>
      {next.detail && <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5 }}>{next.detail}</div>}
    </div>
  )
}

// ─── Live platform feed ───────────────────────────────────────────────────────
function LiveFeed() {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${API}/calls?limit=12&offset=0`, { headers: authHeaders() })
      if (!r.ok) { setConnected(false); return }
      const json = await r.json()
      setEvents(Array.isArray(json?.data) ? json.data : [])
      setConnected(true)
    } catch { setConnected(false) }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 10000)
    return () => clearInterval(t)
  }, [poll])

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Radio size={13} style={{ color: connected ? ACCENT.green : 'var(--t4)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          Platform activity
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t4)' }}>
          {connected ? 'live' : '—'}
        </span>
      </div>

      {events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--t4)', fontSize: 12 }}>
          No recent calls.
        </div>
      ) : events.map((ev, i) => {
        const name = ev?.lead_name
          || (ev?.leads ? `${ev.leads.first_name || ''} ${ev.leads.last_name || ''}`.trim() : '')
          || 'Lead'
        const label = String(ev?.outcome || ev?.status || '').replace(/_/g, ' ')
        return (
          <div key={ev?.id || i} style={{
            display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 0',
            borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <Phone size={11} style={{ color: ACCENT.gold, marginTop: 3, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}{label ? ` · ${label}` : ''}
              </div>
              {ev?.motivation_score != null && (
                <div style={{ fontSize: 11, color: 'var(--t4)' }}>Score {ev.motivation_score}</div>
              )}
            </div>
            <span style={{ fontSize: 10, color: 'var(--t4)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {ev?.started_at ? new Date(ev.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared chrome ────────────────────────────────────────────────────────────
const KEYFRAMES = `@keyframes veoriPing{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(1.5);opacity:0}}
@keyframes veoriSpin{to{transform:rotate(360deg)}}`

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100%', background: 'var(--app-bg)', color: 'var(--t1)' }}>
      <style>{KEYFRAMES}</style>
      {children}
    </div>
  )
}

function Centered({ children }) {
  return (
    <Shell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '80px 24px', textAlign: 'center' }}>
        {children}
      </div>
    </Shell>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function VeoriIntelligence() {
  const { id: leadId } = useParams()
  const navigate = useNavigate()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)
  const timerRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!leadId) { setLoading(false); return }
    silent ? setBusy(true) : setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API}/leads/${leadId}/intelligence`, { headers: authHeaders() })
      if (r.status === 401) throw new Error('Your session has expired. Please sign in again.')
      if (r.status === 404) throw new Error('That lead no longer exists.')
      if (!r.ok) throw new Error(`Server returned ${r.status}`)

      // Guard the shape: a payload without `data` must not reach the renderer.
      const json = await r.json().catch(() => null)
      if (!json || typeof json !== 'object' || !json.data) {
        throw new Error('The server sent an unexpected response.')
      }
      setData(json.data)
    } catch (e) {
      setError(e?.message || 'Something went wrong loading this lead.')
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [leadId])

  useEffect(() => {
    load()
    if (leadId) {
      timerRef.current = setInterval(() => load(true), 20000)
      return () => clearInterval(timerRef.current)
    }
  }, [load, leadId])

  if (!leadId) return <LeadPicker />

  if (loading) return (
    <Centered>
      <Loader2 size={30} style={{ color: ACCENT.green, animation: 'veoriSpin 1s linear infinite' }} />
      <div style={{ color: 'var(--t3)', fontSize: 14 }}>Loading AI activity…</div>
    </Centered>
  )

  if (error) return (
    <Centered>
      <AlertTriangle size={28} style={{ color: ACCENT.amber }} />
      <div style={{ color: 'var(--t2)', fontSize: 14, maxWidth: 380 }}>{error}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => load()} style={{
          background: ACCENT.green, color: '#04140C', border: 'none', borderRadius: 8,
          padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>Try again</button>
        <button onClick={() => navigate('/leads')} style={{
          background: 'var(--surface-bg-2)', color: 'var(--t2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>Back to leads</button>
      </div>
    </Centered>
  )

  // Every field defaulted — a partial payload renders an empty state, never a crash.
  const lead       = data?.lead || {}
  const pmi        = data?.pmi || {}
  const chain      = Array.isArray(data?.agentChain) ? data.agentChain : []
  const nextAction = data?.nextAction || null
  const counts     = data?.counts || {}

  const overall = pmi.overall?.value ?? null
  const name    = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead'
  const isHot   = overall != null && overall >= 70

  return (
    <Shell>
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '14px 22px',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        position: 'sticky', top: 0, zIndex: 20, background: 'var(--app-bg)',
      }}>
        <button onClick={() => navigate(-1)} style={{
          background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: 0, fontFamily: 'inherit',
        }}>
          <ArrowLeft size={15} /> Back
        </button>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em' }}>{name}</span>
            {isHot && (
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT.green, background: 'var(--surface-bg-2)', padding: '2px 8px', borderRadius: 100 }}>
                HOT
              </span>
            )}
            {lead.status && (
              <span style={{ fontSize: 10, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lead.status}</span>
            )}
          </div>
          {lead.property_address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <MapPin size={11} style={{ color: 'var(--t4)' }} />
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{lead.property_address}</span>
            </div>
          )}
        </div>

        <button onClick={() => load(true)} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--t3)', cursor: 'pointer', padding: '6px 11px',
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'inherit',
        }}>
          <RefreshCw size={12} style={{ animation: busy ? 'veoriSpin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <Link to="/leads" style={{ fontSize: 12, color: ACCENT.green, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          All leads <ExternalLink size={11} />
        </Link>
      </div>

      <div style={{
        padding: 22, display: 'grid', gap: 18,
        gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr) minmax(240px, 280px)',
        alignItems: 'start', maxWidth: 1500, margin: '0 auto',
      }} className="veori-intel-grid">
        {/* Left */}
        <div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 18, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
              <Brain size={13} style={{ color: ACCENT.gold }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                Motivation
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
              <ScoreRing score={overall} size={94} />
              {pmi.overall?.basis && (
                <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
                  {pmi.overall.basis}
                </div>
              )}
            </div>
            <PMIBar label="Distress"   metric={pmi.distress}   color={ACCENT.red}   icon={Flame}      delay={0} />
            <PMIBar label="Urgency"    metric={pmi.urgency}    color={ACCENT.amber} icon={Zap}        delay={100} />
            <PMIBar label="Engagement" metric={pmi.engagement} color={ACCENT.blue}  icon={Activity}   delay={200} />
            <PMIBar label="Equity"     metric={pmi.equity}     color={ACCENT.green} icon={DollarSign} delay={300} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 14 }}>
            {[
              { label: 'Calls', value: counts.calls ?? 0 },
              { label: 'Texts', value: counts.sms ?? 0 },
              { label: 'Value', value: lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '—' },
              { label: 'Equity', value: lead.estimated_equity ? `$${Number(lead.estimated_equity).toLocaleString()}` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '11px 13px' }}>
                <div style={{ fontSize: 10, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>

          <NextAction next={nextAction} />
        </div>

        {/* Middle */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <TrendingUp size={13} style={{ color: ACCENT.green }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
              What the AI has done
            </span>
            <span style={{ fontSize: 11, color: 'var(--t4)' }}>{chain.length} step{chain.length === 1 ? '' : 's'}</span>
            {busy && <Loader2 size={11} style={{ color: ACCENT.green, animation: 'veoriSpin 1s linear infinite' }} />}
          </div>

          {chain.length === 0 ? (
            <div style={{
              background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14,
              padding: '44px 24px', textAlign: 'center',
            }}>
              <Activity size={22} style={{ color: 'var(--t4)', marginBottom: 10 }} />
              <div style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 600, marginBottom: 5 }}>No activity yet</div>
              <div style={{ color: 'var(--t4)', fontSize: 12, lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
                Nothing has been sent to or received from this seller. Add them to a campaign
                and every text, call and AI decision will appear here.
              </div>
            </div>
          ) : chain.map((step, i) => (
            <AgentStep key={step?.id || i} step={step} isLast={i === chain.length - 1} />
          ))}
        </div>

        {/* Right */}
        <div><LiveFeed /></div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .veori-intel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Shell>
  )
}

// ─── Lead picker (no :id in the URL) ─────────────────────────────────────────
function LeadPicker() {
  const [leads, setLeads]     = useState([])
  const [q, setQ]             = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/leads?limit=100`, { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) throw new Error('Your session has expired. Please sign in again.')
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then(d => { if (!cancelled) setLeads(Array.isArray(d?.data) ? d.data : []) })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load leads.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = leads.filter(l =>
    `${l?.first_name || ''} ${l?.last_name || ''} ${l?.property_address || ''}`
      .toLowerCase().includes(q.toLowerCase())
  )

  return (
    <Shell>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 22px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <Brain size={19} style={{ color: ACCENT.green }} />
          <h1 style={{ fontSize: 21, fontWeight: 800, color: 'var(--t1)', margin: 0, letterSpacing: '-0.02em' }}>AI Activity</h1>
        </div>
        <p style={{ color: 'var(--t3)', fontSize: 14, marginBottom: 22, marginTop: 0 }}>
          Pick a seller to see every text, call and decision the AI has made.
        </p>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search leads…"
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)',
              border: '1px solid var(--input-border)', borderRadius: 10, color: 'var(--input-text)',
              padding: '11px 14px 11px 34px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>Loading leads…</div>
        )}
        {error && !loading && (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--t3)', fontSize: 13 }}>{error}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {!loading && !error && filtered.slice(0, 40).map(l => (
            <button
              key={l.id}
              onClick={() => navigate(`/intelligence/lead/${l.id}`)}
              style={{
                background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
                padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--t1)' }}>
                  {`${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unnamed lead'}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--t4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.property_address || '—'}
                </span>
              </span>
              <ScoreRing score={l.motivation_score} size={40} />
            </button>
          ))}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>No leads found.</div>
          )}
        </div>
      </div>
    </Shell>
  )
}
