/**
 * AI Activity — one seller's profile: every text, call and AI decision for THIS
 * lead only. Nothing from any other lead appears here.
 *
 * Built to the platform's existing conventions rather than its own:
 *   • Score = uppercase label + large number + thin bar (as in the Leads drawer).
 *   • Palette = green #00C37A / amber #FF9500 / red #FF4444 / gold #C9A84C only.
 *     No blue — the shared Badge component deliberately maps its legacy `blue`
 *     variant to green, so blue is not part of this product's language.
 *   • Chips and buttons use the shared Badge and Button components.
 *   • Surfaces and text use the theme tokens, so light and dark both work.
 *
 * Every field from the API is defaulted before render, so a partial or failed
 * response shows an error state instead of crashing into the ErrorBoundary.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Brain, Zap, Phone, MessageSquare, FileText, Calendar,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle,
  Clock, CheckCircle2, Circle, Loader2, Activity, TrendingUp,
  Target, Flame, DollarSign, MapPin, User, Radio, Search,
} from 'lucide-react'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

const API = (import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app')
  .replace(/\/+$/, '').replace(/\/api$/, '') + '/api'

function authHeaders() {
  const t = localStorage.getItem('veori_token') || localStorage.getItem('token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// The platform palette — identical values to Leads.jsx and Badge.jsx.
const C = { green: '#00C37A', amber: '#FF9500', red: '#FF4444', gold: '#C9A84C' }

// Same thresholds and colours as Leads.jsx scoreColor().
function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return C.green
  if (s >= 40) return C.amber
  return C.red
}

function toScore(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)))
}

const LABEL = {
  fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--t4)', margin: '0 0 4px',
}
const SECTION = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--t3)',
}

// ─── Score block — the Leads-drawer treatment ─────────────────────────────────
function ScoreBlock({ score, basis }) {
  const s = toScore(score)
  const color = scoreColor(s)
  return (
    <div>
      <p style={LABEL}>Motivation score</p>
      <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
        {s != null ? s : '-'}
      </p>
      <div style={{ width: 60, height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
        {s != null && (
          <div style={{ width: `${s}%`, height: '100%', background: color, borderRadius: 2, boxShadow: `0 0 6px ${color}80` }} />
        )}
      </div>
      {basis && <p style={{ fontSize: 10, color: 'var(--t4)', margin: '6px 0 0', maxWidth: 220, lineHeight: 1.45 }}>{basis}</p>}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p style={LABEL}>{label}</p>
      <p style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: 'var(--t1)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
        {value}
      </p>
    </div>
  )
}

// ─── Motivation breakdown row ─────────────────────────────────────────────────
const CONF_TEXT = { measured: 'measured', derived: 'derived', low: 'weak signal', none: 'no data' }

function BreakdownRow({ label, metric, color, icon: Icon }) {
  const v = toScore(metric?.value)
  const known = v != null
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <Icon size={12} style={{ color: known ? color : 'var(--t4)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'var(--t4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {CONF_TEXT[metric?.confidence] || CONF_TEXT.none}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: known ? color : 'var(--t4)', fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right' }}>
            {known ? v : '-'}
          </span>
        </span>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        {known && (
          <div style={{ width: `${v}%`, height: '100%', background: color, borderRadius: 2, boxShadow: `0 0 6px ${color}80`, transition: 'width 0.6s var(--ease-smooth)' }} />
        )}
      </div>
      {metric?.basis && (
        <p style={{ fontSize: 10, color: 'var(--t4)', margin: '6px 0 0', lineHeight: 1.45 }}>{metric.basis}</p>
      )}
    </div>
  )
}

// ─── Activity step ────────────────────────────────────────────────────────────
// Icon colour + Badge variant per step type, platform palette only.
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

function statusIcon(status) {
  if (status === 'active')    return { Icon: Radio,         color: C.green }
  if (status === 'failed')    return { Icon: AlertTriangle, color: C.red }
  if (status === 'completed') return { Icon: CheckCircle2,  color: 'var(--t4)' }
  return { Icon: Circle, color: 'var(--t4)' }
}

function timeStr(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function Step({ step, isLast }) {
  const [open, setOpen] = useState(false)
  const meta = STEP[step?.icon] || STEP.activity
  const st = statusIcon(step?.status)
  const signals    = Array.isArray(step?.signals) ? step.signals : []
  const objections = Array.isArray(step?.objections) ? step.objections : []
  const hasDetail  = !!step?.transcript || signals.length > 0 || objections.length > 0
  const isLive     = step?.status === 'active'
  const StepIcon = meta.Icon
  const StatusIcon = st.Icon

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 30, flexShrink: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0, position: 'relative',
          background: 'var(--surface-bg-2)',
          border: `1px solid ${isLive ? C.green : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <StepIcon size={13} style={{ color: meta.color }} />
          {isLive && (
            <span className="veori-live-ring" style={{
              position: 'absolute', inset: -3, borderRadius: 10, border: `1px solid ${C.green}`,
            }} />
          )}
        </div>
        {!isLast && <div style={{ width: 1, flex: 1, minHeight: 16, background: 'var(--border)', marginTop: 4 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
        <div
          onClick={() => hasDetail && setOpen(o => !o)}
          role={hasDetail ? 'button' : undefined}
          tabIndex={hasDetail ? 0 : undefined}
          onKeyDown={(e) => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(o => !o) } }}
          style={{
            background: 'var(--card-bg)',
            border: `1px solid ${isLive ? C.green : 'var(--card-border)'}`,
            borderRadius: 10, padding: '11px 13px',
            cursor: hasDetail ? 'pointer' : 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                <Badge variant={meta.badge}>{step?.agent || 'System'}</Badge>
                {isLive && <Badge variant="green" dot>Live</Badge>}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>
                {step?.action || 'Activity'}
              </div>
              {step?.detail && (
                <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, wordBreak: 'break-word' }}>{step.detail}</div>
              )}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <StatusIcon size={13} style={{ color: st.color }} />
              {hasDetail && (open
                ? <ChevronUp size={12} style={{ color: 'var(--t4)' }} />
                : <ChevronDown size={12} style={{ color: 'var(--t4)' }} />)}
            </span>
          </div>

          {step?.at && (
            <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{timeStr(step.at)}</div>
          )}

          {open && hasDetail && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signals.length > 0 && (
                <div>
                  <p style={{ ...LABEL, color: C.green }}>Key signals</p>
                  {signals.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>· {String(s)}</div>
                  ))}
                </div>
              )}
              {objections.length > 0 && (
                <div>
                  <p style={{ ...LABEL, color: C.red }}>Objections</p>
                  {objections.map((o, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>· {String(o)}</div>
                  ))}
                </div>
              )}
              {step?.transcript && (
                <div>
                  <p style={{ ...LABEL, color: C.gold }}>Transcript</p>
                  <div style={{
                    maxHeight: 240, overflowY: 'auto', fontSize: 12, lineHeight: 1.65,
                    color: 'var(--t2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px',
                  }}>
                    {step.transcript}
                  </div>
                </div>
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
  live:     { variant: 'green', border: C.green, label: 'Live' },
  critical: { variant: 'red',   border: C.red,   label: 'Critical' },
  high:     { variant: 'amber', border: C.amber, label: 'High' },
  medium:   { variant: 'gold',  border: C.gold,  label: 'Medium' },
  low:      { variant: 'gray',  border: null,    label: 'Low' },
  none:     { variant: 'gray',  border: null,    label: 'None' },
}

function NextAction({ next }) {
  if (!next || !next.action) return null
  const u = URGENCY[next.urgency] || URGENCY.low
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: `1px solid ${u.border || 'var(--card-border)'}`,
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Target size={12} style={{ color: u.border || 'var(--t3)' }} />
        <span style={SECTION}>Next action</span>
        <span style={{ marginLeft: 'auto' }}><Badge variant={u.variant}>{u.label}</Badge></span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>{next.action}</div>
      {next.detail && <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5 }}>{next.detail}</div>}
    </div>
  )
}

// ─── Shell + states ───────────────────────────────────────────────────────────
const PAGE_CSS = `
@keyframes veoriSpin { to { transform: rotate(360deg) } }
@keyframes veoriLive { 0% { opacity: .8; transform: scale(1) } 100% { opacity: 0; transform: scale(1.35) } }
.veori-live-ring { animation: veoriLive 1.6s ease-out infinite; }
.veori-spin { animation: veoriSpin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .veori-live-ring, .veori-spin { animation: none !important; } }
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '96px 24px', textAlign: 'center' }}>
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
      if (r.status === 404) throw new Error('This lead could not be found.')
      if (!r.ok) throw new Error(`The server returned an error (${r.status}).`)
      const json = await r.json().catch(() => null)
      if (!json || typeof json !== 'object' || !json.data) {
        throw new Error('The server sent a response this page could not read.')
      }
      setData(json.data)
    } catch (e) {
      setError(e?.message || 'Could not load this lead.')
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [leadId])

  useEffect(() => {
    load()
    if (!leadId) return undefined
    timerRef.current = setInterval(() => load(true), 20000)
    return () => clearInterval(timerRef.current)
  }, [load, leadId])

  if (!leadId) return <LeadPicker />

  if (loading) return (
    <Centered>
      <Loader2 size={26} className="veori-spin" style={{ color: C.green }} />
      <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading this lead's activity…</div>
    </Centered>
  )

  if (error) return (
    <Centered>
      <AlertTriangle size={26} style={{ color: C.amber }} />
      <div style={{ color: 'var(--t2)', fontSize: 14, maxWidth: 380 }}>{error}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={() => load()}>Try again</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads')}>Back to leads</Button>
      </div>
    </Centered>
  )

  const lead       = data?.lead || {}
  const pmi        = data?.pmi || {}
  const chain      = Array.isArray(data?.agentChain) ? data.agentChain : []
  const nextAction = data?.nextAction || null
  const counts     = data?.counts || {}

  const overall = toScore(pmi.overall?.value)
  const name    = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unnamed lead'
  const money   = (n) => (n != null && n !== '' && !Number.isNaN(Number(n)) ? `$${Number(n).toLocaleString()}` : '-')

  return (
    <Shell>
      {/* Header — this lead's identity */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'var(--app-bg)',
        borderBottom: '1px solid var(--border)', padding: '14px 24px',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <button onClick={() => navigate(-1)} style={{
          background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit',
        }}>
          <ArrowLeft size={15} /> Back
        </button>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em' }}>{name}</span>
            {overall != null && overall >= 70 && <Badge variant="green">Hot</Badge>}
            {lead.status && <Badge variant="gray">{lead.status}</Badge>}
            {lead.is_on_dnc && <Badge variant="red">DNC</Badge>}
          </div>
          {lead.property_address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <MapPin size={11} style={{ color: 'var(--t4)' }} />
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{lead.property_address}</span>
            </div>
          )}
        </div>

        <Button variant="secondary" size="sm" loading={busy} onClick={() => load(true)}>
          <RefreshCw size={12} /> Refresh
        </Button>
        <Link to="/leads" style={{ fontSize: 12, color: C.green, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          All leads <ExternalLink size={11} />
        </Link>
      </div>

      {/* Score + stats banner — same treatment as the Leads drawer */}
      <div style={{
        padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface-bg)',
        display: 'flex', alignItems: 'flex-start', gap: 36, flexWrap: 'wrap',
      }}>
        <ScoreBlock score={overall} basis={pmi.overall?.basis} />
        <Stat label="Calls" value={counts.calls ?? 0} />
        <Stat label="Texts" value={counts.sms ?? 0} />
        <Stat label="Est. value" value={money(lead.estimated_value)} />
        <Stat label="Est. equity" value={money(lead.estimated_equity)} />
        {lead.seller_personality && (
          <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            <Badge variant="amber">{lead.seller_personality}</Badge>
          </div>
        )}
      </div>

      {/* Flex-wrap sidebar layout, driven by the width this page ACTUALLY has.
          A viewport media query was wrong here: the platform's nav rail and its
          right-hand system panel both take width, so at a normal window size the
          activity column was squeezed to a few dozen pixels (one word per line).
          With wrap, the activity column drops below the breakdown whenever it
          cannot get a readable width beside it. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 20, padding: 24,
        alignItems: 'flex-start', maxWidth: 1280, margin: '0 auto',
      }}>
        {/* Left — this lead's motivation breakdown + next step */}
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '14px 16px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
              <Brain size={12} style={{ color: C.gold }} />
              <span style={SECTION}>Motivation breakdown</span>
            </div>
            <BreakdownRow label="Distress"   metric={pmi.distress}   color={C.red}   icon={Flame} />
            <BreakdownRow label="Urgency"    metric={pmi.urgency}    color={C.amber} icon={Zap} />
            <BreakdownRow label="Engagement" metric={pmi.engagement} color={C.gold}  icon={Activity} />
            <div style={{ marginBottom: -1 }}>
              <BreakdownRow label="Equity"   metric={pmi.equity}     color={C.green} icon={DollarSign} />
            </div>
          </div>
          <NextAction next={nextAction} />
        </div>

        {/* Right — everything that has happened with this lead */}
        <div style={{ flex: '999 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <TrendingUp size={12} style={{ color: C.green }} />
            <span style={SECTION}>What the AI has done</span>
            <span style={{ fontSize: 11, color: 'var(--t4)' }}>{chain.length} step{chain.length === 1 ? '' : 's'}</span>
          </div>

          {chain.length === 0 ? (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '44px 24px', textAlign: 'center' }}>
              <Activity size={20} style={{ color: 'var(--t4)', marginBottom: 10 }} />
              <div style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 600, marginBottom: 5 }}>No activity with this seller yet</div>
              <div style={{ color: 'var(--t4)', fontSize: 12, lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
                Add them to a campaign. Every text, call and AI decision for this lead will appear here.
              </div>
            </div>
          ) : chain.map((step, i) => (
            <Step key={step?.id || i} step={step} isLast={i === chain.length - 1} />
          ))}
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
    fetch(`${API}/leads?limit=100`, { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) throw new Error('Your session has expired. Please sign in again.')
        if (!r.ok) throw new Error(`The server returned an error (${r.status}).`)
        return r.json()
      })
      .then(d => { if (!cancelled) setLeads(Array.isArray(d?.data) ? d.data : []) })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load leads.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = leads.filter(l =>
    `${l?.first_name || ''} ${l?.last_name || ''} ${l?.property_address || ''}`.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <Shell>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>AI Activity</h1>
        <p style={{ color: 'var(--t3)', fontSize: 14, margin: '0 0 20px' }}>
          Choose a seller to see everything the AI has done with them.
        </p>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or address"
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)',
              border: '1px solid var(--input-border)', borderRadius: 10, color: 'var(--input-text)',
              padding: '11px 14px 11px 34px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>Loading leads…</div>}
        {error && !loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--t3)', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!loading && !error && filtered.slice(0, 50).map(l => {
            const s = toScore(l.motivation_score)
            const color = scoreColor(s)
            return (
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
                    {l.property_address || '-'}
                  </span>
                </span>
                {/* Compact score — same as a Leads list row */}
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  {s != null ? (
                    <>
                      <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginBottom: 4 }}>{s}</span>
                      <span style={{ display: 'block', width: 36, height: 2.5, background: 'var(--border)', borderRadius: 2, marginLeft: 'auto', overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${s}%`, height: '100%', background: color, borderRadius: 2 }} />
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--t4)' }}>-</span>
                  )}
                </span>
              </button>
            )
          })}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 36, color: 'var(--t4)', fontSize: 13 }}>No leads match that search.</div>
          )}
        </div>
      </div>
    </Shell>
  )
}
