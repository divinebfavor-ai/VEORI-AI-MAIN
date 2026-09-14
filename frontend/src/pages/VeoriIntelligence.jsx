/**
 * Lead profile — everything about ONE seller in one place, and the controls to act
 * on it. Nothing from any other lead appears here.
 *
 * What it shows: motivation + breakdown, next action, deal prediction, property /
 * equity / mortgage data, seller profile, consent + compliance, every step the AI
 * took, the full text thread, every call with its audio and transcript, photos and
 * aerial imagery, signed documents, the deal, notes, and the AI instructions.
 *
 * What the team can do from here: text the seller, start an AI call, take over a
 * live call and hand it back, end a call, drop a voicemail, request photos, skip
 * trace, mark DNC, clear a human-review flag, write notes, and tell the AI how to
 * handle this seller (lead.ai_instructions is read by the live voice engine before
 * every call: voiceBrainService -> getScriptByLeadTag -> buildAlexPrompt).
 *
 * Deliberately NOT here: a "pause AI" switch. deals.ai_paused is saved and logged
 * but no outreach path reads it, so a toggle would claim control it does not have.
 *
 * Styling: platform tokens only (--app-bg, --card-bg, --border, --t1..--t4) with
 * the platform accents green / amber / red / gold. No blue.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Brain, Zap, Phone, PhoneCall, PhoneOff, MessageSquare, FileText, Calendar,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle, Clock, CheckCircle2,
  Circle, Loader2, Activity, TrendingUp, Target, Flame, DollarSign, MapPin, User,
  Radio, Search, Send, Mic, Camera, Ban, Copy, Check, Home, ShieldCheck, Image as ImageIcon,
  Headphones, StickyNote, Briefcase, UserCheck,
} from 'lucide-react'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

const API = (import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app')
  .replace(/\/+$/, '').replace(/\/api$/, '') + '/api'

function authHeaders() {
  const t = localStorage.getItem('veori_token') || localStorage.getItem('token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Every request goes through here. A response that is not JSON (e.g. the SPA shell
// returned for a wrong path) is treated as an error, never as success.
async function apiFetch(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await r.json() } catch { json = null }
  if (r.status === 401) throw new Error('Your session has expired. Please sign in again.')
  if (json === null) throw new Error(`Unexpected response from the server (${r.status}).`)
  if (!r.ok || json.success === false) throw new Error(json.error || `Request failed (${r.status}).`)
  return json
}

const C = { green: '#00C37A', amber: '#FF9500', red: '#FF4444', gold: '#C9A84C' }

function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return C.green
  if (s >= 40) return C.amber
  return C.red
}
function toScore(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)))
}
const money = (n) => (n != null && n !== '' && !Number.isNaN(Number(n)) ? `$${Number(n).toLocaleString()}` : null)
const pct = (n) => (n != null && n !== '' && !Number.isNaN(Number(n)) ? `${Number(n)}%` : null)
const words = (s) => (s ? String(s).replace(/_/g, ' ') : null)
function dateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}
function duration(sec) {
  if (!sec) return null
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}
const isLiveStatus = (s) => ['initiated', 'ringing', 'in-progress'].includes(s)

// ─── Primitives ───────────────────────────────────────────────────────────────
// Longhand border so per-card borderColor overrides never mix with a `border`
// shorthand (React warns that mixing them can drop the colour on re-render).
const cardStyle = { background: 'var(--card-bg)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--card-border)', borderRadius: 14 }

function Card({ children, style }) {
  return <div style={{ ...cardStyle, padding: 18, ...style }}>{children}</div>
}

function SectionTitle({ icon: Icon, color = C.gold, children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
      {Icon && <Icon size={13} style={{ color }} />}
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{children}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  )
}

function Empty({ icon: Icon, title, body, action }) {
  return (
    <div style={{ ...cardStyle, padding: '40px 24px', textAlign: 'center' }}>
      {Icon && <Icon size={20} style={{ color: 'var(--t4)', marginBottom: 10 }} />}
      <div style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 600, marginBottom: 5 }}>{title}</div>
      {body && <div style={{ color: 'var(--t4)', fontSize: 12, lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>{body}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

function InfoRows({ rows }) {
  const visible = rows.filter(r => r.value != null && r.value !== '' && r.value !== false)
  if (visible.length === 0) return <div style={{ fontSize: 12, color: 'var(--t4)' }}>Nothing on file yet.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {visible.map(({ label, value, color }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{label}</span>
          <span style={{ fontSize: 12, color: color || 'var(--t2)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word', fontVariantNumeric: 'tabular-nums' }}>
            {value === true ? 'Yes' : value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Score ring + motivation bars (the design the owner preferred) ────────────
function ScoreRing({ score, size = 96 }) {
  const r = (size / 2) - 8
  const circ = 2 * Math.PI * r
  const v = toScore(score)
  const known = v != null
  const color = scoreColor(v)
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-bg-3)" strokeWidth={7} />
      {known && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * circ} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 1s var(--ease-smooth)' }}
        />
      )}
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fill={color}
        fontSize={size < 56 ? 15 : 22} fontWeight={800} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {known ? v : '—'}
      </text>
    </svg>
  )
}

const CONF_TEXT = { measured: 'measured', derived: 'derived', low: 'weak signal', none: 'no data' }

function PMIBar({ label, metric, color, icon: Icon, delay = 0 }) {
  const v = toScore(metric?.value)
  const known = v != null
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(known ? v : 0), 100 + delay)
    return () => clearTimeout(t)
  }, [v, known, delay])
  const barColor = known ? color : 'var(--t4)'
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={12} style={{ color: barColor }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{CONF_TEXT[metric?.confidence] || CONF_TEXT.none}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontVariantNumeric: 'tabular-nums' }}>{known ? v : '—'}</span>
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-bg-2)', borderRadius: 100, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${width}%`, borderRadius: 100, background: known ? color : 'transparent', transition: 'width 0.9s var(--ease-smooth)' }} />
      </div>
      {metric?.basis && <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 5, lineHeight: 1.5 }}>{metric.basis}</div>}
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div style={{ ...cardStyle, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

// ─── Activity chain ───────────────────────────────────────────────────────────
const STEP = {
  import:   { Icon: User,          color: 'var(--t3)', badge: 'gray'  },
  sms:      { Icon: MessageSquare, color: C.gold,      badge: 'gold'  },
  reply:    { Icon: MessageSquare, color: C.green,     badge: 'green' },
  call:     { Icon: Phone,         color: C.gold,      badge: 'gold'  },
  analysis: { Icon: Brain,         color: C.amber,     badge: 'amber' },
  contract: { Icon: FileText,      color: C.green,     badge: 'green' },
  calendar: { Icon: Calendar,      color: C.gold,      badge: 'gold'  },
  followup: { Icon: RefreshCw,     color: 'var(--t3)', badge: 'gray'  },
  nurture:  { Icon: Clock,         color: 'var(--t4)', badge: 'gray'  },
  activity: { Icon: Activity,      color: 'var(--t3)', badge: 'gray'  },
}

function statusMeta(status) {
  if (status === 'active')    return { color: C.green, Icon: Radio, pulse: true }
  if (status === 'failed')    return { color: C.red, Icon: AlertTriangle, pulse: false }
  if (status === 'completed') return { color: C.green, Icon: CheckCircle2, pulse: false }
  return { color: 'var(--t4)', Icon: Circle, pulse: false }
}

function AgentStep({ step, isLast }) {
  const [open, setOpen] = useState(false)
  const meta = STEP[step?.icon] || STEP.activity
  const st = statusMeta(step?.status)
  const signals = Array.isArray(step?.signals) ? step.signals : []
  const objections = Array.isArray(step?.objections) ? step.objections : []
  const hasDetail = !!step?.transcript || !!step?.recording || signals.length > 0 || objections.length > 0
  const isLive = step?.status === 'active'
  const StepIcon = meta.Icon
  const StatusIcon = st.Icon
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', position: 'relative', flexShrink: 0,
          background: 'var(--surface-bg-2)', border: `1px solid ${isLive ? C.green : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <StepIcon size={14} style={{ color: meta.color }} />
          {st.pulse && <span className="vp-ping" style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${C.green}` }} />}
        </div>
        {!isLast && <div style={{ width: 1, flex: 1, minHeight: 18, background: 'var(--border)', marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
        <div
          role={hasDetail ? 'button' : undefined} tabIndex={hasDetail ? 0 : undefined}
          onClick={() => hasDetail && setOpen(o => !o)}
          onKeyDown={(e) => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(o => !o) } }}
          style={{ ...cardStyle, borderRadius: 10, padding: '11px 13px', borderColor: isLive ? C.green : 'var(--card-border)', cursor: hasDetail ? 'pointer' : 'default' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                <Badge variant={meta.badge}>{step?.agent || 'System'}</Badge>
                {isLive && <Badge variant="green" dot>Live</Badge>}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>{step?.action || 'Activity'}</div>
              {step?.detail && <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, wordBreak: 'break-word' }}>{step.detail}</div>}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <StatusIcon size={13} style={{ color: st.color }} />
              {hasDetail && (open ? <ChevronUp size={12} style={{ color: 'var(--t4)' }} /> : <ChevronDown size={12} style={{ color: 'var(--t4)' }} />)}
            </span>
          </div>
          {step?.at && <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{dateTime(step.at)}</div>}
          {open && hasDetail && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10, cursor: 'default' }}>
              {signals.length > 0 && <ChipList title="Key signals" color={C.green} items={signals} />}
              {objections.length > 0 && <ChipList title="Objections" color={C.red} items={objections} />}
              {step?.recording && <Recording url={step.recording} />}
              {step?.transcript && <Transcript text={step.transcript} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChipList({ title, color, items }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {items.map((s, i) => (
          <span key={i} style={{ fontSize: 11, color: 'var(--t2)', background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px' }}>{String(s)}</span>
        ))}
      </div>
    </div>
  )
}

function Transcript({ text }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Transcript</div>
      <div style={{
        maxHeight: 260, overflowY: 'auto', fontSize: 12, lineHeight: 1.65, color: 'var(--t2)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--surface-bg-2)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
      }}>{text}</div>
    </div>
  )
}

function Recording({ url }) {
  const [failed, setFailed] = useState(false)
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Recording</div>
      {failed ? (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>
          This recording is no longer available.{' '}
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: C.green }}>Try the original link</a>
        </div>
      ) : (
        <audio controls preload="metadata" src={url} onError={() => setFailed(true)} style={{ width: '100%', height: 36 }} />
      )}
    </div>
  )
}

// ─── Next action + prediction ─────────────────────────────────────────────────
const URGENCY = {
  live:     { variant: 'green', color: C.green, label: 'Live' },
  critical: { variant: 'red',   color: C.red,   label: 'Critical' },
  high:     { variant: 'amber', color: C.amber, label: 'High' },
  medium:   { variant: 'gold',  color: C.gold,  label: 'Medium' },
  low:      { variant: 'gray',  color: null,    label: 'Low' },
  none:     { variant: 'gray',  color: null,    label: 'None' },
}

function NextAction({ next }) {
  if (!next?.action) return null
  const u = URGENCY[next.urgency] || URGENCY.low
  return (
    <div style={{ ...cardStyle, borderRadius: 12, padding: '14px 16px', borderColor: u.color || 'var(--card-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Target size={13} style={{ color: u.color || 'var(--t3)' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Next action</span>
        <span style={{ marginLeft: 'auto' }}><Badge variant={u.variant}>{u.label}</Badge></span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 3 }}>{next.action}</div>
      {next.detail && <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5 }}>{next.detail}</div>}
    </div>
  )
}

function confColor(c) {
  if (c == null) return 'var(--t4)'
  if (c >= 75) return C.green
  if (c >= 55) return C.amber
  return 'var(--t3)'
}

const PREDICTION_LABELS = {
  motivation: 'Seller motivation', sells: 'Likely to sell', accepts_offer: 'Accepts our offer',
  under_contract: 'Gets under contract', closes: 'Deal closes', assignment_fee: 'Assignment fee',
  closing_date: 'Est. closing date', fallout_risk: 'Fallout risk',
}

function predictionValue(key, value) {
  if (value == null) return '—'
  if (key === 'assignment_fee' && typeof value === 'object') return value.suggested != null ? `$${Number(value.suggested).toLocaleString()}` : '—'
  if (key === 'closing_date') return String(value)
  return `${value}%`
}

function PredictionCard({ state }) {
  const p = state.data
  return (
    <Card>
      <SectionTitle icon={TrendingUp} color={C.green}
        right={p?.overall_confidence != null ? <span style={{ fontSize: 11, fontWeight: 700, color: confColor(p.overall_confidence) }}>{p.overall_confidence}% confidence</span> : null}>
        Deal prediction
      </SectionTitle>
      {state.error && <div style={{ fontSize: 12, color: 'var(--t3)' }}>{state.error}</div>}
      {!state.error && !p && <div style={{ fontSize: 12, color: 'var(--t4)' }}>Loading…</div>}
      {p && (
        <>
          {p.escalate && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12, color: C.amber, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> Low confidence — review before acting on this.
            </div>
          )}
          {p.best_next_action?.action && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{words(p.best_next_action.action)}</div>
              {p.best_next_action.reason && <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5, marginTop: 2 }}>{p.best_next_action.reason}</div>}
            </div>
          )}
          <InfoRows rows={[
            { label: 'Expected value', value: money(p.expected_value) },
            { label: 'Strategy', value: p.strategy?.primary ? `${words(p.strategy.primary)}${p.strategy.confidence != null ? ` (${p.strategy.confidence}%)` : ''}` : null },
            ...Object.entries(p.predictions || {}).map(([k, f]) => ({
              label: PREDICTION_LABELS[k] || words(k),
              value: predictionValue(k, f?.value),
              color: confColor(f?.confidence),
            })),
          ]} />
        </>
      )}
    </Card>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function MessagesTab({ lead, state, contact, composerRef, onSent }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef(null)
  const messages = Array.isArray(state.data) ? state.data : []
  const dnc = lead.is_on_dnc === true || lead.status === 'dnc'

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages.length])

  const send = async () => {
    const text = body.trim()
    if (!text || sending) return
    if (contact && contact.within_hours === false &&
      !window.confirm("It is outside 8am–9pm in this seller's time zone. Texting now may break calling-hours rules. Send anyway?")) return
    setSending(true)
    try {
      const res = await apiFetch('/sms/send', { method: 'POST', body: { lead_id: lead.id, message: text } })
      if (!res.message_id) {
        toast.error('Not sent. The number may be on the Do Not Call list or your outreach credits are used up.')
      } else {
        toast.success('Text sent')
        setBody('')
      }
      onSent()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={threadRef} style={{ maxHeight: 520, minHeight: 200, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.error && <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: 20 }}>{state.error}</div>}
        {!state.error && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--t4)', fontSize: 12 }}>No texts with this seller yet.</div>
        )}
        {messages.map((m, i) => {
          const out = m.direction === 'outbound'
          return (
            <div key={m.id || i} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '76%', padding: '9px 13px',
                background: out ? 'rgba(0,195,122,0.12)' : 'var(--surface-bg-2)',
                border: `1px solid ${out ? 'rgba(0,195,122,0.25)' : 'var(--border)'}`,
                borderRadius: out ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              }}>
                <p style={{ fontSize: 13, color: out ? C.green : 'var(--t1)', lineHeight: 1.45, margin: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{m.body}</p>
                <p style={{ fontSize: 10, color: 'var(--t4)', margin: '4px 0 0', textAlign: out ? 'right' : 'left' }}>
                  {dateTime(m.sent_at)}{m.status && m.status !== 'delivered' && m.status !== 'sent' ? ` · ${words(m.status)}` : ''}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
        {dnc ? (
          <div style={{ fontSize: 12, color: C.red, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ban size={13} /> This seller is on the Do Not Call list. Texting is disabled.
          </div>
        ) : (
          <>
            {contact && contact.within_hours === false && (
              <div style={{ fontSize: 11, color: C.amber, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={12} /> Outside 8am–9pm in the seller's time zone.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={composerRef} value={body} onChange={(e) => setBody(e.target.value)} rows={2}
                placeholder={`Text ${lead.first_name || 'the seller'}…`}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
                style={{
                  flex: 1, resize: 'vertical', minHeight: 44, background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                  borderRadius: 10, color: 'var(--input-text)', padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <Button variant="primary" size="sm" loading={sending} disabled={!body.trim()} onClick={send}>
                <Send size={12} /> Send
              </Button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 6 }}>Cmd/Ctrl + Enter to send. Sent texts are saved to this lead's history.</div>
          </>
        )}
      </div>
    </div>
  )
}

function CallsTab({ calls, onTakeover, onReturn, onEnd, busyCall, coaching }) {
  if (calls.length === 0) {
    return <Empty icon={PhoneCall} title="No calls with this seller yet" body="Start an AI call from the top of this profile. Each call's audio, transcript and AI summary will be saved here." />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {calls.map(c => <CallCard key={c.id} call={c} onTakeover={onTakeover} onReturn={onReturn} onEnd={onEnd} busy={busyCall === c.id} coaching={coaching[c.id]} />)}
    </div>
  )
}

function CallCard({ call, onTakeover, onReturn, onEnd, busy, coaching }) {
  const [open, setOpen] = useState(false)
  const live = isLiveStatus(call.status)
  const score = toScore(call.motivation_score)
  const signals = Array.isArray(call.key_signals) ? call.key_signals : []
  const objections = Array.isArray(call.objections) ? call.objections : []
  return (
    <div style={{ ...cardStyle, borderRadius: 12, padding: '13px 15px', borderColor: live ? C.green : 'var(--card-border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <Badge variant="gray">{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}</Badge>
            {live && <Badge variant="green" dot>Live now</Badge>}
            {call.outcome && <Badge variant={['verbal_yes', 'appointment', 'offer_made'].includes(call.outcome) ? 'green' : call.outcome === 'not_interested' ? 'red' : 'gold'}>{words(call.outcome)}</Badge>}
            {call.operator_took_over && <Badge variant="amber">Operator took over</Badge>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>
            {dateTime(call.started_at || call.created_at)}{duration(call.duration_seconds) ? ` · ${duration(call.duration_seconds)}` : ''}{!live && call.status ? ` · ${words(call.status)}` : ''}
          </div>
        </div>
        {score != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: scoreColor(score), lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{score}</div>
            <div style={{ fontSize: 9, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>Motivation</div>
          </div>
        )}
      </div>

      {live && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {call.operator_took_over ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => onReturn(call)}><Brain size={12} /> Hand back to AI</Button>
          ) : (
            <Button variant="primary" size="sm" loading={busy} onClick={() => onTakeover(call)}><Headphones size={12} /> Take over call</Button>
          )}
          <Button variant="danger" size="sm" disabled={busy} onClick={() => onEnd(call)}><PhoneOff size={12} /> End call</Button>
          <Link to="/monitor" style={{ fontSize: 12, color: C.green, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'center' }}>
            Listen in Live Calls <ExternalLink size={11} />
          </Link>
        </div>
      )}

      {coaching && (Array.isArray(coaching.suggestions) && coaching.suggestions.length > 0) && (
        <div style={{ marginTop: 12, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Coaching for this call</div>
          {coaching.suggestions.map((s, i) => <div key={i} style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>· {typeof s === 'string' ? s : JSON.stringify(s)}</div>)}
        </div>
      )}

      {call.ai_summary && <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, marginTop: 10 }}>{call.ai_summary}</div>}

      {(call.recording_url || call.transcript || signals.length > 0 || objections.length > 0) && (
        <>
          <button onClick={() => setOpen(o => !o)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.green, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {open ? 'Hide' : 'Show'} {[call.recording_url && 'audio', call.transcript && 'transcript', (signals.length || objections.length) && 'signals'].filter(Boolean).join(', ')}
          </button>
          {open && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {call.recording_url && <Recording url={call.recording_url} />}
              {signals.length > 0 && <ChipList title="Key signals" color={C.green} items={signals} />}
              {objections.length > 0 && <ChipList title="Objections" color={C.red} items={objections} />}
              {call.transcript && <Transcript text={call.transcript} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PhotosTab({ photos, imagery, onRequest, requesting, dnc }) {
  const list = Array.isArray(photos.data) ? photos.data : []
  const img = imagery.data
  const hasImagery = img?.available && (img.satellite_url || img.street_view_url)
  if (list.length === 0 && !hasImagery) {
    return (
      <Empty icon={ImageIcon} title="No photos of this property yet"
        body="Ask the seller for photos. Anything they upload or text in lands here automatically."
        action={!dnc && <Button variant="primary" size="sm" loading={requesting} onClick={onRequest}><Camera size={12} /> Request photos</Button>} />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {hasImagery && (
        <Card>
          <SectionTitle icon={MapPin}>Property imagery</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {img.satellite_url && <Figure label="Aerial" src={img.satellite_url} />}
            {img.street_view_url && <Figure label="Street view" src={img.street_view_url} />}
          </div>
        </Card>
      )}
      <Card>
        <SectionTitle icon={Camera} right={!dnc && <Button variant="secondary" size="sm" loading={requesting} onClick={onRequest}>Request more</Button>}>
          Seller photos ({list.length})
        </SectionTitle>
        {photos.error && <div style={{ fontSize: 12, color: 'var(--t3)' }}>{photos.error}</div>}
        {list.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--t4)' }}>The seller hasn't sent any photos yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {list.map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                <img src={p.url} alt={p.file_name || 'Seller photo'} loading="lazy"
                  style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 4 }}>
                  {p.source === 'sms_mms' ? 'Texted in' : 'Uploaded'} · {dateTime(p.created_at)}
                </div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Figure({ label, src }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <img src={src} alt={`${label} of the property`} onError={() => setHidden(true)}
        style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }} />
    </div>
  )
}

function DocumentsTab({ timeline }) {
  const docs = (Array.isArray(timeline.data) ? timeline.data : []).filter(e => e?.type === 'document')
  if (timeline.error) return <Empty icon={FileText} title="Documents could not be loaded" body={timeline.error} />
  if (docs.length === 0) return <Empty icon={FileText} title="No documents yet" body="Contracts sent to or signed by this seller will appear here." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {docs.map((d, i) => {
        const signed = d.meta?.signing_status === 'fully_signed' || !!d.meta?.fully_signed_at
        return (
          <div key={i} style={{ ...cardStyle, borderRadius: 12, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <FileText size={16} style={{ color: signed ? C.green : C.gold, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{words(d.meta?.contract_type) || 'Contract'}</div>
              <div style={{ fontSize: 11, color: 'var(--t4)', marginTop: 2 }}>
                {d.meta?.sent_at ? `Sent ${dateTime(d.meta.sent_at)}` : `Created ${dateTime(d.at)}`}
                {d.meta?.fully_signed_at ? ` · Signed ${dateTime(d.meta.fully_signed_at)}` : ''}
              </div>
            </div>
            <Badge variant={signed ? 'green' : 'gold'}>{words(d.meta?.signing_status) || 'draft'}</Badge>
          </div>
        )
      })}
    </div>
  )
}

function DealTab({ deals }) {
  if (deals.length === 0) return <Empty icon={Briefcase} title="No deal for this seller yet" body="When an offer turns into a deal, its price, fee, stage and closing details will show here." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {deals.map(d => (
        <Card key={d.id}>
          <SectionTitle icon={Briefcase} right={
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {d.status && <Badge variant="gold">{words(d.status)}</Badge>}
              <Link to={`/deals/${d.id}`} style={{ fontSize: 12, color: C.green, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>Open deal <ExternalLink size={11} /></Link>
            </span>
          }>
            {d.property_address || 'Deal'}
          </SectionTitle>
          <InfoRows rows={[
            { label: 'Offer price', value: money(d.offer_price) },
            { label: 'Seller agreed', value: money(d.seller_agreed_price) },
            { label: 'Buyer price', value: money(d.buyer_price) },
            { label: 'Assignment fee', value: money(d.assignment_fee), color: C.green },
            { label: 'ARV', value: money(d.arv) },
            { label: 'Repairs', value: money(d.repair_estimate) },
            { label: 'MAO', value: money(d.mao) },
            { label: 'Strategy', value: words(d.deal_type) },
            { label: 'Contract', value: words(d.contract_status) },
            { label: 'Earnest money', value: d.emd_status ? `${words(d.emd_status)}${money(d.emd_amount) ? ` · ${money(d.emd_amount)}` : ''}` : null },
            { label: 'Closing date', value: d.closing_date ? new Date(d.closing_date).toLocaleDateString() : null },
            { label: 'Risk', value: words(d.risk_level) },
          ]} />
        </Card>
      ))}
    </div>
  )
}

function NotesTab({ lead, onSaved }) {
  const [notes, setNotes] = useState(lead.notes || '')
  const [instructions, setInstructions] = useState(lead.ai_instructions || '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingAi, setSavingAi] = useState(false)

  useEffect(() => { setNotes(lead.notes || '') }, [lead.id, lead.notes])
  useEffect(() => { setInstructions(lead.ai_instructions || '') }, [lead.id, lead.ai_instructions])

  const save = async (field, value, setBusy, okMsg) => {
    setBusy(true)
    try {
      await apiFetch(`/leads/${lead.id}`, { method: 'PUT', body: { [field]: value } })
      toast.success(okMsg)
      onSaved()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const area = {
    width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--input-bg)',
    border: '1px solid var(--input-border)', borderRadius: 10, color: 'var(--input-text)',
    padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', lineHeight: 1.55,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <SectionTitle icon={Brain} color={C.gold}>Instructions for the AI</SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 10px', lineHeight: 1.55 }}>
          The AI voice agent reads this before every call with this seller. Use it to correct how the AI handles them,
          for example "Speak with her son Mike, not her" or "Don't offer below $180k".
        </p>
        <textarea value={instructions} maxLength={2000} rows={4} onChange={(e) => setInstructions(e.target.value)} style={area}
          placeholder="Tell the AI how to handle this seller…" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--t4)' }}>{instructions.length}/2000</span>
          <Button variant="primary" size="sm" loading={savingAi} disabled={instructions === (lead.ai_instructions || '')}
            onClick={() => save('ai_instructions', instructions, setSavingAi, 'AI instructions saved')}>
            Save instructions
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={StickyNote} color={C.gold}>Team notes</SectionTitle>
        <textarea value={notes} rows={6} onChange={(e) => setNotes(e.target.value)} style={area}
          placeholder="Anything the team should know about this seller…" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="secondary" size="sm" loading={savingNotes} disabled={notes === (lead.notes || '')}
            onClick={() => save('notes', notes, setSavingNotes, 'Notes saved')}>
            Save notes
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────
const PAGE_CSS = `
@keyframes vpPing { 0% { transform: scale(1); opacity: .7 } 70%, 100% { transform: scale(1.5); opacity: 0 } }
@keyframes vpSpin { to { transform: rotate(360deg) } }
.vp-ping { animation: vpPing 1.4s ease-out infinite; }
.vp-spin { animation: vpSpin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .vp-ping, .vp-spin { animation: none !important; } }
`

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100%', background: 'var(--app-bg)', color: 'var(--t1)' }}>
      <style>{PAGE_CSS}</style>
      {children}
    </div>
  )
}

function Centered({ children }) {
  return (
    <Shell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '90px 24px', textAlign: 'center' }}>{children}</div>
    </Shell>
  )
}

const blank = { data: null, error: null }
async function settle(promise, pick) {
  try { return { data: pick(await promise), error: null } }
  catch (e) { return { data: null, error: e?.message || 'Could not load this section.' } }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function VeoriIntelligence() {
  const { id: leadId } = useParams()
  const navigate = useNavigate()
  const composerRef = useRef(null)

  const [intel, setIntel]           = useState(blank)
  const [detail, setDetail]         = useState(blank)
  const [messages, setMessages]     = useState(blank)
  const [photos, setPhotos]         = useState(blank)
  const [imagery, setImagery]       = useState(blank)
  const [prediction, setPrediction] = useState(blank)
  const [timeline, setTimeline]     = useState(blank)
  const [loading, setLoading]       = useState(true)
  const [busy, setBusy]             = useState(false)
  const [tab, setTab]               = useState('activity')
  const [action, setAction]         = useState(null)
  const [busyCall, setBusyCall]     = useState(null)
  const [coaching, setCoaching]     = useState({})
  const [copied, setCopied]         = useState(false)

  // Fast data — reloaded on the 20s refresh as well.
  const loadLive = useCallback(async () => {
    if (!leadId) return
    const [i, d, m] = await Promise.all([
      settle(apiFetch(`/leads/${leadId}/intelligence`), j => j.data || null),
      settle(apiFetch(`/leads/${leadId}`), j => j.data || null),
      settle(apiFetch(`/sms/conversation/${leadId}`), j => (Array.isArray(j.data) ? j.data : [])),
    ])
    setIntel(i); setDetail(d); setMessages(m)
  }, [leadId])

  // Heavier data — loaded on open and on manual refresh only. The prediction route
  // writes an audit row on every request, so it must not be polled.
  const loadStatic = useCallback(async () => {
    if (!leadId) return
    const [p, im, pr, t] = await Promise.all([
      settle(apiFetch(`/leads/${leadId}/photos`), j => (Array.isArray(j.photos) ? j.photos : [])),
      settle(apiFetch(`/leads/${leadId}/imagery`), j => j.imagery || null),
      settle(apiFetch(`/leads/${leadId}/prediction`), j => j.data || null),
      settle(apiFetch(`/leads/${leadId}/timeline`), j => (Array.isArray(j.timeline) ? j.timeline : [])),
    ])
    setPhotos(p); setImagery(im); setPrediction(pr); setTimeline(t)
  }, [leadId])

  const refreshAll = useCallback(async (silent = false) => {
    silent ? setBusy(true) : setLoading(true)
    await Promise.all([loadLive(), loadStatic()])
    setLoading(false); setBusy(false)
  }, [loadLive, loadStatic])

  useEffect(() => {
    if (!leadId) { setLoading(false); return undefined }
    refreshAll()
    const t = setInterval(() => { loadLive() }, 20000)
    return () => clearInterval(t)
  }, [leadId, refreshAll, loadLive])

  if (!leadId) return <LeadPicker />

  if (loading) return (
    <Centered>
      <Loader2 size={28} className="vp-spin" style={{ color: C.green }} />
      <div style={{ color: 'var(--t3)', fontSize: 14 }}>Loading this seller's profile…</div>
    </Centered>
  )

  if (intel.error || !intel.data) return (
    <Centered>
      <AlertTriangle size={28} style={{ color: C.amber }} />
      <div style={{ color: 'var(--t2)', fontSize: 14, maxWidth: 380 }}>{intel.error || 'This profile could not be loaded.'}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={() => refreshAll()}>Try again</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads')}>Back to leads</Button>
      </div>
    </Centered>
  )

  const data   = intel.data
  const lead   = { ...(data.lead || {}), ...(detail.data || {}) }
  const pmi    = data.pmi || {}
  const chain  = Array.isArray(data.agentChain) ? data.agentChain : []
  const counts = data.counts || {}
  const contact = data.contact || null
  const calls  = (Array.isArray(detail.data?.calls) ? detail.data.calls : [])
    .slice().sort((a, b) => new Date(b.started_at || b.created_at || 0) - new Date(a.started_at || a.created_at || 0))
  const deals  = Array.isArray(detail.data?.deals) ? detail.data.deals : []
  const liveCall = calls.find(c => isLiveStatus(c.status)) || null
  const photoCount = (Array.isArray(photos.data) ? photos.data.length : 0)
  const docCount = (Array.isArray(timeline.data) ? timeline.data.filter(e => e?.type === 'document').length : 0)
  const msgCount = (Array.isArray(messages.data) ? messages.data.length : 0)

  const overall = toScore(pmi.overall?.value)
  const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unnamed lead'
  const dnc = lead.is_on_dnc === true || lead.status === 'dnc'

  let localTime = null
  if (contact?.timezone) {
    try { localTime = new Date().toLocaleTimeString([], { timeZone: contact.timezone, hour: 'numeric', minute: '2-digit' }) } catch { localTime = null }
  }

  const run = async (key, fn, okMsg) => {
    setAction(key)
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
      await loadLive()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setAction(null)
    }
  }

  const outsideHoursOk = (what) => contact?.within_hours !== false ||
    window.confirm(`It is outside 8am–9pm in this seller's time zone. ${what} now may break calling-hours rules. Continue?`)

  const startCall = () => { if (outsideHoursOk('Calling')) run('call', () => apiFetch('/calls/initiate', { method: 'POST', body: { lead_id: lead.id } }), 'AI call started') }
  const voicemail = () => { if (outsideHoursOk('A voicemail')) run('vm', () => apiFetch(`/leads/${lead.id}/voicemail`, { method: 'POST', body: { template: 'first_contact' } }), 'Voicemail sent') }
  const requestPhotos = () => run('photos', async () => { await apiFetch(`/leads/${lead.id}/send-photo-request`, { method: 'POST' }); await loadStatic() }, 'Photo request sent')
  const skipTrace = () => run('trace', () => apiFetch(`/leads/${lead.id}/skip-trace`, { method: 'POST' }), 'Skip trace started')
  const markDnc = () => {
    if (!window.confirm(`Add ${name} to the Do Not Call list? The AI will stop all texts and calls to this number.`)) return
    run('dnc', () => apiFetch(`/leads/${lead.id}/dnc`, { method: 'POST', body: { reason: 'Marked from lead profile' } }), 'Added to Do Not Call list')
  }
  const resolveReview = () => run('review', () => apiFetch(`/leads/${lead.id}/resolve-review`, { method: 'POST' }), 'Marked as reviewed')

  const takeover = async (call) => {
    setBusyCall(call.id)
    try {
      const res = await apiFetch('/calls/takeover', { method: 'POST', body: { call_id: call.id } })
      setCoaching(prev => ({ ...prev, [call.id]: res.coaching || null }))
      toast.success('You have taken over the call')
      await loadLive()
    } catch (e) { toast.error(e.message) } finally { setBusyCall(null) }
  }
  const handBack = async (call) => {
    setBusyCall(call.id)
    try {
      await apiFetch('/calls/return-to-ai', { method: 'POST', body: { call_id: call.id } })
      toast.success('The AI is back in control of the call')
      await loadLive()
    } catch (e) { toast.error(e.message) } finally { setBusyCall(null) }
  }
  const endCall = async (call) => {
    if (!window.confirm('End this call now?')) return
    setBusyCall(call.id)
    try {
      await apiFetch(`/calls/${call.id}/end`, { method: 'POST' })
      toast.success('Call ended')
      await loadLive()
    } catch (e) { toast.error(e.message) } finally { setBusyCall(null) }
  }

  const copyPhone = () => {
    if (!lead.phone) return
    navigator.clipboard?.writeText(lead.phone).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  const TABS = [
    { id: 'activity',  label: 'AI activity', count: chain.length,  icon: Activity },
    { id: 'messages',  label: 'Messages',    count: msgCount,      icon: MessageSquare },
    { id: 'calls',     label: 'Calls',       count: calls.length,  icon: PhoneCall },
    { id: 'photos',    label: 'Photos',      count: photoCount,    icon: Camera },
    { id: 'documents', label: 'Documents',   count: docCount,      icon: FileText },
    { id: 'deal',      label: 'Deal',        count: deals.length,  icon: Briefcase },
    { id: 'notes',     label: 'Notes & AI',  count: null,          icon: StickyNote },
  ]

  return (
    <Shell>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--app-bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '14px 24px 10px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '3px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit' }}>
            <ArrowLeft size={15} /> Back
          </button>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-0.02em' }}>{name}</span>
              {overall != null && overall >= 70 && <Badge variant="green">Hot</Badge>}
              {lead.status && <Badge variant="gray">{words(lead.status)}</Badge>}
              {dnc && <Badge variant="red">Do not call</Badge>}
              {lead.needs_human_review && <Badge variant="amber">Needs review</Badge>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
              {lead.property_address && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--t3)' }}>
                  <MapPin size={11} style={{ color: 'var(--t4)' }} />
                  {[lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ')}
                </span>
              )}
              {lead.phone && (
                <button onClick={copyPhone} title="Copy phone number" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--t3)', fontFamily: 'inherit' }}>
                  <Phone size={11} style={{ color: 'var(--t4)' }} /> {lead.phone} {copied ? <Check size={11} style={{ color: C.green }} /> : <Copy size={11} style={{ color: 'var(--t4)' }} />}
                </button>
              )}
              {localTime && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: contact.within_hours ? C.green : C.amber }}>
                  <Clock size={11} /> {localTime} seller's time · {contact.within_hours ? 'inside calling hours' : 'outside calling hours'}
                </span>
              )}
            </div>
          </div>

          <Button variant="secondary" size="sm" loading={busy} onClick={() => refreshAll(true)}><RefreshCw size={12} /> Refresh</Button>
        </div>

        {/* Operator actions */}
        <div style={{ padding: '0 24px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" size="sm" disabled={dnc} onClick={() => { setTab('messages'); setTimeout(() => composerRef.current?.focus(), 60) }}>
            <MessageSquare size={12} /> Text seller
          </Button>
          <Button variant="secondary" size="sm" disabled={dnc || !!liveCall} loading={action === 'call'} onClick={startCall}>
            <PhoneCall size={12} /> {liveCall ? 'Call in progress' : 'Start AI call'}
          </Button>
          <Button variant="secondary" size="sm" disabled={dnc} loading={action === 'vm'} onClick={voicemail}><Mic size={12} /> Drop voicemail</Button>
          <Button variant="secondary" size="sm" disabled={dnc} loading={action === 'photos'} onClick={requestPhotos}><Camera size={12} /> Request photos</Button>
          <Button variant="secondary" size="sm" loading={action === 'trace'} onClick={skipTrace}><Search size={12} /> Skip trace</Button>
          {!dnc && <Button variant="danger" size="sm" loading={action === 'dnc'} onClick={markDnc}><Ban size={12} /> Do not call</Button>}
        </div>
      </div>

      {/* ── Banners ────────────────────────────────────────────────────────── */}
      {(liveCall || lead.needs_human_review) && (
        <div style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 1360, margin: '0 auto' }}>
          {liveCall && (
            <div style={{ ...cardStyle, borderColor: C.green, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ position: 'relative', display: 'inline-flex', width: 10, height: 10 }}>
                <span className="vp-ping" style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${C.green}` }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.green }} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', flex: 1, minWidth: 200 }}>
                {liveCall.operator_took_over ? 'You are on a live call with this seller.' : 'The AI is on a live call with this seller right now.'}
              </span>
              {liveCall.operator_took_over
                ? <Button variant="secondary" size="sm" loading={busyCall === liveCall.id} onClick={() => handBack(liveCall)}><Brain size={12} /> Hand back to AI</Button>
                : <Button variant="primary" size="sm" loading={busyCall === liveCall.id} onClick={() => takeover(liveCall)}><Headphones size={12} /> Take over</Button>}
              <Button variant="danger" size="sm" disabled={busyCall === liveCall.id} onClick={() => endCall(liveCall)}><PhoneOff size={12} /> End call</Button>
            </div>
          )}
          {lead.needs_human_review && (
            <div style={{ ...cardStyle, borderColor: C.amber, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <AlertTriangle size={15} style={{ color: C.amber, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--t2)', flex: 1, minWidth: 200 }}>
                <b style={{ color: 'var(--t1)' }}>The AI flagged this seller for a person to review.</b>{lead.human_review_reason ? ` ${lead.human_review_reason}` : ''}
              </span>
              <Button variant="secondary" size="sm" loading={action === 'review'} onClick={resolveReview}><UserCheck size={12} /> Mark reviewed</Button>
            </div>
          )}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: 24, alignItems: 'flex-start', maxWidth: 1360, margin: '0 auto' }}>
        {/* Left: what we know about this seller */}
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Card>
            <SectionTitle icon={Brain}>Motivation</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
              <ScoreRing score={overall} size={96} />
              {pmi.overall?.basis && <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>{pmi.overall.basis}</div>}
            </div>
            <PMIBar label="Distress"   metric={pmi.distress}   color={C.red}   icon={Flame}      delay={0} />
            <PMIBar label="Urgency"    metric={pmi.urgency}    color={C.amber} icon={Zap}        delay={100} />
            <PMIBar label="Engagement" metric={pmi.engagement} color={C.gold}  icon={Activity}   delay={200} />
            <PMIBar label="Equity"     metric={pmi.equity}     color={C.green} icon={DollarSign} delay={300} />
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <StatTile label="Calls" value={counts.calls ?? calls.length} />
            <StatTile label="Texts" value={counts.sms ?? msgCount} />
            <StatTile label="Est. value" value={money(lead.estimated_value) || '—'} />
            <StatTile label="Est. equity" value={money(lead.estimated_equity) || '—'} />
          </div>

          <NextAction next={data.nextAction} />
          <PredictionCard state={prediction} />

          <Card>
            <SectionTitle icon={Home}>Property &amp; equity</SectionTitle>
            <InfoRows rows={[
              { label: 'Type', value: words(lead.property_type) },
              { label: 'County', value: lead.county },
              { label: 'Parcel', value: lead.parcel_id },
              { label: 'Est. value', value: money(lead.estimated_value) },
              { label: 'Est. equity', value: money(lead.estimated_equity), color: C.green },
              { label: 'ARV', value: money(lead.estimated_arv) },
              { label: 'Mortgage balance', value: money(lead.mortgage_balance) },
              { label: 'Monthly payment', value: money(lead.est_monthly_payment) },
              { label: 'Interest rate', value: pct(lead.interest_rate) },
              { label: 'Loan type', value: words(lead.loan_type) },
              { label: 'Arrears', value: money(lead.arrears_amount), color: C.red },
              { label: 'Taxes owed', value: money(lead.tax_owed), color: C.red },
              { label: 'Years delinquent', value: lead.years_delinquent },
              { label: 'Foreclosure', value: words(lead.foreclosure_stage), color: C.red },
              { label: 'Probate case', value: lead.probate_case },
              { label: 'Lis pendens', value: lead.has_lis_pendens === true ? 'Yes' : null },
              { label: 'Deed type', value: words(lead.deed_type) },
              { label: 'Years owned', value: lead.years_owned },
              { label: 'Absentee owner', value: lead.is_absentee_owner === true ? 'Yes' : null },
              { label: 'Vacant', value: lead.is_vacant === true ? 'Yes' : null },
              { label: 'Owner-occupied', value: lead.owner_occupied === true ? 'Yes' : lead.owner_occupied === false ? 'No' : null },
              { label: 'Properties owned', value: lead.owner_property_count },
            ]} />
          </Card>

          <Card>
            <SectionTitle icon={User}>Seller</SectionTitle>
            <InfoRows rows={[
              { label: 'Personality', value: lead.seller_personality },
              { label: 'Situation', value: words(lead.primary_tag) },
              { label: 'Other tags', value: [...(Array.isArray(lead.secondary_tags) ? lead.secondary_tags : []), ...(Array.isArray(lead.tags) ? lead.tags : [])].map(words).filter(Boolean).join(', ') || null },
              { label: 'Distress signals', value: Array.isArray(lead.distress_signals) ? lead.distress_signals.map(words).join(', ') : (typeof lead.distress_signals === 'string' ? lead.distress_signals : null) },
              { label: 'Best strategy', value: lead.detected_strategy ? `${words(lead.strategy_override || lead.detected_strategy)}${lead.strategy_confidence != null ? ` (${lead.strategy_confidence}%)` : ''}` : null },
              { label: 'Timeline', value: lead.seller_timeline_days != null ? `${lead.seller_timeline_days} days${lead.seller_timeline_note ? ` · ${lead.seller_timeline_note}` : ''}` : lead.seller_timeline_note },
              { label: 'Language', value: lead.preferred_language },
              { label: 'Email', value: lead.email },
              { label: 'Lead source', value: words(lead.source || lead.sourcing_source) },
              { label: 'Added', value: lead.created_at ? new Date(lead.created_at).toLocaleDateString() : null },
            ]} />
          </Card>

          <Card>
            <SectionTitle icon={ShieldCheck} color={C.green}>Consent &amp; compliance</SectionTitle>
            <InfoRows rows={[
              { label: 'Consent on file', value: lead.consent ? 'Yes' : 'No', color: lead.consent ? C.green : C.amber },
              { label: 'Consent source', value: words(lead.consent_source) },
              { label: 'Consent date', value: lead.consent_at ? new Date(lead.consent_at).toLocaleDateString() : null },
              { label: 'Do not call', value: dnc ? 'Yes' : 'No', color: dnc ? C.red : 'var(--t2)' },
              { label: "Seller's time zone", value: contact?.timezone || null },
              { label: 'Calls placed', value: lead.call_count ?? calls.length },
              { label: 'Last call outcome', value: words(lead.last_call_outcome) },
              { label: 'Last call', value: lead.last_call_date ? new Date(lead.last_call_date).toLocaleDateString() : null },
            ]} />
          </Card>
        </div>

        {/* Right: everything that has happened, and the tools to act */}
        <div style={{ flex: '999 1 460px', minWidth: 0 }}>
          <div role="tablist" style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            {TABS.map(t => {
              const active = tab === t.id
              const Icon = t.icon
              return (
                <button key={t.id} role="tab" aria-selected={active} onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', padding: '10px 12px', marginBottom: -1,
                    background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.green : 'transparent'}`,
                    color: active ? 'var(--t1)' : 'var(--t3)', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <Icon size={13} style={{ color: active ? C.green : 'var(--t4)' }} />
                  {t.label}
                  {t.count != null && <span style={{ fontSize: 11, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>}
                </button>
              )
            })}
          </div>

          {tab === 'activity' && (
            chain.length === 0
              ? <Empty icon={Activity} title="No activity with this seller yet" body="Add them to a campaign, text them, or start an AI call. Every step the AI takes will appear here in order." />
              : chain.map((step, i) => <AgentStep key={step?.id || i} step={step} isLast={i === chain.length - 1} />)
          )}
          {tab === 'messages' && <MessagesTab lead={lead} state={messages} contact={contact} composerRef={composerRef} onSent={loadLive} />}
          {tab === 'calls' && <CallsTab calls={calls} onTakeover={takeover} onReturn={handBack} onEnd={endCall} busyCall={busyCall} coaching={coaching} />}
          {tab === 'photos' && <PhotosTab photos={photos} imagery={imagery} onRequest={requestPhotos} requesting={action === 'photos'} dnc={dnc} />}
          {tab === 'documents' && <DocumentsTab timeline={timeline} />}
          {tab === 'deal' && <DealTab deals={deals} />}
          {tab === 'notes' && <NotesTab lead={lead} onSaved={loadLive} />}
        </div>
      </div>
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
    apiFetch('/leads?limit=100')
      .then(d => { if (!cancelled) setLeads(Array.isArray(d.data) ? d.data : []) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = leads.filter(l => `${l?.first_name || ''} ${l?.last_name || ''} ${l?.property_address || ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <Shell>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '30px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <Brain size={19} style={{ color: C.green }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', margin: 0, letterSpacing: '-0.02em' }}>AI Activity</h1>
        </div>
        <p style={{ color: 'var(--t3)', fontSize: 14, margin: '0 0 20px' }}>Open a seller's profile to see everything about them and what the AI has done.</p>
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or address"
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 10, color: 'var(--input-text)', padding: '11px 14px 11px 34px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }} />
        </div>
        {loading && <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>Loading leads…</div>}
        {error && !loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--t3)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {!loading && !error && filtered.slice(0, 50).map(l => (
            <button key={l.id} onClick={() => navigate(`/intelligence/lead/${l.id}`)}
              style={{ ...cardStyle, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--t1)' }}>{`${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unnamed lead'}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--t4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.property_address || '—'}</span>
              </span>
              <ScoreRing score={l.motivation_score} size={40} />
            </button>
          ))}
          {!loading && !error && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>No leads match that search.</div>}
        </div>
      </div>
    </Shell>
  )
}
