import React, { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import { Phone, ArrowRight, Zap, FileCheck, TrendingUp, AlertCircle, CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import Badge from '../components/ui/Badge'
import { analytics } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useAuthStore from '../store/authStore'
import useIntelStore from '../store/intelStore'

function fmt$(n) { if (!n) return '$0'; return '$' + Number(n).toLocaleString() }
function fmtDur(s) { if (!s) return '0:00'; return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` }

function scoreColor(s) {
  if (s == null) return 'var(--t3)'
  if (s >= 70) return 'var(--green)'
  if (s >= 40) return 'var(--amber)'
  return 'var(--red)'
}

function statusBadge(s) {
  const m = { interested:'green','appointment set':'green','under contract':'green','offer made':'gold',calling:'amber',new:'gray',contacted:'amber',dnc:'red',closed:'gold' }
  return m[s?.toLowerCase()] || 'gray'
}

// ─── Attention Items (AI-generated decision queue) ────────────────────────────
const ATTENTION_ITEMS = [
  {
    id: 1,
    type: 'decision',
    urgency: 'high',
    icon: AlertCircle,
    iconColor: 'var(--red)',
    title: 'Marcus Johnson — verbal offer accepted',
    detail: 'Waiting on signed PSA. 47 Oak St Detroit. Assignment fee: $8,400.',
    action: 'Send Contract',
    actionTo: '/pipeline',
  },
  {
    id: 2,
    type: 'opportunity',
    urgency: 'high',
    icon: Zap,
    iconColor: 'var(--green)',
    title: '3 new hot leads from yesterday\'s campaign',
    detail: 'Score 70+. First-touch call not yet placed.',
    action: 'View Leads',
    actionTo: '/leads',
  },
  {
    id: 3,
    type: 'follow-up',
    urgency: 'medium',
    icon: Clock,
    iconColor: 'var(--amber)',
    title: 'Sarah Williams — callback before 6pm',
    detail: '3rd touch. Very motivated seller. Inherited property.',
    action: 'Dial Now',
    actionTo: '/monitor',
  },
  {
    id: 4,
    type: 'deal',
    urgency: 'medium',
    icon: FileCheck,
    iconColor: 'var(--gold)',
    title: '1204 Pine Ave Memphis — buyer interest check',
    detail: 'Deal in buyer search phase. 2 buyers pending response.',
    action: 'Open Deal',
    actionTo: '/pipeline',
  },
  {
    id: 5,
    type: 'info',
    urgency: 'low',
    icon: TrendingUp,
    iconColor: 'var(--t3)',
    title: 'Campaign 3 — completion at 61%',
    detail: '248 of 406 leads called. Avg score: 54.',
    action: 'View Campaign',
    actionTo: '/campaigns',
  },
]

const PIPELINE_STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Closed']

// ─── Velocity Strip ───────────────────────────────────────────────────────────
function VelocityStrip({ pipeline }) {
  const total = pipeline.reduce((s, p) => s + (p.count || 0), 0)
  if (!total) return null
  return (
    <div style={{ display: 'flex', gap: 2, height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 20, marginBottom: 24 }}>
      {pipeline.filter(p => p.count > 0).map((p, i) => {
        const pct = ((p.count / total) * 100).toFixed(1)
        const colors = ['rgba(255,255,255,0.12)','rgba(255,140,0,0.5)','rgba(255,140,0,0.5)','rgba(212,168,67,0.8)','rgba(255,140,0,0.6)','rgba(0,229,122,0.8)','rgba(0,229,122,0.5)','rgba(0,229,122,1)']
        return (
          <div
            key={p.status || i}
            style={{ flex: `0 0 ${pct}%`, background: colors[i % colors.length], borderRadius: 2 }}
            title={`${p.status}: ${p.count}`}
          />
        )
      })}
    </div>
  )
}

// ─── Stat Cell ────────────────────────────────────────────────────────────────
function StatCell({ label, value, sub, accent }) {
  const accents = {
    green: 'var(--green)',
    gold: 'var(--gold)',
    red: 'var(--red)',
    amber: 'var(--amber)',
  }
  const color = accents[accent] || 'var(--t1)'
  return (
    <div style={{
      padding: '20px 24px',
      borderRight: '1px solid var(--border-rest)',
    }}>
      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 8 }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color, lineHeight: 1, marginBottom: 4 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: 'var(--t4)' }}>{sub}</p>
      )}
    </div>
  )
}

// ─── Command Center ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]           = useState(null)
  const [recentCalls, setRecentCalls] = useState([])
  const [pipeline, setPipeline]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [dismissed, setDismissed]   = useState(new Set())
  const { calls: liveCalls }        = useLiveCalls()
  const user = useAuthStore(s => s.user)
  const setIntel = useIntelStore(s => s.setIntel)

  useEffect(() => {
    analytics.getDashboard().then(r => {
      const d = r.data?.data || r.data || {}
      setStats(d.stats || {})
      setRecentCalls(d.recent_calls || d.recent_activity || [])
      setPipeline(
        d.pipeline ||
        Object.entries(d.pipeline_funnel || {}).map(([status, count]) => ({ status, count }))
      )
      setLoading(false)
    }).catch(() => {
      setStats({ calls_today: 0, hot_leads: 0, active_deals: 0, revenue_closed: 0 })
      setLoading(false)
    })
  }, [])

  // Expose live call to Intel panel when clicked
  const openCallIntel = (call) => {
    setIntel('call', call)
  }

  const hasLive = liveCalls.length > 0
  const pipelineMap = {}
  pipeline.forEach(p => { pipelineMap[p.status] = p.count })

  const visibleItems = ATTENTION_ITEMS.filter(i => !dismissed.has(i.id))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '24px 28px 0',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
              Command Center
            </h1>
            {hasLive && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--green)' }}>
                <span className="dot-live" />
                {liveCalls.length} live
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--t4)' }}>
            {user?.full_name ? `Operator: ${user.full_name}` : 'veori.ai'}
          </p>
        </div>
        <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 0 }}>
          AI attention queue · {visibleItems.length} items requiring action
        </p>
      </div>

      {/* ── Stats strip ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: '1px solid var(--border-rest)',
        borderBottom: '1px solid var(--border-rest)',
        margin: '20px 28px 0',
        background: 'var(--s1)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <StatCell
          label="Calls Today"
          value={loading ? '—' : (stats?.calls_today ?? 0)}
          accent="green"
          sub={hasLive ? `${liveCalls.length} active` : 'No active calls'}
        />
        <StatCell
          label="Hot Leads"
          value={loading ? '—' : (stats?.hot_leads ?? 0)}
          accent={stats?.hot_leads > 0 ? 'green' : undefined}
          sub="Score 70+ motivation"
        />
        <StatCell
          label="Active Deals"
          value={loading ? '—' : (stats?.active_deals ?? 0)}
          accent="gold"
          sub={stats?.pipeline_value ? fmt$(stats.pipeline_value) + ' in pipeline' : 'No pipeline value'}
        />
        <div style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 8 }}>
            Revenue Closed
          </p>
          <p style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--t1)', lineHeight: 1, marginBottom: 4 }}>
            {loading ? '—' : fmt$(stats?.revenue_closed)}
          </p>
          <p style={{ fontSize: 11, color: 'var(--t4)' }}>Month to date</p>
        </div>
      </div>

      {/* ── Pipeline velocity ────────────────────────────────────────────── */}
      <div style={{ padding: '0 28px', flexShrink: 0 }}>
        <VelocityStrip pipeline={
          PIPELINE_STAGES.map(s => ({ status: s, count: pipelineMap[s.toLowerCase()] || pipelineMap[s] || 0 }))
        } />
      </div>

      {/* ── Main two-column layout ────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: 0,
        overflow: 'hidden',
        padding: '0 28px 28px',
      }}>

        {/* Left: Attention Queue ─────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', paddingRight: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 12 }}>
            Attention Required
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleItems.map(item => {
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--s1)',
                    border: '1px solid var(--border-rest)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    transition: 'border-color 0.15s ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-active)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-rest)'}
                >
                  {/* Icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: 'var(--s2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 1,
                  }}>
                    <Icon size={14} strokeWidth={1.8} style={{ color: item.iconColor }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', lineHeight: 1.3 }}>
                        {item.title}
                      </p>
                      {item.urgency === 'high' && (
                        <Badge variant="red">Urgent</Badge>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5 }}>
                      {item.detail}
                    </p>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Link
                      to={item.actionTo}
                      style={{
                        fontSize: 12, fontWeight: 500, color: 'var(--green)',
                        textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.action} <ChevronRight size={12} />
                    </Link>
                    <button
                      onClick={() => setDismissed(p => new Set([...p, item.id]))}
                      style={{
                        background: 'none', border: 'none', color: 'var(--t4)',
                        cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px',
                      }}
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}

            {visibleItems.length === 0 && (
              <div style={{
                padding: '40px 0', textAlign: 'center',
              }}>
                <CheckCircle2 size={28} style={{ color: 'var(--green)', margin: '0 auto 12px' }} strokeWidth={1.5} />
                <p style={{ fontSize: 14, color: 'var(--t2)' }}>All clear — no pending actions</p>
                <p style={{ fontSize: 12, color: 'var(--t4)', marginTop: 4 }}>The AI is running sequences in the background</p>
              </div>
            )}
          </div>

          {/* Pipeline stage count row */}
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                Pipeline
              </p>
              <Link to="/pipeline" style={{ fontSize: 11, color: 'var(--green)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                Full view <ArrowRight size={11} />
              </Link>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
            }}>
              {PIPELINE_STAGES.map(stage => {
                const count = pipelineMap[stage.toLowerCase()] || pipelineMap[stage] || 0
                return (
                  <Link
                    key={stage}
                    to={`/pipeline?stage=${stage.toLowerCase()}`}
                    style={{
                      background: 'var(--s1)',
                      border: '1px solid var(--border-rest)',
                      borderRadius: 6,
                      padding: '12px 14px',
                      textDecoration: 'none',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 20, fontWeight: 600, color: count > 0 ? 'var(--t1)' : 'var(--t4)', letterSpacing: '-0.02em' }}>
                      {count}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                      {stage}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right: Live Activity ─────────────────────────────────────────── */}
        <div style={{
          borderLeft: '1px solid var(--border-rest)',
          paddingLeft: 20,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                Live Activity
              </p>
              {hasLive && <span className="dot-live" />}
            </div>
            <Link to="/monitor" style={{ fontSize: 11, color: 'var(--green)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
              Monitor <ArrowRight size={11} />
            </Link>
          </div>

          {/* Live calls */}
          {liveCalls.slice(0, 3).map(call => (
            <button
              key={call.id || call.vapi_call_id}
              onClick={() => openCallIntel(call)}
              style={{
                width: '100%', textAlign: 'left',
                background: 'rgba(0,229,122,0.04)',
                border: '1px solid rgba(0,229,122,0.15)',
                borderRadius: 6, padding: '10px 12px',
                marginBottom: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(0,229,122,0.12)',
                border: '1px solid rgba(0,229,122,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color: 'var(--green)', flexShrink: 0,
              }}>
                {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)', marginBottom: 1 }}>
                  {call.lead_name || 'Unknown Seller'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {call.property_address || 'No address'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Badge variant="green" dot>Live</Badge>
                {call.motivation_score != null && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor(call.motivation_score) }}>
                    {call.motivation_score}
                  </span>
                )}
              </div>
            </button>
          ))}

          {/* Recent calls */}
          {recentCalls.slice(0, hasLive ? 4 : 8).map(call => (
            <div
              key={call.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0',
                borderBottom: '1px solid var(--border-rest)',
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: 'var(--s2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 600, color: 'var(--t3)', flexShrink: 0,
              }}>
                {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.lead_name || 'Unknown'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.outcome || 'No answer'}
                  {call.started_at ? ` · ${formatDistanceToNow(new Date(call.started_at), { addSuffix: true })}` : ''}
                </p>
              </div>
              {call.motivation_score != null && (
                <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor(call.motivation_score), flexShrink: 0 }}>
                  {call.motivation_score}
                </span>
              )}
            </div>
          ))}

          {!hasLive && recentCalls.length === 0 && (
            <div style={{ paddingTop: 32, textAlign: 'center' }}>
              <Phone size={22} style={{ color: 'var(--t4)', margin: '0 auto 10px', display: 'block' }} strokeWidth={1.5} />
              <p style={{ fontSize: 12, color: 'var(--t3)' }}>No active calls</p>
              <Link to="/campaigns" style={{ fontSize: 11, color: 'var(--green)', textDecoration: 'none', display: 'block', marginTop: 6 }}>
                Start a campaign →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
