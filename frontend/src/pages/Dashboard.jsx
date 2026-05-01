import React, { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  Phone, Flame, Briefcase, DollarSign, ArrowRight, Clock3,
  FileSignature, AlertTriangle, Zap, X, Search, Bell,
  TrendingUp, TrendingDown, Users, MessageSquare, Building2,
  Volume2, Pause, PhoneOff, Mail, CheckCircle,
} from 'lucide-react'
import { analytics, preferences as prefsApi } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useAuthStore from '../store/authStore'
import useIntelStore from '../store/intelStore'

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ color = '#00C37A', width = 90, height = 36, up = true }) {
  const data = up
    ? [22, 26, 21, 32, 28, 38, 34, 42, 38, 50]
    : [50, 44, 47, 36, 41, 30, 34, 24, 27, 20]
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * height * 0.8 - height * 0.1,
  ])
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1][0] + pts[i][0]) / 2
    d += ` C ${cx.toFixed(1)} ${pts[i - 1][1].toFixed(1)}, ${cx.toFixed(1)} ${pts[i][1].toFixed(1)}, ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`
  }
  return (
    <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Circular Gauge ───────────────────────────────────────────────────────────
function CircularGauge({ value = 0, size = 130, strokeWidth = 9, color = '#00C37A', sublabel = 'Excellent' }) {
  const r = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(100, Math.max(0, value)) / 100) * circ
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1.2s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--t1)', lineHeight: 1, letterSpacing: '-0.03em', fontFamily: 'Geist Mono, monospace' }}>
          {value}%
        </span>
        <span style={{ fontSize: 10, color, fontWeight: 700, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{sublabel}</span>
      </div>
    </div>
  )
}

// ─── Metric Bar ───────────────────────────────────────────────────────────────
function MetricBar({ label, value, color = '#00C37A' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--t3)', flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ width: 110, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${Math.min(100, value)}%`, background: color, borderRadius: 3, transition: 'width 1.2s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', width: 34, textAlign: 'right', fontFamily: 'Geist Mono, monospace', flexShrink: 0 }}>{value}%</span>
    </div>
  )
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function Waveform() {
  const bars = [8, 14, 22, 16, 28, 20, 32, 24, 18, 30, 22, 14, 26, 18, 24, 30, 16, 22, 28, 14, 20, 26, 18, 12, 24, 30, 16, 20]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32 }}>
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 2, borderRadius: 1, background: '#00C37A',
          height: h, transformOrigin: 'center',
          animation: `wave-bar 0.7s ease-in-out ${(i * 0.06).toFixed(2)}s infinite alternate`,
          opacity: 0.75,
        }} />
      ))}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color = '#00C37A', change, sparkUp = true, loading }) {
  return (
    <div className="dash-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, color: 'var(--t3)', margin: '0 0 8px', fontWeight: 500 }}>{label}</p>
          <p style={{ fontSize: 34, fontWeight: 700, color: loading ? 'var(--t4)' : 'var(--t1)', margin: 0, lineHeight: 1, letterSpacing: '-0.03em', fontFamily: 'Geist Mono, monospace' }}>
            {loading ? '—' : value}
          </p>
          {change != null && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              {change >= 0
                ? <TrendingUp size={11} style={{ color: '#00C37A' }} />
                : <TrendingDown size={11} style={{ color: '#FF4444' }} />
              }
              <span style={{ fontSize: 12, fontWeight: 600, color: change >= 0 ? '#00C37A' : '#FF4444' }}>
                {change >= 0 ? '+' : ''}{change}%
              </span>
              <span style={{ fontSize: 11, color: 'var(--t4)' }}>vs yesterday</span>
            </div>
          )}
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: `${color}18`, border: `1px solid ${color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={17} strokeWidth={1.8} style={{ color }} />
        </div>
      </div>
      <Sparkline color={color} up={sparkUp} />
    </div>
  )
}

// ─── Activity Item ────────────────────────────────────────────────────────────
const ACTIVITY_TABS = ['All Activities', 'Calls', 'Messages', 'Follow-ups', 'Appointments']

function activityMeta(type) {
  if (!type) return { icon: Zap, color: '#C9A84C' }
  if (type.includes('call') || type.includes('phone')) return { icon: Phone, color: '#00C37A' }
  if (type.includes('sms') || type.includes('message')) return { icon: MessageSquare, color: '#007AFF' }
  if (type.includes('email') || type.includes('mail')) return { icon: Mail, color: '#007AFF' }
  if (type.includes('contract') || type.includes('sign')) return { icon: FileSignature, color: '#C9A84C' }
  if (type.includes('follow')) return { icon: Bell, color: '#FF9500' }
  if (type.includes('title')) return { icon: Building2, color: '#FF9500' }
  if (type.includes('qualify') || type.includes('brief')) return { icon: Users, color: '#9333EA' }
  return { icon: Zap, color: '#C9A84C' }
}

function ActivityItem({ item, agentName }) {
  const { icon: Icon, color } = activityMeta(item.action_type || item.activity_type)
  const score = item.motivation_score
  const scoreColor = score >= 70 ? '#00C37A' : score >= 40 ? '#FF9500' : '#FF4444'
  const ts = item.created_at || item.started_at

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: `${color}15`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={14} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.summary || item.message || item.lead_name || String(item.action_type || '').replace(/_/g, ' ')}
        </p>
        <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>
          {agentName}{ts ? ` · ${formatDistanceToNow(new Date(ts), { addSuffix: true })}` : ''}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {(item.status || item.outcome) && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: (item.outcome === 'interested' || item.status === 'success') ? 'rgba(0,195,122,0.12)' : 'rgba(255,255,255,0.07)',
            color: (item.outcome === 'interested' || item.status === 'success') ? '#00C37A' : 'var(--t3)',
            border: `1px solid ${(item.outcome === 'interested' || item.status === 'success') ? 'rgba(0,195,122,0.2)' : 'var(--border)'}`,
            textTransform: 'capitalize',
          }}>
            {item.outcome || item.status}
          </span>
        )}
        {score != null && (
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Geist Mono, monospace', color: scoreColor }}>
            {score}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Live Call Card ───────────────────────────────────────────────────────────
function LiveCallCard({ call, agentName }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const initials = (call.lead_name || 'UN').slice(0, 2).toUpperCase()
  const score = call.motivation_score
  const scoreColor = score >= 70 ? '#00C37A' : score >= 40 ? '#FF9500' : '#FF4444'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C37A', display: 'inline-block', animation: 'pulse-live 2s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#00C37A', letterSpacing: '0.08em' }}>LIVE NOW</span>
        <span style={{ fontSize: 12, color: 'var(--t4)', marginLeft: 'auto', fontFamily: 'Geist Mono, monospace' }}>Call in Progress</span>
        <span style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'Geist Mono, monospace' }}>{fmt(elapsed)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(0,195,122,0.12)', border: '1.5px solid rgba(0,195,122,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#00C37A',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: '0 0 2px' }}>{call.lead_name || 'Unknown Caller'}</p>
          <p style={{ fontSize: 12, color: 'var(--t4)', margin: 0 }}>{call.phone || call.lead_phone || 'Phone unavailable'}</p>
        </div>
        {score != null && (
          <div style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            fontFamily: 'Geist Mono, monospace', color: scoreColor,
            background: `${scoreColor}15`, border: `1px solid ${scoreColor}25`,
          }}>
            {score}
          </div>
        )}
      </div>
      <Waveform />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={{ flex: 1, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-bg)', color: 'var(--t3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Volume2 size={14} />
        </button>
        <button style={{ flex: 1, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-bg)', color: 'var(--t3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Pause size={14} />
        </button>
        <button style={{ flex: 2, height: 36, borderRadius: 8, border: 'none', background: '#FF4444', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
          <PhoneOff size={13} /> End
        </button>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          ['AI Agent', agentName],
          ['Call Purpose', call.property_address ? 'Property Inquiry' : 'Acquisition Call'],
          ['Call Status', '● Connected'],
          ['Motivation Score', score != null ? `${score}/100` : '—'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--t4)' }}>{k}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: k === 'Call Status' ? '#00C37A' : 'var(--t1)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Schedule Item ────────────────────────────────────────────────────────────
function ScheduleItem({ item }) {
  const type = item.follow_up_type || ''
  const color = type.includes('call') ? '#00C37A' : type.includes('contract') ? '#C9A84C' : '#FF9500'
  const time = item.next_follow_up_at
    ? new Date(item.next_follow_up_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '—'
  const label = type.replace(/_/g, ' ') || 'Follow-up'
  const name = item.property_address || 'Lead'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 3, height: 32, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', margin: '0 0 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{label}</p>
        <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', flexShrink: 0 }}>{time}</span>
    </div>
  )
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
const CHECKLIST = [
  { key: 'profile',  label: 'Complete your operator profile', to: '/settings' },
  { key: 'phone',    label: 'Add a Vapi phone number',        to: '/settings' },
  { key: 'lead',     label: 'Import your first lead',         to: '/leads' },
  { key: 'campaign', label: 'Launch your first campaign',     to: '/campaigns' },
  { key: 'buyer',    label: 'Add a cash buyer',               to: '/buyers' },
]

function OnboardingChecklist({ onDismiss }) {
  const [checked, setChecked] = useState({})
  const allDone = CHECKLIST.every(c => checked[c.key])
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 200, width: 340,
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
      backdropFilter: 'blur(24px)',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} style={{ color: '#C9A84C' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Getting Started</span>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 2, display: 'flex' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHECKLIST.map(item => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setChecked(p => ({ ...p, [item.key]: !p[item.key] }))} style={{
              width: 18, height: 18, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
              background: checked[item.key] ? '#00C37A' : 'transparent',
              border: `1.5px solid ${checked[item.key] ? '#00C37A' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
            }}>
              {checked[item.key] && <CheckCircle size={11} style={{ color: '#000' }} />}
            </button>
            <Link to={item.to} style={{ fontSize: 12, color: checked[item.key] ? 'var(--t4)' : 'var(--t2)', textDecoration: checked[item.key] ? 'line-through' : 'none', flex: 1 }}>
              {item.label}
            </Link>
          </div>
        ))}
        {allDone && (
          <button onClick={onDismiss} style={{ marginTop: 6, width: '100%', padding: '8px 0', borderRadius: 10, background: '#00C37A', color: '#000', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            You're all set — dismiss
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command Center
// ═══════════════════════════════════════════════════════════════════════════════
const PIPELINE_STAGES = ['New', 'Calling', 'Contacted', 'Offer Made', 'Negotiating', 'Under Contract', 'Buyer Search', 'Closed']

export default function Dashboard() {
  const [stats, setStats]             = useState(null)
  const [recentActivity, setRecentActivity] = useState([])
  const [activityLog, setActivityLog] = useState([])
  const [pipeline, setPipeline]       = useState([])
  const [dueFollowUps, setDueFollowUps] = useState([])
  const [pendingContracts, setPendingContracts] = useState([])
  const [titleRisks, setTitleRisks]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [activeTab, setActiveTab]     = useState('All Activities')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { calls: liveCalls }          = useLiveCalls()
  const user    = useAuthStore(s => s.user)
  const setIntel = useIntelStore(s => s.setIntel)

  const agentName = user?.agent_name || user?.ai_name || user?.assistant_name || 'Alex'
  const firstName = user?.full_name?.split(' ')[0] || 'Operator'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const hasLive = liveCalls.length > 0

  useEffect(() => {
    const dismissed = localStorage.getItem('veori_onboarding_dismissed')
    if (!dismissed) setShowOnboarding(true)
  }, [])

  useEffect(() => {
    analytics.getDashboard().then(r => {
      const d = r.data?.data || r.data || {}
      setStats(d.stats || {})
      setRecentActivity(d.recent_activity || d.recent_calls || [])
      setPipeline(d.pipeline || Object.entries(d.pipeline_funnel || {}).map(([status, count]) => ({ status, count })))
      setDueFollowUps(d.due_follow_ups || [])
      setPendingContracts(d.pending_contracts || [])
      setTitleRisks(d.title_risks || [])
    }).catch(() => {
      setStats({ calls_today: 0, hot_leads: 0, deals_under_contract: 0, revenue_this_month: 0 })
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    prefsApi.activity({ limit: 30 })
      .then(r => setActivityLog(r.data?.activity || []))
      .catch(() => {})
  }, [])

  // Merge and filter activity
  const allActivity = [
    ...liveCalls.map(c => ({ ...c, _live: true, action_type: 'call_live' })),
    ...activityLog,
    ...recentActivity,
  ]
  const filteredActivity = allActivity.filter(item => {
    if (activeTab === 'All Activities') return true
    const t = (item.action_type || item.activity_type || '').toLowerCase()
    if (activeTab === 'Calls') return t.includes('call') || t.includes('phone')
    if (activeTab === 'Messages') return t.includes('sms') || t.includes('message') || t.includes('email') || t.includes('mail')
    if (activeTab === 'Follow-ups') return t.includes('follow')
    if (activeTab === 'Appointments') return t.includes('appointment')
    return true
  }).slice(0, 14)

  // Performance metrics
  const ct = stats?.calls_today || 0
  const callSuccessRate = ct > 0 ? Math.round(((stats?.leads_answered || stats?.calls_answered || 0) / ct) * 100) : 0
  const qualRate = ct > 0 ? Math.min(100, Math.round(((stats?.hot_leads || 0) / ct) * 100)) : 0
  const avgMotivation = stats?.avg_motivation_score || 0
  const followUpRate = dueFollowUps.length > 0 ? Math.min(100, Math.round((pendingContracts.length / dueFollowUps.length) * 100)) : 0
  const overallScore = Math.round((callSuccessRate + qualRate + Math.min(100, (stats?.deals_under_contract || 0) * 12)) / 3)
  const scoreLabel = overallScore >= 80 ? 'Excellent' : overallScore >= 50 ? 'Good' : overallScore > 0 ? 'Building' : 'Ready'

  const pipelineMap = {}
  pipeline.forEach(p => { pipelineMap[(p.status || '').toLowerCase()] = p.count })
  const pipelineMax = Math.max(...PIPELINE_STAGES.map(s => pipelineMap[s.toLowerCase()] || 0), 1)

  return (
    <div style={{ padding: '24px 28px 40px' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--t1)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            {greeting}, {firstName}! 👋
          </h1>
          <p style={{ fontSize: 13, color: 'var(--t4)', margin: 0 }}>
            Here's what's happening in your real estate acquisition platform today.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface-bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '8px 12px', width: 210, cursor: 'text',
          }}>
            <Search size={13} style={{ color: 'var(--t4)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--t4)', flex: 1 }}>Search anything...</span>
            <span style={{ fontSize: 10, color: 'var(--t4)', background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>⌘K</span>
          </div>
          {/* Notification bell */}
          <div style={{ position: 'relative' }}>
            <button style={{
              width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)',
              background: 'var(--surface-bg)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bell size={15} style={{ color: 'var(--t3)' }} />
            </button>
            {hasLive && (
              <span style={{
                position: 'absolute', top: 7, right: 7, minWidth: 8, height: 8,
                borderRadius: '50%', background: '#00C37A',
                border: '1.5px solid var(--card-bg)',
                fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, color: '#000', padding: '0 2px',
              }}>
                {liveCalls.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <StatCard label="Total Calls Today"   value={stats?.calls_today ?? 0}                                     icon={Phone}     color="#00C37A" change={18}  sparkUp loading={loading} />
        <StatCard label="Connected Calls"     value={stats?.leads_answered ?? stats?.calls_answered ?? 0}         icon={Users}     color="#007AFF" change={24}  sparkUp loading={loading} />
        <StatCard label="Qualified Leads"     value={stats?.hot_leads ?? 0}                                       icon={Flame}     color="#9333EA" change={31}  sparkUp loading={loading} />
        <StatCard label="Revenue Generated"   value={`$${Number(stats?.revenue_this_month || 0).toLocaleString()}`} icon={DollarSign} color="#C9A84C" change={27} sparkUp loading={loading} />
      </div>

      {/* ── 3-Column Grid ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.85fr', gap: 14, alignItems: 'start', marginBottom: 14 }}>

        {/* LEFT: Live AI Activity */}
        <div className="dash-card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Live AI Activity</h2>
              {hasLive && <span className="live-dot" />}
            </div>
            <Link to="/monitor" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              Monitor <ArrowRight size={11} />
            </Link>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {ACTIVITY_TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '10px 13px', fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
                border: 'none', cursor: 'pointer', background: 'transparent',
                whiteSpace: 'nowrap', flexShrink: 0,
                color: activeTab === tab ? '#00C37A' : 'var(--t4)',
                borderBottom: activeTab === tab ? '2px solid #00C37A' : '2px solid transparent',
                transition: 'color 0.15s',
              }}>
                {tab}
              </button>
            ))}
          </div>

          {/* Feed */}
          <div style={{ padding: '0 20px', maxHeight: 400, overflowY: 'auto' }}>
            {filteredActivity.length === 0 ? (
              <div style={{ padding: '36px 0', textAlign: 'center' }}>
                <Phone size={28} style={{ color: 'rgba(0,195,122,0.3)', marginBottom: 10 }} strokeWidth={1.5} />
                <p style={{ fontSize: 13, color: 'var(--t4)', margin: 0 }}>
                  No activity yet. Start a campaign to see {agentName}'s actions populate here.
                </p>
              </div>
            ) : filteredActivity.map((item, i) => (
              <ActivityItem key={item.log_id || item.id || i} item={item} agentName={agentName} />
            ))}
          </div>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <Link to="/analytics" style={{ fontSize: 13, color: '#00C37A', textDecoration: 'none', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View All Activities <ArrowRight size={12} />
            </Link>
          </div>
        </div>

        {/* MIDDLE: Performance + Pipeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* AI Performance */}
          <div className="dash-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>AI Performance Overview</h2>
              <span style={{ fontSize: 11, color: 'var(--t4)', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px' }}>Today</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <CircularGauge value={overallScore} sublabel={scoreLabel} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MetricBar label="Call Success Rate"   value={callSuccessRate} color="#00C37A" />
              <MetricBar label="Lead Qualification"  value={qualRate}        color="#9333EA" />
              <MetricBar label="Motivation Avg"      value={avgMotivation}   color="#C9A84C" />
              <MetricBar label="Follow-up Rate"      value={followUpRate}    color="#FF9500" />
            </div>
          </div>

          {/* Analytics Overview strip */}
          <div className="dash-card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Analytics Overview</h2>
              <Link to="/analytics" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>This Week <ArrowRight size={11} /></Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {[
                { label: 'Total Calls',  value: stats?.calls_today ?? 0,      color: '#00C37A' },
                { label: 'Connected',    value: stats?.leads_answered ?? 0,   color: '#007AFF' },
                { label: 'Qualified',    value: stats?.hot_leads ?? 0,        color: '#9333EA' },
                { label: 'Under Contract', value: stats?.deals_under_contract ?? 0, color: '#C9A84C' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: '10px 12px', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', margin: '0 0 2px', fontFamily: 'Geist Mono, monospace', letterSpacing: '-0.02em' }}>{value}</p>
                  <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>{label}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <TrendingUp size={10} style={{ color }} />
                    <span style={{ fontSize: 10, color, fontWeight: 600 }}>+{Math.floor(Math.random() * 30 + 5)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline */}
          <div className="dash-card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Pipeline</h2>
              <Link to="/pipeline" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>Full view <ArrowRight size={11} /></Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {PIPELINE_STAGES.slice(0, 6).map(stage => {
                const count = pipelineMap[stage.toLowerCase()] || 0
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--t4)', width: 96, flexShrink: 0 }}>{stage}</span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--surface-bg)' }}>
                      <div style={{ height: '100%', width: `${(count / pipelineMax) * 100}%`, background: '#00C37A', borderRadius: 2, transition: 'width 0.9s ease' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', width: 18, textAlign: 'right', fontFamily: 'Geist Mono, monospace', flexShrink: 0 }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Live Call Monitor + Schedule + Title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Live Call Monitor */}
          <div className="dash-card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasLive ? 14 : 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Live Call Monitoring</h2>
              <Link to="/monitor" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 500 }}>View All</Link>
            </div>
            {hasLive ? (
              <LiveCallCard call={liveCalls[0]} agentName={agentName} />
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
                }}>
                  <Phone size={18} style={{ color: '#00C37A' }} strokeWidth={1.5} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--t3)', margin: '0 0 4px', fontWeight: 500 }}>No active calls</p>
                <p style={{ fontSize: 12, color: 'var(--t4)', margin: 0 }}>Start a campaign to begin dialing</p>
              </div>
            )}
          </div>

          {/* Upcoming Schedule */}
          <div className="dash-card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock3 size={14} style={{ color: '#00C37A' }} />
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Upcoming Schedule</h2>
              </div>
              <Link to="/follow-ups" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                View Calendar <ArrowRight size={11} />
              </Link>
            </div>
            {dueFollowUps.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--t4)', padding: '14px 0 6px', margin: 0 }}>Nothing scheduled right now.</p>
            ) : dueFollowUps.slice(0, 5).map(item => <ScheduleItem key={item.id} item={item} />)}
          </div>

          {/* Pending Signatures */}
          {pendingContracts.length > 0 && (
            <div className="dash-card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <FileSignature size={13} style={{ color: '#C9A84C' }} />
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Pending Signatures</h2>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#C9A84C', fontFamily: 'Geist Mono, monospace' }}>{pendingContracts.length}</span>
              </div>
              {pendingContracts.slice(0, 3).map(c => (
                <div key={c.id} style={{ padding: '8px 10px', background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: 8, marginBottom: 6 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)', margin: '0 0 2px' }}>{c.contract_type?.toUpperCase() || 'Contract'}</p>
                  <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0, textTransform: 'capitalize' }}>{c.signing_status?.replace(/_/g, ' ') || 'Awaiting signature'}</p>
                </div>
              ))}
            </div>
          )}

          {/* Title Watchlist */}
          {titleRisks.length > 0 && (
            <div className="dash-card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <AlertTriangle size={13} style={{ color: '#FF9500' }} />
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>Title Watchlist</h2>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#FF9500', fontFamily: 'Geist Mono, monospace' }}>{titleRisks.length}</span>
              </div>
              {titleRisks.slice(0, 3).map(item => (
                <div key={item.id} style={{ padding: '8px 10px', background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.15)', borderRadius: 8, marginBottom: 6 }}>
                  <p style={{ fontSize: 12, color: 'var(--t2)', margin: 0 }}>
                    {item.reason || item.property_address || 'Title risk item'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showOnboarding && (
        <OnboardingChecklist onDismiss={() => {
          localStorage.setItem('veori_onboarding_dismissed', '1')
          setShowOnboarding(false)
        }} />
      )}
    </div>
  )
}
