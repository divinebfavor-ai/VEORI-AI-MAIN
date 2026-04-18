import React, { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import { Phone, Flame, FileCheck, DollarSign, ArrowRight, CheckSquare, Square } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import { analytics } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'
import useAuthStore from '../store/authStore'

function fmt$(n) { if (!n) return '$0'; return '$' + Number(n).toLocaleString() }
function fmtDur(s) { if (!s) return '0:00'; return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` }

function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}
function scoreBadge(s) {
  if (s == null) return 'gray'
  if (s >= 70) return 'green'
  if (s >= 40) return 'amber'
  return 'red'
}
function statusBadge(s) {
  const m = { interested:'green','appointment set':'green','under contract':'green','offer made':'gold',calling:'amber',new:'gray',contacted:'amber',dnc:'red',closed:'gold' }
  return m[s?.toLowerCase()] || 'gray'
}

const PRIORITIES = [
  { id: 1, text: 'Follow up with Marcus Johnson — accepted offer verbally', lead: 'Marcus Johnson', urgency: 'high' },
  { id: 2, text: 'Send PSA contract to 847 Oak Street Detroit', lead: '847 Oak St', urgency: 'high' },
  { id: 3, text: 'Review 3 new hot leads from yesterday\'s campaign', lead: null, urgency: 'medium' },
  { id: 4, text: 'Schedule callback for Sarah Williams before 6pm', lead: 'Sarah Williams', urgency: 'medium' },
  { id: 5, text: 'Check buyer interest on 1204 Pine Ave Memphis deal', lead: null, urgency: 'low' },
]

export default function Dashboard() {
  const [stats, setStats]           = useState(null)
  const [recentCalls, setRecentCalls] = useState([])
  const [pipeline, setPipeline]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [checked, setChecked]       = useState({})
  const [tick, setTick]             = useState(0)
  const { calls: liveCalls }        = useLiveCalls()
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    analytics.getDashboard().then(r => {
      const d = r.data?.data || r.data || {}
      setStats(d.stats || {})
      setRecentCalls(d.recent_calls || [])
      setPipeline(d.pipeline || [])
      setLoading(false)
    }).catch(() => {
      setStats({ calls_today: 0, hot_leads: 0, active_deals: 0, revenue_closed: 0 })
      setLoading(false)
    })
  }, [])

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }))
  const hasLive = liveCalls.length > 0

  const PIPELINE_STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Closed']
  const pipelineMap = {}
  pipeline.forEach(p => { pipelineMap[p.status] = p.count })

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-[28px] font-medium text-white">Dashboard</h1>
          {hasLive && (
            <span className="flex items-center gap-1.5 text-primary text-[12px] font-medium ml-2">
              <span className="dot-live" />
              {liveCalls.length} live {liveCalls.length === 1 ? 'call' : 'calls'}
            </span>
          )}
        </div>
        <p className="text-[13px] text-text-muted">
          Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}. Here&apos;s what&apos;s happening.
        </p>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Calls Today"
          value={loading ? '—' : (stats?.calls_today ?? 0)}
          accent="green"
          sub={hasLive ? `${liveCalls.length} active right now` : 'No active calls'}
        />
        <StatCard
          label="Hot Leads"
          value={loading ? '—' : (stats?.hot_leads ?? 0)}
          accent="white"
          sub="Score 70+ motivation"
        />
        <StatCard
          label="Active Deals"
          value={loading ? '—' : (stats?.active_deals ?? 0)}
          accent="gold"
          sub={stats?.pipeline_value ? fmt$(stats.pipeline_value) + ' pipeline' : 'No pipeline value'}
        />
        <StatCard
          label="Revenue Closed"
          value={loading ? '—' : fmt$(stats?.revenue_closed)}
          accent="white"
          sub="Month to date"
        />
      </div>

      {/* ── Second row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {/* Live Activity — 3/5 width */}
        <div className="col-span-3 bg-card border border-border-subtle rounded-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-medium text-white">Live Activity</h2>
              {hasLive && <span className="dot-live" />}
            </div>
            <Link to="/monitor" className="text-[12px] text-primary hover:text-primary-hover flex items-center gap-1">
              Monitor <ArrowRight size={12} />
            </Link>
          </div>

          <div className="divide-y divide-border-subtle">
            {/* Live calls first */}
            {liveCalls.slice(0, 3).map(call => (
              <div key={call.id || call.vapi_call_id} className="flex items-center gap-4 px-6 py-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-[11px] font-semibold flex-shrink-0">
                  {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-text-primary font-medium truncate">{call.lead_name || 'Unknown Seller'}</p>
                  <p className="text-[12px] text-text-muted">{call.property_address || 'Address unknown'}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant="green">Live</Badge>
                  {call.motivation_score != null && (
                    <span className={`text-[13px] font-semibold ${scoreColor(call.motivation_score)}`}>
                      {call.motivation_score}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Recent calls */}
            {recentCalls.slice(0, hasLive ? 2 : 5).map(call => (
              <div key={call.id} className="flex items-center gap-4 px-6 py-4">
                <div className="w-8 h-8 rounded-full bg-elevated border border-border-subtle flex items-center justify-center text-text-muted text-[11px] font-semibold flex-shrink-0">
                  {(call.lead_name || 'UN').slice(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-text-primary font-medium truncate">{call.lead_name || 'Unknown'}</p>
                  <p className="text-[12px] text-text-muted truncate">
                    {call.outcome || 'No answer'} · {call.started_at ? formatDistanceToNow(new Date(call.started_at), { addSuffix: true }) : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {call.motivation_score != null && (
                    <span className={`text-[13px] font-semibold tabular-nums ${scoreColor(call.motivation_score)}`}>
                      {call.motivation_score}
                    </span>
                  )}
                  <Badge variant={statusBadge(call.outcome)}>{call.outcome || 'No answer'}</Badge>
                </div>
              </div>
            ))}

            {!hasLive && recentCalls.length === 0 && (
              <div className="px-6 py-12 text-center">
                <Phone size={24} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-[14px] text-text-muted">No active calls.</p>
                <Link to="/campaigns" className="text-[13px] text-primary hover:text-primary-hover mt-1 inline-block">
                  Start a campaign →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Priority Actions — 2/5 width */}
        <div className="col-span-2 bg-card border border-border-subtle rounded-lg">
          <div className="px-6 py-4 border-b border-border-subtle">
            <h2 className="text-[15px] font-medium text-white">Priority Actions</h2>
            <p className="text-[11px] text-text-muted mt-0.5">AI-generated · Updated daily</p>
          </div>
          <div className="p-4 space-y-1">
            {PRIORITIES.map(item => (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-elevated text-left transition-colors group"
              >
                <div className="flex-shrink-0 mt-0.5 text-text-muted group-hover:text-text-secondary transition-colors">
                  {checked[item.id]
                    ? <CheckSquare size={15} className="text-primary" />
                    : <Square size={15} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] leading-snug ${checked[item.id] ? 'line-through text-text-muted' : 'text-text-secondary'}`}>
                    {item.text}
                  </p>
                  {item.urgency === 'high' && !checked[item.id] && (
                    <span className="text-[10px] text-danger font-medium mt-1 inline-block">urgent</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline overview ────────────────────────────────────────────── */}
      <div className="bg-card border border-border-subtle rounded-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-[15px] font-medium text-white">Pipeline Overview</h2>
          <Link to="/pipeline" className="text-[12px] text-primary hover:text-primary-hover flex items-center gap-1">
            Full pipeline <ArrowRight size={12} />
          </Link>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-8 gap-3">
            {PIPELINE_STAGES.map(stage => {
              const count = pipelineMap[stage.toLowerCase()] || pipelineMap[stage] || 0
              return (
                <Link key={stage} to={`/pipeline?stage=${stage.toLowerCase()}`}
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className="w-full h-1 rounded-full bg-elevated overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: count > 0 ? `${Math.min(100, count * 20)}%` : '0%' }}
                    />
                  </div>
                  <span className={`text-[20px] font-semibold tabular-nums ${count > 0 ? 'text-white' : 'text-text-muted'}`}>
                    {count}
                  </span>
                  <span className="label-caps text-center leading-tight">{stage}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
