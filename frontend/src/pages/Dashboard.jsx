import React, { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import { Phone, Flame, Briefcase, DollarSign, ArrowRight, Clock3, FileSignature, AlertTriangle, Zap, CheckCircle, X } from 'lucide-react'
import Badge from '../components/ui/Badge'
import { analytics, preferences as prefsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useAuthStore from '../store/authStore'
import useIntelStore from '../store/intelStore'

function fmt$(n) { if (!n) return '$0'; return '$' + Number(n).toLocaleString() }

function scoreColor(s) {
  if (s == null) return 'var(--t4)'
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
  const colors = { green: '#00C37A', gold: '#C9A84C', red: '#FF4444', white: 'var(--t2)' }
  const glows  = { green: 'rgba(0,195,122,0.10)', gold: 'rgba(201,168,76,0.10)', red: 'rgba(255,68,68,0.10)', white: 'transparent' }
  const color = colors[accent] || colors.white
  const glow  = glows[accent]  || glows.white
  const [hov, setHov] = useState(false)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '20px 22px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        minHeight: 100, position: 'relative', overflow: 'hidden',
        borderRadius: 14,
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
        transform: hov ? 'translateY(-2px)' : 'translateY(0)',
        borderColor: hov ? `${color}40` : 'var(--border)',
      }}
    >
      {/* Accent baseline */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: color, opacity: 0.30 }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {/* Icon pill */}
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: glow,
          border: `1px solid ${color}28`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} strokeWidth={1.8} style={{ color }} />
        </div>
        {sub && <span style={{ fontSize: 10, color: 'var(--t4)' }}>{sub}</span>}
      </div>

      <div>
        <p style={{
          fontSize: loading ? 32 : 44, fontWeight: 700, letterSpacing: '-0.03em',
          color: loading ? 'var(--t4)' : color,
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

// ─── Onboarding checklist ─────────────────────────────────────────────────────
const CHECKLIST = [
  { key: 'profile',   label: 'Complete your operator profile',    to: '/settings' },
  { key: 'phone',     label: 'Add a Vapi phone number',           to: '/settings' },
  { key: 'lead',      label: 'Import your first lead',            to: '/leads' },
  { key: 'campaign',  label: 'Launch your first campaign',        to: '/campaigns' },
  { key: 'buyer',     label: 'Add a cash buyer',                  to: '/buyers' },
]

function OnboardingChecklist({ onDismiss }) {
  const [checked, setChecked] = useState({})
  const allDone = CHECKLIST.every(c => checked[c.key])

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 200,
      width: 340,
      background: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.50)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} style={{ color: '#C9A84C' }} strokeWidth={1.8} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Getting Started</span>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 2, display: 'flex' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHECKLIST.map(item => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setChecked(p => ({ ...p, [item.key]: !p[item.key] }))}
              style={{
                width: 18, height: 18, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                background: checked[item.key] ? '#00C37A' : 'var(--surface-bg-3)',
                border: `1px solid ${checked[item.key] ? '#00C37A' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease',
              }}
            >
              {checked[item.key] && <CheckCircle size={11} style={{ color: '#000' }} />}
            </button>
            <Link to={item.to} style={{
              fontSize: 12, color: checked[item.key] ? 'var(--t4)' : 'var(--t2)',
              textDecoration: checked[item.key] ? 'line-through' : 'none',
              flex: 1, transition: 'all 0.2s ease',
            }}>
              {item.label}
            </Link>
          </div>
        ))}
        {allDone && (
          <button onClick={onDismiss} style={{
            marginTop: 6, width: '100%', padding: '8px 0', borderRadius: 10,
            background: '#00C37A', color: '#000', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
          }}>
            You're all set — dismiss
          </button>
        )}
      </div>
    </div>
  )
}

// ─── AI Command Log panel ─────────────────────────────────────────────────────
function AICommandLog() {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    prefsApi.activity({ limit: 20 })
      .then(r => setLog(r.data?.activity || []))
      .catch(() => setLog([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  const iconFor = (type) => {
    if (!type) return '⚡'
    if (type.includes('call'))     return '📞'
    if (type.includes('sms'))      return '💬'
    if (type.includes('contract')) return '📄'
    if (type.includes('qualify'))  return '🎯'
    if (type.includes('brief'))    return '📋'
    if (type.includes('title'))    return '🏠'
    if (type.includes('follow'))   return '🔁'
    return '⚡'
  }

  return (
    <div style={{ borderRadius: 16, marginTop: 16, background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <Zap size={14} style={{ color: '#C9A84C' }} strokeWidth={1.8} />
        <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', margin: 0 }}>AI Command Log</h2>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Live · refreshes every 15s
        </span>
      </div>

      {loading ? (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 42, borderRadius: 8, background: 'var(--surface-bg)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : log.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--t4)', margin: 0 }}>No AI actions recorded yet. Start a campaign to see the command log populate.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
          {log.map((entry, i) => (
            <div key={entry.log_id || i} style={{
              padding: '12px 18px',
              borderBottom: '1px solid var(--border)',
              borderRight: i % 2 === 0 ? '1px solid var(--border)' : 'none',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <span style={{ fontSize: 16, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>{iconFor(entry.action_type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.summary || String(entry.action_type || '').replace(/_/g, ' ')}
                </p>
                <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0 }}>
                  {entry.model ? `${entry.model} · ` : ''}
                  {entry.created_at ? formatDistanceToNow(new Date(entry.created_at), { addSuffix: true }) : '—'}
                </p>
              </div>
              {entry.status && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                  background: entry.status === 'success' ? 'rgba(0,195,122,0.10)' : 'rgba(255,68,68,0.10)',
                  color: entry.status === 'success' ? '#00C37A' : '#FF4444',
                  flexShrink: 0,
                }}>
                  {entry.status}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Command Center ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]             = useState(null)
  const [recentActivity, setRecentActivity] = useState([])
  const [pipeline, setPipeline]       = useState([])
  const [dueFollowUps, setDueFollowUps] = useState([])
  const [pendingContracts, setPendingContracts] = useState([])
  const [titleRisks, setTitleRisks] = useState([])
  const [loading, setLoading]         = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { calls: liveCalls }          = useLiveCalls()
  const user    = useAuthStore(s => s.user)
  const setIntel = useIntelStore(s => s.setIntel)

  useEffect(() => {
    const dismissed = localStorage.getItem('veori_onboarding_dismissed')
    if (!dismissed) setShowOnboarding(true)
  }, [])

  useEffect(() => {
    analytics.getDashboard().then(r => {
      const d = r.data?.data || r.data || {}
      setStats(d.stats || {})
      setRecentActivity(d.recent_activity || d.recent_calls || [])
      setPipeline(
        d.pipeline ||
        Object.entries(d.pipeline_funnel || {}).map(([status, count]) => ({ status, count }))
      )
      setDueFollowUps(d.due_follow_ups || [])
      setPendingContracts(d.pending_contracts || [])
      setTitleRisks(d.title_risks || [])
    }).catch(() => {
      setStats({ calls_today: 0, hot_leads: 0, deals_under_contract: 0, revenue_this_month: 0 })
    }).finally(() => setLoading(false))
  }, [])

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
          <h1 style={{ fontSize: 26, fontWeight: 500, color: 'var(--t1)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            {greeting}, {firstName}.
          </h1>
          <p style={{ fontSize: 14, color: 'var(--t4)', margin: 0 }}>
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
          <span style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }} className="stagger">
        <StatCard label="Calls Today"    value={stats?.calls_today  ?? 0} icon={Phone}     accent="green" sub={hasLive ? `${liveCalls.length} live` : undefined} loading={loading} />
        <StatCard label="Hot Leads"      value={stats?.hot_leads    ?? 0} icon={Flame}     accent={stats?.hot_leads > 0 ? 'gold' : 'white'} sub="Score 70+"  loading={loading} />
        <StatCard label="Active Deals"   value={stats?.deals_under_contract ?? 0} icon={Briefcase} accent="gold"  sub={`${stats?.pending_signatures ?? 0} pending`} loading={loading} />
        <StatCard label="Revenue Closed" value={fmt$(stats?.revenue_this_month)} icon={DollarSign} accent="white" sub="This month" loading={loading} />
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

      {/* ── Live Activity ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.75fr', gap: 16, alignItems: 'start' }}>

        {/* Left: Live Activity */}
        <div style={{ borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', margin: 0 }}>Live Activity</h2>
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
                borderBottom: '1px solid var(--border)',
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
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.lead_name || 'Unknown Seller'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>
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
          {recentActivity.slice(0, hasLive ? 3 : 7).map(call => (
            <div
              key={call.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 20px',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-bg-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: 'var(--surface-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color: 'var(--t4)',
              }}>
                {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t2)', margin: '0 0 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {call.message || call.lead_name || 'Activity'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>
                  {call.activity_type ? String(call.activity_type).replace(/_/g, ' ') : (call.outcome || 'No answer')}
                  {call.created_at ? ` · ${formatDistanceToNow(new Date(call.created_at), { addSuffix: true })}` : call.started_at ? ` · ${formatDistanceToNow(new Date(call.started_at), { addSuffix: true })}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge variant={call.activity_type?.includes('title') ? 'gold' : call.activity_type?.includes('contract') ? 'green' : 'gray'}>
                  {call.activity_type ? String(call.activity_type).replace(/_/g, ' ') : (call.outcome || 'No answer')}
                </Badge>
              </div>
            </div>
          ))}

          {!hasLive && recentActivity.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Phone size={20} style={{ color: '#00C37A' }} strokeWidth={1.5} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--t3)', marginBottom: 4 }}>No active calls right now</p>
              <p style={{ fontSize: 13, color: 'var(--t4)', marginBottom: 16 }}>Start a campaign to begin dialing</p>
              <Link to="/campaigns" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#00C37A' }}>
                Launch campaign <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            {
              title: 'Due Follow-Ups',
              icon: Clock3,
              color: '#00C37A',
              items: dueFollowUps,
              empty: 'Nothing overdue right now.',
              render: (item) => `${item.property_address} · ${item.follow_up_type?.replace(/_/g, ' ')} · ${item.next_follow_up_at ? formatDistanceToNow(new Date(item.next_follow_up_at), { addSuffix: true }) : 'scheduled'}`
            },
            {
              title: 'Pending Signatures',
              icon: FileSignature,
              color: '#C9A84C',
              items: pendingContracts,
              empty: 'No contracts waiting on signatures.',
              render: (item) => `${item.contract_type?.toUpperCase()} · ${item.signing_status?.replace(/_/g, ' ')}`
            },
            {
              title: 'Title Watchlist',
              icon: AlertTriangle,
              color: '#FF9500',
              items: titleRisks,
              empty: 'No title-risk items surfaced.',
              render: (item) => `${String(item.status || 'title').replace(/_/g, ' ')}${item.closing_date ? ` · closes ${item.closing_date}` : ''}`
            },
          ].map(section => (
            <div key={section.title} style={{ borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <section.icon size={14} style={{ color: section.color }} />
                  <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', margin: 0 }}>{section.title}</h2>
                </div>
                <span style={{ fontSize: 12, color: 'var(--t4)' }}>{section.items.length}</span>
              </div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {section.items.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>{section.empty}</p>
                ) : section.items.slice(0, 5).map(item => (
                  <div key={item.id} style={{ padding: '10px 12px', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <p style={{ fontSize: 12, color: 'var(--t1)', margin: '0 0 4px' }}>{item.reason || item.property_address || 'Queue item'}</p>
                    <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>{section.render(item)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── Pipeline Overview ────────────────────────────────────────────── */}
      <div style={{ borderRadius: 16, marginTop: 16, background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', margin: 0 }}>Pipeline Overview</h2>
          <Link to="/pipeline" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>
            Full pipeline <ArrowRight size={11} />
          </Link>
        </div>
        <div style={{ padding: '20px 20px', display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const count = pipelineMap[stage.toLowerCase()] || pipelineMap[stage] || 0
            return (
              <Link key={stage} to={`/pipeline?stage=${stage.toLowerCase()}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                <div style={{ width: '100%', height: 2, borderRadius: 1, background: count > 0 ? 'rgba(0,195,122,0.4)' : 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#00C37A', borderRadius: 1, width: `${Math.min(100, count * 25)}%`, transition: 'width 0.6s ease' }} />
                </div>
                <span style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? 'var(--t1)' : 'var(--t4)', letterSpacing: '-0.03em', lineHeight: 1, fontFamily: 'Geist Mono, monospace' }}>
                  {count}
                </span>
                <span className="label-caps" style={{ textAlign: 'center', lineHeight: 1.3 }}>{stage}</span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── AI Command Log ────────────────────────────────────────────────── */}
      <AICommandLog />

      {/* ── Onboarding Checklist (first login) ───────────────────────────── */}
      {showOnboarding && (
        <OnboardingChecklist onDismiss={() => {
          localStorage.setItem('veori_onboarding_dismissed', '1')
          setShowOnboarding(false)
        }} />
      )}
    </div>
  )
}
