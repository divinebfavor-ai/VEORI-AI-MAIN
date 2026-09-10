/**
 * VEORI Intelligence — Advanced per-lead AI viewer
 * "Sit and watch it work" — real data, real agent chain, real PMI breakdown
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Brain, Zap, Phone, MessageSquare, FileText, Calendar,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle,
  Clock, CheckCircle2, Circle, Loader2, Activity, TrendingUp,
  Target, Flame, Shield, DollarSign, MapPin, User, Radio,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

function auth() {
  const t = localStorage.getItem('veori_token') || localStorage.getItem('token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// ─── Colour tokens ─────────────────────────────────────────────────────────────
const C = {
  green:  '#00C37A',
  blue:   '#4D9EFF',
  amber:  '#F59E0B',
  red:    '#EF4444',
  purple: '#8B5CF6',
  cyan:   '#06B6D4',
  bg:     '#04090F',
  card:   '#080F1A',
  border: 'rgba(255,255,255,0.07)',
}

// ─── PMI ring chart ────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 96 }) {
  const r = (size / 2) - 8
  const circ = 2 * Math.PI * r
  const color = score >= 70 ? C.green : score >= 40 ? C.amber : C.red
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={7} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * circ} ${circ}`}
        strokeDashoffset={0}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }}
      />
      <text x={size/2} y={size/2 + 2} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size < 64 ? 16 : 22} fontWeight={900} fontFamily="Inter,sans-serif">
        {score ?? '?'}
      </text>
    </svg>
  )
}

// ─── PMI sub-score bar ─────────────────────────────────────────────────────────
function PMIBar({ label, value, color, icon: Icon, delay = 0 }) {
  const [width, setWidth] = useState(0)
  useEffect(() => { const t = setTimeout(() => setWidth(value), 120 + delay); return () => clearTimeout(t) }, [value, delay])
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {Icon && <Icon size={13} style={{ color }} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em' }}>{label}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 100,
          background: `linear-gradient(90deg, ${color}aa, ${color})`,
          width: `${width}%`,
          transition: 'width 1s cubic-bezier(.4,0,.2,1)',
          boxShadow: `0 0 8px ${color}55`,
        }} />
      </div>
    </div>
  )
}

// ─── Agent step icons ─────────────────────────────────────────────────────────
const AGENT_ICONS = {
  import:   { Icon: User,         color: C.cyan   },
  sms:      { Icon: MessageSquare,color: C.blue   },
  reply:    { Icon: MessageSquare,color: C.green  },
  call:     { Icon: Phone,        color: C.purple },
  analysis: { Icon: Brain,        color: C.amber  },
  contract: { Icon: FileText,     color: C.green  },
  calendar: { Icon: Calendar,     color: C.cyan   },
  followup: { Icon: RefreshCw,    color: C.blue   },
  nurture:  { Icon: Clock,        color: 'rgba(255,255,255,0.3)' },
}

function agentIcon(icon) {
  return AGENT_ICONS[icon] || { Icon: Activity, color: C.blue }
}

function statusDot(status) {
  if (status === 'active')    return { color: C.green,  Icon: Radio,          pulse: true  }
  if (status === 'completed') return { color: C.green,  Icon: CheckCircle2,   pulse: false }
  if (status === 'failed')    return { color: C.red,    Icon: AlertTriangle,  pulse: false }
  return                             { color: C.amber,  Icon: Circle,         pulse: false }
}

function timeStr(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Agent chain step ─────────────────────────────────────────────────────────
function AgentStep({ step, isLast }) {
  const [open, setOpen] = useState(false)
  const { Icon: AIcon, color: aColor } = agentIcon(step.icon)
  const { color: sColor, Icon: SIcon, pulse } = statusDot(step.status)
  const hasDetail = step.transcript || (step.signals?.length > 0) || (step.objections?.length > 0)

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 36 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: `${aColor}18`,
          border: `1.5px solid ${aColor}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1,
        }}>
          <AIcon size={15} style={{ color: aColor }} />
          {pulse && (
            <div style={{
              position: 'absolute', inset: -4, borderRadius: '50%',
              border: `2px solid ${C.green}`, animation: 'ping 1.2s infinite',
              opacity: 0.6,
            }} />
          )}
        </div>
        {!isLast && <div style={{ width: 1.5, flex: 1, background: 'rgba(255,255,255,0.06)', marginTop: 2, minHeight: 20 }} />}
      </div>

      {/* Card */}
      <div style={{ flex: 1, marginBottom: 16, minWidth: 0 }}>
        <div
          onClick={() => hasDetail && setOpen(o => !o)}
          style={{
            background: step.status === 'active' ? `${C.green}0a` : C.card,
            border: `1px solid ${step.status === 'active' ? C.green + '40' : C.border}`,
            borderRadius: 10, padding: '12px 14px',
            cursor: hasDetail ? 'pointer' : 'default',
            transition: 'border-color 0.2s',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: aColor, background: `${aColor}18`, padding: '2px 7px', borderRadius: 100, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  {step.agent}
                </span>
                {step.status === 'active' && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: `${C.green}18`, padding: '2px 7px', borderRadius: 100, letterSpacing: '0.05em' }}>
                    ● LIVE
                  </span>
                )}
                {step.score != null && (
                  <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>PMI {step.score}</span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{step.action}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{step.detail}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <SIcon size={13} style={{ color: sColor }} />
              {hasDetail && (open ? <ChevronUp size={12} style={{ color: 'rgba(255,255,255,0.3)' }} /> : <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.3)' }} />)}
            </div>
          </div>

          {step.at && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>{timeStr(step.at)}</div>
          )}

          {/* Expandable */}
          {open && hasDetail && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              {step.signals?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Key signals</div>
                  {step.signals.map((s, i) => <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>· {s}</div>)}
                </div>
              )}
              {step.objections?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Objections</div>
                  {step.objections.map((o, i) => <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>· {o}</div>)}
                </div>
              )}
              {step.transcript && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Transcript</div>
                  <div style={{
                    maxHeight: 220, overflowY: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.55)',
                    lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '10px 12px',
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

// ─── Next-action pill ─────────────────────────────────────────────────────────
function NextActionBanner({ next }) {
  const urgencyStyle = {
    live:     { bg: `${C.green}18`, border: C.green,  color: C.green,  label: '● LIVE'    },
    critical: { bg: `${C.red}18`,   border: C.red,    color: C.red,    label: '⚡ CRITICAL' },
    high:     { bg: `${C.amber}18`, border: C.amber,  color: C.amber,  label: '▲ HIGH'    },
    medium:   { bg: `${C.blue}18`,  border: C.blue,   color: C.blue,   label: '→ MEDIUM'  },
    low:      { bg: 'rgba(255,255,255,0.04)', border: C.border, color: 'rgba(255,255,255,0.4)', label: '· LOW' },
  }
  const s = urgencyStyle[next.urgency] || urgencyStyle.low
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Target size={14} style={{ color: s.color }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: s.color, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next Action</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: s.color, marginLeft: 'auto' }}>{s.label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{next.action}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{next.detail}</div>
    </div>
  )
}

// ─── Live Activity Feed ───────────────────────────────────────────────────────
function LiveFeed() {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${API}/calls?limit=12&offset=0`, { headers: auth() })
      if (!r.ok) return
      const json = await r.json()
      setEvents(json.data || [])
      setConnected(true)
    } catch { setConnected(false) }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 8000)
    return () => clearInterval(t)
  }, [poll])

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Radio size={14} style={{ color: C.green }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Live Platform Activity</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? C.green : C.amber, boxShadow: connected ? `0 0 6px ${C.green}` : 'none' }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{connected ? 'streaming' : 'connecting...'}</span>
        </div>
      </div>
      {events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
          Waiting for AI activity…
        </div>
      ) : events.map((ev, i) => {
        const label = (ev.outcome || ev.status || '').replace(/_/g, ' ')
        const name  = ev.lead_name || (ev.leads ? `${ev.leads.first_name || ''} ${ev.leads.last_name || ''}`.trim() : '') || 'Lead'
        const addr  = ev.property_address || ev.leads?.property_address || ''
        return (
          <div key={ev.id || i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '8px 0', borderBottom: i < events.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <Phone size={12} style={{ color: C.purple, flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                {name} {label ? `· ${label}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {addr} {ev.motivation_score ? `· PMI ${ev.motivation_score}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
              {ev.started_at ? new Date(ev.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VeoriIntelligence() {
  const { id: leadId } = useParams()
  const navigate       = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const intervalRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!leadId) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const r = await fetch(`${API}/leads/${leadId}/intelligence`, { headers: auth() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      setData(json.data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [leadId])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(() => load(true), 15000)
    return () => clearInterval(intervalRef.current)
  }, [load])

  if (!leadId) return (
    <LeadSelector onSelect={id => navigate(`/intelligence/lead/${id}`)} />
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <Loader2 size={36} style={{ color: C.green, animation: 'spin 1s linear infinite' }} />
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading intelligence…</div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <AlertTriangle size={32} style={{ color: C.red }} />
      <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Couldn't load intelligence: {error}</div>
      <button onClick={() => load()} style={{ background: C.green, color: '#000', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Retry</button>
    </div>
  )

  const { lead, pmi, agentChain, nextAction, totalCalls } = data
  const name = `${lead.first_name} ${lead.last_name}`
  const isHot = pmi.overall >= 70

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes ping  { 0%,100% { transform:scale(1); opacity:0.6 } 50% { transform:scale(1.5); opacity:0 } }
        @keyframes spin  { to { transform:rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        ::-webkit-scrollbar { width:4px; height:4px }
        ::-webkit-scrollbar-track { background:transparent }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:4px }
      `}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#06101C', borderBottom: `1px solid ${C.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: 0 }}>
          <ArrowLeft size={15} /> Back
        </button>
        <div style={{ width: 1, height: 18, background: C.border }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>{name}</span>
            {isHot && (
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: `${C.green}18`, padding: '2px 8px', borderRadius: 100 }}>
                🔥 HOT LEAD
              </span>
            )}
            {lead.status && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{lead.status}</span>
            )}
          </div>
          {lead.property_address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <MapPin size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{lead.property_address}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => load(true)}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <RefreshCw size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
          <Link to="/leads" style={{ fontSize: 12, color: C.blue, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            All leads <ExternalLink size={11} />
          </Link>
        </div>
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '320px 1fr 300px', gap: 20, maxWidth: 1440, margin: '0 auto' }}>

        {/* ── Col 1: PMI + next action ─────────────────────────────────── */}
        <div>
          {/* PMI card */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <Brain size={14} style={{ color: C.purple }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>PMI Intelligence</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <ScoreRing score={pmi.overall} size={100} />
            </div>

            <PMIBar label="Distress"   value={pmi.distress}   color={C.red}    icon={Flame}      delay={0}   />
            <PMIBar label="Urgency"    value={pmi.urgency}    color={C.amber}  icon={Zap}        delay={150} />
            <PMIBar label="Engagement" value={pmi.engagement} color={C.blue}   icon={Activity}   delay={300} />
            <PMIBar label="Equity"     value={pmi.equity}     color={C.green}  icon={DollarSign} delay={450} />
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total Calls',    value: totalCalls,  color: C.purple },
              { label: 'Agent Steps',    value: agentChain.length, color: C.blue },
              { label: 'Est. Value',     value: lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '-', color: C.green },
              { label: 'Est. Equity',    value: lead.estimated_equity ? `$${Number(lead.estimated_equity).toLocaleString()}` : '-', color: C.amber },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color }}>{value ?? '—'}</div>
              </div>
            ))}
          </div>

          {/* Next action */}
          <NextActionBanner next={nextAction} />

          {/* Lead quick-info */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Lead Profile</div>
            {[
              { label: 'Phone',    value: lead.phone },
              { label: 'City',     value: [lead.property_city, lead.property_state].filter(Boolean).join(', ') },
              { label: 'Type',     value: lead.property_type },
              { label: 'Niche',    value: lead.tags?.join(', ') || lead.source },
              { label: 'ARV',      value: lead.estimated_arv ? `$${Number(lead.estimated_arv).toLocaleString()}` : null },
            ].filter(r => r.value).map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Col 2: Agent chain ───────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={14} style={{ color: C.cyan }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                AI Agent Chain
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>
              {agentChain.length} steps · auto-refreshes every 15s
            </span>
            {refreshing && <Loader2 size={12} style={{ color: C.green, animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
          </div>

          {agentChain.length === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>
              No AI activity yet for this lead.
              <br /><br />
              <span style={{ fontSize: 12 }}>Add this lead to a campaign to start the agent chain.</span>
            </div>
          ) : (
            agentChain.map((step, i) => (
              <AgentStep key={step.id} step={step} isLast={i === agentChain.length - 1} />
            ))
          )}
        </div>

        {/* ── Col 3: Live platform feed ─────────────────────────────────── */}
        <div>
          <LiveFeed />
        </div>
      </div>
    </div>
  )
}

// ─── Lead selector (when no :id in URL) ──────────────────────────────────────
function LeadSelector({ onSelect }) {
  const [leads, setLeads] = useState([])
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${API}/leads?limit=100`, { headers: auth() })
      .then(r => r.json())
      .then(d => setLeads(d.data || []))
      .catch(() => {})
  }, [])

  const filtered = leads.filter(l =>
    `${l.first_name} ${l.last_name} ${l.property_address}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: 32, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Brain size={20} style={{ color: C.green }} />
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: 0 }}>VEORI Intelligence</h1>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 28 }}>
          Select a lead to watch the AI agent chain in real time.
        </p>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search leads…"
          style={{
            width: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            color: '#fff', padding: '12px 16px', fontSize: 14, fontFamily: 'Inter,sans-serif',
            outline: 'none', marginBottom: 16, boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.slice(0, 30).map(l => (
            <button
              key={l.id}
              onClick={() => navigate(`/intelligence/lead/${l.id}`)}
              style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', color: '#fff', textAlign: 'left', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.green + '60'}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{l.first_name} {l.last_name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{l.property_address}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {l.motivation_score != null && (
                  <ScoreRing score={l.motivation_score} size={42} />
                )}
                <ChevronDown size={14} style={{ color: 'rgba(255,255,255,0.3)', transform: 'rotate(-90deg)' }} />
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 32 }}>No leads found</div>}
        </div>
      </div>
    </div>
  )
}
