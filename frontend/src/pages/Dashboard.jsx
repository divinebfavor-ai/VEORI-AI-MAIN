import React, { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Users, Phone, Flame, Calendar, FileCheck, DollarSign, Activity
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import toast from 'react-hot-toast'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import { analytics } from '../services/api'
import { useLiveCalls } from '../hooks/useLiveCalls'

function formatCurrency(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString()
}

function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function statusBadgeVariant(status) {
  const map = {
    interested: 'green',
    'appointment set': 'green',
    'under contract': 'blue',
    'offer made': 'orange',
    calling: 'yellow',
    new: 'gray',
    contacted: 'yellow',
    dnc: 'red',
    closed: 'blue',
  }
  return map[status?.toLowerCase()] || 'gray'
}

function scoreBadgeVariant(score) {
  if (score == null) return 'gray'
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'gray'
}

const PIPELINE_COLORS = [
  '#475569', '#3B82F6', '#F59E0B', '#10B981', '#F97316', '#8B5CF6', '#06B6D4', '#10B981'
]

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-sm">
        <p className="text-text-secondary">{label}</p>
        <p className="text-text-primary font-bold">{payload[0].value} leads</p>
      </div>
    )
  }
  return null
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentCalls, setRecentCalls] = useState([])
  const [pipeline, setPipeline] = useState([])
  const [loading, setLoading] = useState(true)
  const { calls: liveCalls } = useLiveCalls()

  // Timer for live call durations
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await analytics.getDashboard()
        const d = res.data
        setStats(d.stats || d)
        setRecentCalls(d.recent_calls || d.recentCalls || [])
        const pipelineRaw = d.pipeline || []
        setPipeline(pipelineRaw)
      } catch (err) {
        toast.error('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const pipelineData = pipeline.length
    ? pipeline
    : [
        { status: 'New', count: 0 },
        { status: 'Calling', count: 0 },
        { status: 'Contacted', count: 0 },
        { status: 'Interested', count: 0 },
        { status: 'Appt Set', count: 0 },
        { status: 'Offer Made', count: 0 },
        { status: 'Under Contract', count: 0 },
        { status: 'Closed', count: 0 },
      ]

  const statItems = [
    { value: stats?.total_leads ?? '—', label: 'Total Leads', icon: Users, trend: stats?.leads_trend },
    { value: stats?.calls_today ?? '—', label: 'Calls Today', icon: Phone, trend: stats?.calls_trend },
    { value: stats?.hot_leads ?? '—', label: 'Hot Leads (70+)', icon: Flame, trend: stats?.hot_trend },
    { value: stats?.appointments_today ?? '—', label: 'Appointments Today', icon: Calendar },
    { value: stats?.under_contract ?? '—', label: 'Deals Under Contract', icon: FileCheck },
    { value: formatCurrency(stats?.revenue_month), label: 'Revenue This Month', icon: DollarSign },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">Real-time overview of your acquisitions pipeline</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {statItems.map((s, i) => (
          <StatCard key={i} {...s} />
        ))}
      </div>

      {/* Live Activity Feed */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Live Activity</h2>
          {liveCalls.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-danger font-medium">
              <span className="w-2 h-2 bg-danger rounded-full animate-pulse" />
              {liveCalls.length} active
            </span>
          )}
        </div>
        <div className="bg-card border border-border-subtle rounded-xl overflow-hidden">
          {liveCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Activity size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No Active Calls</p>
              <p className="text-sm mt-1">Start a campaign to begin calling</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Seller</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Phone</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Duration</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Score</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {liveCalls.map((call, i) => {
                  const elapsed = call.started_at
                    ? Math.floor((Date.now() - new Date(call.started_at)) / 1000) + tick * 0
                    : call.duration || 0
                  return (
                    <tr key={call.id || i} className={`border-b border-border-subtle/50 ${i % 2 === 0 ? 'bg-card' : 'bg-surface'} hover:bg-elevated transition-colors`}>
                      <td className="px-5 py-3 text-sm text-text-primary font-medium">{call.seller_name || call.lead_name || 'Unknown'}</td>
                      <td className="px-5 py-3 text-sm text-text-secondary font-mono">{call.phone || call.to_number || '—'}</td>
                      <td className="px-5 py-3 text-sm text-text-primary font-mono">{formatDuration(elapsed)}</td>
                      <td className="px-5 py-3">
                        <Badge variant={scoreBadgeVariant(call.score)}>{call.score ?? 'N/A'}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="green">Live</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-5 gap-6">
        {/* Pipeline Chart */}
        <div className="col-span-3 bg-card border border-border-subtle rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-5">Pipeline Funnel</h2>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-text-muted">Loading...</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipelineData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="status"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#1E2D45' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {pipelineData.map((_, idx) => (
                    <Cell key={idx} fill={PIPELINE_COLORS[idx % PIPELINE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Activity */}
        <div className="col-span-2 bg-card border border-border-subtle rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Recent Activity</h2>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-elevated rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentCalls.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm">No recent calls</div>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[280px]">
              {recentCalls.slice(0, 20).map((call, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border-subtle/50 last:border-0">
                  <div>
                    <p className="text-sm text-text-primary font-medium">{call.seller_name || call.lead_name || 'Unknown'}</p>
                    <p className="text-xs text-text-muted">
                      {call.created_at
                        ? formatDistanceToNow(new Date(call.created_at), { addSuffix: true })
                        : '—'}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(call.outcome || call.status)}>
                    {call.outcome || call.status || 'Called'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
