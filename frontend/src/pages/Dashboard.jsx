import React, { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import { Phone, Flame, Briefcase, DollarSign, ArrowRight, CheckSquare, Square, ChevronRight, TrendingUp, AlertTriangle, Clock } from 'lucide-react'
import Badge from '../components/ui/Badge'
import { analytics } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useAuthStore from '../store/authStore'
import useIntelStore from '../store/intelStore'

function fmt$(n) { if (!n) return '$0'; return '$' + Number(n).toLocaleString() }

function scoreColor(s) {
  if (s == null) return 'rgba(255,255,255,0.35)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}
function statusBadge(s) {
  const m = { interested:'green','appointment set':'green','under contract':'green','offer made':'gold',calling:'amber',new:'gray',contacted:'amber',dnc:'red',closed:'gold' }
  return m[s?.toLowerCase()] || 'gray'
}

const PIPELINE_STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Closed']

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, accent, sub, loading }) {
  const colors = { green: '#00C37A', gold: '#C9A84C', red: '#FF4444', white: 'rgba(255,255,255,0.80)' }
  const glows  = { green: 'rgba(0,195,122,0.15)', gold: 'rgba(201,168,76,0.12)', red: 'rgba(255,68,68,0.12)', white: 'rgba(255,255,255,0.06)' }
  const color = colors[accent] || colors.white
  const glow  = glows[accent]  || glows.white
  const [hov, setHov] = useState(false)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="glass-card glass-refraction"
      style={{
        padding: '20px 22px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        minHeight: 100, position: 'relative', overflow: 'hidden',
        transform: hov ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hov
          ? `0 0 0 0.5px rgba(255,255,255,0.06) inset, 0 8px 32px rgba(0,0,0,0.6), 0 0 24px ${glow}`
          : undefined,
      }}
    >
      {/* Accent baseline */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: color, opacity: 0.35 }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {/* Icon pill */}
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${glow}`,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} strokeWidth={1.8} style={{ color }} />
        </div>
        {sub && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)' }}>{sub}</span>}
      </div>

      <div>
        <p style={{
          fontSize: loading ? 32 : 44, fontWeight: 700, letterSpacing: '-0.03em',
          color: loading ? 'rgba(255,255,255,0.20)' : color,
          lineHeight: 1, marginBottom: 4,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'Geist Mono, monospace',
        }}>
          {loading ? '—' : value}
        </p>
        <p className="label-caps">{label}</p>
      </div>
    </div>
  )
}

// ─── Priority Item ────────────────────────────────────────────────────────────
const PRIORITIES = [
  { id: 1, text: 'Follow up with Marcus Johnson — accepted offer verbally', urgency: 'high',   to: '/pipeline' },
  { id: 2, text: 'Send PSA contract to 847 Oak Street Detroit',             urgency: 'high',   to: '/pipeline' },
  { id: 3, text: 'Review 3 new hot leads from yesterday\'s campaign',       urgency: 'medium', to: '/leads' },
  { id: 4, text: 'Schedule callback for Sarah Williams before 6pm',         urgency: 'medium', to: '/leads' },
  { id: 5, text: 'Check buyer interest on 1204 Pine Ave Memphis',           urgency: 'low',    to: '/pipeline' },
]

// ─── Command Center ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]             = useState(null)
  const [recentCalls, setRecentCalls] = useState([])
  const [pipeline, setPipeline]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [checked, setChecked]         = useState({})
  const { calls: liveCalls }          = useLiveCalls()
  const user    = useAuthStore(s => s.user)
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
    }).catch(() => {
      setStats({ calls_today: 0, hot_leads: 0, active_deals: 0, revenue_closed: 0 })
    }).finally(() => setLoading(false))
  }, [])

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }))
  const hasLive = liveCalls.length > 0

  const pipelineMap = {}
  pipeline.forEach(p => { pipelineMap[p.status] = p.count })

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.full_name?.split(' ')[0] || 'Operator'

  return (
    <div style={{ padding: '28px 28px 40px', maxWidth: 1320, margin: '0 auto' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            {greeting}, {firstName}.
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.40)', margin: 0 }}>
            Here is what is happening in your pipeline.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hasLive && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,195,122,0.08)',
              border: '1px solid rgba(0,195,122,0.20)',
              borderRadius: 20, padding: '5px 12px',
              fontSize: 12, fontWeight: 600, color: '#00C37A',
            }}>
              <span className="live-dot" />
              {liveCalls.length} active {liveCalls.length === 1 ? 'call' : 'calls'}
            </div>
          )}
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }} className="stagger">
        <StatCard label="Calls Today"    value={stats?.calls_today  ?? 0} icon={Phone}     accent="green" sub={hasLive ? `${liveCalls.length} live` : undefined} loading={loading} />
        <StatCard label="Hot Leads"      value={stats?.hot_leads    ?? 0} icon={Flame}     accent={stats?.hot_leads > 0 ? 'gold' : 'white'} sub="Score 70+"  loading={loading} />
        <StatCard label="Active Deals"   value={stats?.active_deals ?? 0} icon={Briefcase} accent="gold"  sub={stats?.pipeline_value ? fmt$(stats.pipeline_value) : undefined} loading={loading} />
        <StatCard label="Revenue Closed" value={fmt$(stats?.revenue_closed)} icon={DollarSign} accent="white" sub="This month" loading={loading} />
      </div>

      {/* ── Pipeline velocity bar ────────────────────────────────────────── */}
      {pipeline.length > 0 && (() => {
        const total = pipeline.reduce((s, p) => s + (p.count || 0), 0)
        return total > 0 ? (
          <div style={{ display: 'flex', gap: 3, height: 3, borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}>
            {PIPELINE_STAGES.map((stage, i) => {
              const count = pipelineMap[stage.toLowerCase()] || pipelineMap[stage] || 0
              if (!count) return null
              const pct = ((count / total) * 100).toFixed(1)
              const colors = ['rgba(255,255,255,0.15)','rgba(255,149,0,0.5)','rgba(255,149,0,0.5)','rgba(201,168,76,0.8)','rgba(255,149,0,0.6)','rgba(0,195,122,0.8)','rgba(0,195,122,0.5)','rgba(0,195,122,1)']
              return <div key={stage} style={{ flex: `0 0 ${pct}%`, background: colors[i % colors.length], borderRadius: 2 }} title={`${stage}: ${count}`} />
            })}
          </div>
        ) : null
      })()}

      {/* ── Main content grid ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>

        {/* Left: Live Activity */}
        <div className="glass-card glass-refraction" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', margin: 0 }}>Live Activity</h2>
              {hasLive && <span className="live-dot" />}
            </div>
            <Link to="/monitor" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>
              Monitor <ArrowRight size={11} />
            </Link>
          </div>

          {/* Live calls */}
          {liveCalls.slice(0, 3).map(call => (
            <button
              key={call.id || call.vapi_call_id}
              onClick={() => setIntel('call', call)}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: 'rgba(0,195,122,0.04)',
                borderLeft: '2px solid rgba(0,195,122,0.40)',
                cursor: 'pointer', transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,195,122,0.07)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,195,122,0.04)'}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#00C37A',
              }}>
                {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.lead_name || 'Unknown Seller'}
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                  {call.property_address || 'Address unknown'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge variant="green" dot>Live</Badge>
                {call.motivation_score != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(call.motivation_score), fontFamily: 'Geist Mono, monospace' }}>
                    {call.motivation_score}
                  </span>
                )}
              </div>
            </button>
          ))}

          {/* Recent calls */}
          {recentCalls.slice(0, hasLive ? 3 : 7).map(call => (
            <div
              key={call.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
              }}>
                {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.80)', margin: '0 0 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.lead_name || 'Unknown'}
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', margin: 0 }}>
                  {call.outcome || 'No answer'}
                  {call.started_at ? ` · ${formatDistanceToNow(new Date(call.started_at), { addSuffix: true })}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {call.motivation_score != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(call.motivation_score), fontFamily: 'Geist Mono, monospace' }}>
                    {call.motivation_score}
                  </span>
                )}
                <Badge variant={statusBadge(call.outcome)}>{call.outcome || 'No answer'}</Badge>
              </div>
            </div>
          ))}

          {!hasLive && recentCalls.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Phone size={20} style={{ color: '#00C37A' }} strokeWidth={1.5} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.60)', marginBottom: 4 }}>No active calls right now</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.30)', marginBottom: 16 }}>Start a campaign to begin dialing</p>
              <Link to="/campaigns" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#00C37A' }}>
                Launch campaign <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>

        {/* Right: Priority Actions */}
        <div className="glass-card glass-refraction" style={{ borderRadius: 16, borderLeft: '1px solid rgba(201,168,76,0.18)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', margin: '0 0 2px' }}>AI Priority Actions</h2>
            <p className="label-caps">Generated · Updated daily</p>
          </div>
          <div style={{ padding: '8px 0' }}>
            {PRIORITIES.map(item => (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                style={{
                  width: 'calc(100% - 8px)', textAlign: 'left',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  borderRadius: 8, margin: '1px 4px', transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.035)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  {checked[item.id]
                    ? <CheckSquare size={14} style={{ color: '#00C37A' }} />
                    : <Square size={14} style={{ color: 'rgba(255,255,255,0.30)' }} />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 13, lineHeight: 1.5,
                    color: checked[item.id] ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)',
                    textDecoration: checked[item.id] ? 'line-through' : 'none',
                    margin: '0 0 3px',
                  }}>
                    {item.text}
                  </p>
                  {item.urgency === 'high' && !checked[item.id] && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#FF4444', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Urgent
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline Overview ────────────────────────────────────────────── */}
      <div className="glass-card glass-refraction" style={{ borderRadius: 16, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', margin: 0 }}>Pipeline Overview</h2>
          <Link to="/pipeline" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>
            Full pipeline <ArrowRight size={11} />
          </Link>
        </div>
        <div style={{ padding: '20px 20px', display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const count = pipelineMap[stage.toLowerCase()] || pipelineMap[stage] || 0
            return (
              <Link key={stage} to={`/pipeline?stage=${stage.toLowerCase()}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                <div style={{ width: '100%', height: 2, borderRadius: 1, background: count > 0 ? 'rgba(0,195,122,0.4)' : 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#00C37A', borderRadius: 1, width: `${Math.min(100, count * 25)}%`, transition: 'width 0.6s ease' }} />
                </div>
                <span style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? '#FFFFFF' : 'rgba(255,255,255,0.20)', letterSpacing: '-0.03em', lineHeight: 1, fontFamily: 'Geist Mono, monospace' }}>
                  {count}
                </span>
                <span className="label-caps" style={{ textAlign: 'center', lineHeight: 1.3 }}>{stage}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
