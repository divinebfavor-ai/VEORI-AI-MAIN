import React, { useState, useEffect } from 'react'
import { TrendingUp, Phone, Users, DollarSign, Calendar, ArrowUp, ArrowDown } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import { calls as callsApi } from '../services/api'

function BarChart({ data, label, color = '#00C37A' }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div>
      <p className="label-caps mb-3">{label}</p>
      <div className="flex items-end gap-1.5 h-[80px]">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full rounded-t-[2px] transition-all"
              style={{ height: `${(d.value / max) * 70}px`, background: color, minHeight: d.value > 0 ? '4px' : '0' }} />
            <span className="text-[9px] text-text-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricRow({ label, value, change, up }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <div className="flex items-center gap-3">
        {change != null && (
          <span className={`flex items-center gap-0.5 text-[11px] ${up ? 'text-primary' : 'text-danger'}`}>
            {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            {Math.abs(change)}%
          </span>
        )}
        <span className="text-[14px] font-medium text-text-primary w-20 text-right">{value}</span>
      </div>
    </div>
  )
}

export default function Analytics() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('7d')

  useEffect(() => {
    callsApi.getCallStats?.().then(r => {
      setStats(r.data || null)
    }).catch(() => setStats(null)).finally(() => setLoading(false))
  }, [period])

  // Placeholder chart data
  const callVolume = [
    { label: 'Mon', value: 42 }, { label: 'Tue', value: 65 }, { label: 'Wed', value: 38 },
    { label: 'Thu', value: 81 }, { label: 'Fri', value: 57 }, { label: 'Sat', value: 24 },
    { label: 'Sun', value: 19 },
  ]
  const offerData = [
    { label: 'Mon', value: 3 }, { label: 'Tue', value: 7 }, { label: 'Wed', value: 2 },
    { label: 'Thu', value: 9 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 1 },
    { label: 'Sun', value: 2 },
  ]

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Analytics</h1>
          <p className="text-[13px] text-text-muted mt-1">Performance across all campaigns and calls</p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border-subtle rounded-[6px] p-1">
          {['7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-[4px] text-[12px] font-medium transition-colors ${
                period === p ? 'bg-card text-white' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Calls" value={stats?.total_calls ?? '—'} accent="white" />
        <StatCard label="Answered" value={stats?.answered ?? '—'} sub={stats?.answer_rate ? `${stats.answer_rate}% rate` : null} accent="green" />
        <StatCard label="Offers Made" value={stats?.offers_made ?? '—'} accent="gold" />
        <StatCard label="Contracts" value={stats?.contracts ?? '—'} accent="green" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border-subtle rounded-lg p-6">
          <BarChart data={callVolume} label="Call Volume" color="#00C37A" />
        </div>
        <div className="bg-card border border-border-subtle rounded-lg p-6">
          <BarChart data={offerData} label="Offers Made" color="#C9A84C" />
        </div>
      </div>

      {/* Metrics breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-border-subtle rounded-lg p-6">
          <h3 className="text-[14px] font-medium text-white mb-4">Call Performance</h3>
          <MetricRow label="Answer Rate"        value={stats?.answer_rate     ? `${stats.answer_rate}%`     : '—'} change={4}   up />
          <MetricRow label="Avg Call Duration"  value={stats?.avg_duration    ? `${stats.avg_duration}s`    : '—'} change={12}  up />
          <MetricRow label="Offer Conversion"   value={stats?.offer_rate      ? `${stats.offer_rate}%`      : '—'} change={2}   up />
          <MetricRow label="Contract Rate"      value={stats?.contract_rate   ? `${stats.contract_rate}%`   : '—'} change={8}   up />
          <MetricRow label="Avg Motivation Score" value={stats?.avg_score     ? `${stats.avg_score}`        : '—'} change={5}   up />
        </div>

        <div className="bg-card border border-border-subtle rounded-lg p-6">
          <h3 className="text-[14px] font-medium text-white mb-4">Pipeline Value</h3>
          <MetricRow label="Total Pipeline Value" value="—" change={null} />
          <MetricRow label="Avg Deal Size"         value="—" change={null} />
          <MetricRow label="Deals in Progress"     value="—" change={null} />
          <MetricRow label="Closed This Period"    value="—" change={null} />
          <MetricRow label="Assignment Fees"       value="—" change={null} />
        </div>
      </div>

      {/* Coming soon overlay for empty state */}
      {!stats && !loading && (
        <div className="mt-6 bg-card border border-border-subtle rounded-lg p-8 text-center">
          <TrendingUp size={32} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-text-primary mb-1">No data yet</p>
          <p className="text-[13px] text-text-muted">Run campaigns and make calls to see analytics populate here.</p>
        </div>
      )}
    </div>
  )
}
