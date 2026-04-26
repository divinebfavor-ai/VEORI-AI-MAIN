import React, { useState, useEffect, useRef } from 'react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, RefreshCw,
  MapPin, Zap, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { analyticsExtended } from '../services/api'

// ─── Count-up hook ────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)
  useEffect(() => {
    if (target == null || isNaN(target)) { setValue(target); return }
    const start = performance.now()
    const from = 0
    const to = Number(target)
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (to - from) * ease))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])
  return value
}

// ─── KPI card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, prefix = '', suffix = '', trend, sparkData, accent = 'green', loading }) {
  const animated = useCountUp(loading ? 0 : Number(value) || 0)
  const colors = { green: '#00C37A', gold: '#C9A84C', white: '#FFFFFF', red: '#FF4444' }
  const color = colors[accent] || colors.white

  const sparkColor = accent === 'red' ? '#FF4444' : accent === 'gold' ? '#C9A84C' : '#00C37A'

  return (
    <div className="bg-card border border-border-subtle rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden">
      <div className="absolute inset-0 rounded-xl opacity-[0.03]"
        style={{ background: `radial-gradient(ellipse 80% 80% at 80% 100%, ${color}, transparent)` }} />
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium tracking-widest uppercase text-text-muted">{label}</p>
        {trend != null && (
          <span className={`flex items-center gap-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${
            trend > 0 ? 'text-primary bg-primary/10' : trend < 0 ? 'text-danger bg-danger/10' : 'text-text-muted bg-surface'
          }`}>
            {trend > 0 ? <TrendingUp size={10} /> : trend < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-[42px] font-bold leading-none tracking-tight" style={{ color }}>
        {loading ? '—' : `${prefix}${animated.toLocaleString()}${suffix}`}
      </p>
      {sparkData && sparkData.length > 0 && (
        <div className="h-10 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={sparkColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5}
                fill={`url(#spark-${accent})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border-subtle rounded-lg px-3 py-2 text-[12px] shadow-xl">
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-medium" style={{ color: p.color }}>
          {p.name}: {prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}{suffix}
        </p>
      ))}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ title, sub }) {
  return (
    <div className="mb-5">
      <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
      {sub && <p className="text-[12px] text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── State heatmap row ────────────────────────────────────────────────────────
function StateHeatmapRow({ state, closeRate, dealsAttempted, dealsClosed, avgFee, trend }) {
  const intensity = Math.min(closeRate / 100, 1)
  const isHot = trend === 'up' && closeRate > 50

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-2 w-32 shrink-0">
        {isHot && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
        <MapPin size={12} className="text-text-muted shrink-0" />
        <span className="text-[13px] font-medium text-text-primary">{state}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(closeRate, 2)}%`, background: `rgba(0,195,122,${0.3 + intensity * 0.7})` }} />
      </div>
      <span className="text-[12px] text-primary font-medium w-12 text-right">{Math.round(closeRate)}%</span>
      <span className="text-[12px] text-text-muted w-20 text-right">
        {dealsClosed}/{dealsAttempted} deals
      </span>
      <span className="text-[12px] text-gold font-medium w-24 text-right">
        {avgFee ? `$${Math.round(avgFee).toLocaleString()}` : '—'}
      </span>
      <span className={`text-[10px] w-8 text-right ${
        trend === 'up' ? 'text-primary' : trend === 'down' ? 'text-danger' : 'text-text-muted'
      }`}>
        {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'}
      </span>
    </div>
  )
}

// ─── AI Insights panel ────────────────────────────────────────────────────────
function AIInsightsPanel({ insights, loading }) {
  return (
    <div className="bg-card border border-border-subtle rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Zap size={14} className="text-gold" />
        <h2 className="text-[14px] font-semibold text-text-primary">AI Market Intelligence</h2>
        <span className="ml-auto text-[10px] text-text-muted px-2 py-0.5 rounded-full bg-surface border border-border-subtle">
          Claude Sonnet 4.6
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 rounded-lg bg-surface animate-pulse" />
          ))}
        </div>
      ) : insights && insights.length > 0 ? (
        <div className="space-y-2.5">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-surface border border-border-subtle">
              <span className="text-[18px] shrink-0 leading-none mt-0.5">{insight.slice(0, 2)}</span>
              <p className="text-[13px] text-text-secondary leading-relaxed">{insight.slice(2).trim()}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertTriangle size={24} className="text-text-muted mb-3" strokeWidth={1.5} />
          <p className="text-[13px] text-text-muted">Not enough deal data yet for AI insights.</p>
          <p className="text-[12px] text-text-muted mt-1">Add deals to your pipeline to activate intelligence.</p>
        </div>
      )}

      <p className="text-[10px] text-text-muted mt-4 leading-relaxed">
        ⚠️ AI-generated insights. Not financial or legal advice. Verify before acting.
      </p>
    </div>
  )
}

// ─── Period selector ──────────────────────────────────────────────────────────
const PERIODS = [
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '6M',  value: '6m'  },
  { label: '1Y',  value: '1y'  },
  { label: 'All', value: 'all' },
]

const DONUT_COLORS = ['#00C37A', '#C9A84C', '#4C9EFF', '#FF6B6B', '#A78BFA', '#34D399']

// ─── Main Analytics page ──────────────────────────────────────────────────────
export default function Analytics() {
  const [period, setPeriod]         = useState('90d')
  const [kpis, setKpis]             = useState(null)
  const [dealFlow, setDealFlow]     = useState([])
  const [statePerf, setStatePerf]   = useState([])
  const [segments, setSegments]     = useState([])
  const [dealTypes, setDealTypes]   = useState([])
  const [regional, setRegional]     = useState([])
  const [insights, setInsights]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const params = { period }

  const fetchAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [kpiRes, flowRes, stateRes, segRes, typeRes, regRes] = await Promise.allSettled([
        analyticsExtended.kpis(params),
        analyticsExtended.dealFlowByMonth(params),
        analyticsExtended.performanceByState(params),
        analyticsExtended.sellerSegments(params),
        analyticsExtended.dealTypes(params),
        analyticsExtended.regionalPerformance(params),
      ])

      if (kpiRes.status === 'fulfilled')    setKpis(kpiRes.value.data)
      if (flowRes.status === 'fulfilled')   setDealFlow(flowRes.value.data?.data || [])
      if (stateRes.status === 'fulfilled')  setStatePerf(stateRes.value.data?.data || [])
      if (segRes.status === 'fulfilled')    setSegments(segRes.value.data?.data || [])
      if (typeRes.status === 'fulfilled')   setDealTypes(typeRes.value.data?.data || [])
      if (regRes.status === 'fulfilled')    setRegional(regRes.value.data?.data || [])
    } catch {
      // individual endpoint failures are handled via allSettled
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const fetchInsights = async () => {
    setInsightsLoading(true)
    try {
      const res = await analyticsExtended.aiInsights()
      setInsights(res.data?.insights || [])
    } catch {
      setInsights([])
    } finally {
      setInsightsLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [period])
  useEffect(() => { fetchInsights() }, [])

  const kpiData = kpis?.data || kpis || {}

  // Build sparklines from deal flow
  const closedSpark  = dealFlow.map(d => ({ v: d.deals_closed || 0 }))
  const revSpark     = dealFlow.map(d => ({ v: Math.round((d.total_revenue || 0) / 1000) }))
  const motiveSpark  = dealFlow.map(d => ({ v: d.avg_motivation || 0 }))
  const pipelineSpark= dealFlow.map(d => ({ v: d.new_leads || 0 }))

  // Deal flow chart — dual line
  const flowChartData = dealFlow.map(d => ({
    month:    d.month_label || d.month,
    Closed:   d.deals_closed || 0,
    'New Leads': d.new_leads || 0,
    Revenue:  Math.round((d.total_revenue || 0) / 1000),
  }))

  // Donut data
  const donutData = dealTypes.map(t => ({
    name:  t.deal_type || t.type || 'Other',
    value: t.count || 0,
  })).filter(d => d.value > 0)

  // Seller segments for horizontal bars
  const segMax = Math.max(...segments.map(s => s.count || 0), 1)

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary tracking-tight">Analytics</h1>
          <p className="text-[13px] text-text-muted mt-1">Executive performance overview</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => fetchAll(true)} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-text-muted hover:text-text-secondary text-[12px] transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <div className="flex items-center gap-1 bg-surface border border-border-subtle rounded-lg p-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                  period === p.value
                    ? 'bg-card text-text-primary shadow-sm border border-border-subtle'
                    : 'text-text-muted hover:text-text-secondary'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Deals Closed"
          value={kpiData.deals_closed ?? 0}
          accent="green"
          trend={kpiData.deals_closed_trend}
          sparkData={closedSpark}
          loading={loading}
        />
        <KpiCard
          label="Revenue"
          value={Math.round((kpiData.total_revenue ?? 0) / 1000)}
          prefix="$"
          suffix="k"
          accent="gold"
          trend={kpiData.revenue_trend}
          sparkData={revSpark}
          loading={loading}
        />
        <KpiCard
          label="Avg Motivation"
          value={kpiData.avg_motivation_score ?? 0}
          suffix="/100"
          accent="white"
          trend={kpiData.motivation_trend}
          sparkData={motiveSpark}
          loading={loading}
        />
        <KpiCard
          label="Active Pipeline"
          value={kpiData.active_pipeline ?? 0}
          suffix=" leads"
          accent="green"
          sparkData={pipelineSpark}
          loading={loading}
        />
      </div>

      {/* ── Deal Flow Chart ── */}
      <div className="bg-card border border-border-subtle rounded-xl p-6 mb-6">
        <SectionHeader title="Deal Flow" sub="New leads vs. closed deals over time" />
        {loading ? (
          <div className="h-56 rounded-lg bg-surface animate-pulse" />
        ) : flowChartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-text-muted text-[13px]">
            No deal flow data yet — run campaigns to start tracking.
          </div>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={flowChartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }} />
                <Line type="monotone" dataKey="New Leads" stroke="#4C9EFF" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Closed" stroke="#00C37A" strokeWidth={2.5} dot={{ fill: '#00C37A', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── State Heatmap + Donut row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* State performance heatmap */}
        <div className="lg:col-span-2 bg-card border border-border-subtle rounded-xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[16px] font-semibold text-text-primary">Performance by State</h2>
          </div>
          <div className="flex items-center gap-6 mb-5 text-[11px] text-text-muted">
            <span>Close rate</span>
            <span>Deals closed / attempted</span>
            <span className="text-gold">Avg assignment fee</span>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-surface animate-pulse" />)}
            </div>
          ) : statePerf.length === 0 ? (
            <p className="text-[13px] text-text-muted py-8 text-center">No state data yet.</p>
          ) : (
            <div>
              {statePerf.slice(0, 8).map((s, i) => (
                <StateHeatmapRow
                  key={i}
                  state={s.state}
                  closeRate={s.close_rate || 0}
                  dealsAttempted={s.deals_attempted || 0}
                  dealsClosed={s.deals_closed || 0}
                  avgFee={s.avg_assignment_fee}
                  trend={s.trend_direction || 'flat'}
                />
              ))}
            </div>
          )}
        </div>

        {/* Deal type donut */}
        <div className="bg-card border border-border-subtle rounded-xl p-6">
          <SectionHeader title="Deal Types" sub="By structure" />
          {loading ? (
            <div className="h-48 rounded-full bg-surface animate-pulse mx-auto w-48" />
          ) : donutData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-text-muted text-[13px] text-center">
              No deal type data yet.
            </div>
          ) : (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {donutData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="text-text-secondary flex-1 truncate capitalize">
                      {d.name.replace(/_/g, ' ')}
                    </span>
                    <span className="text-text-muted">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Seller Segments + Regional ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Seller segments */}
        <div className="bg-card border border-border-subtle rounded-xl p-6">
          <SectionHeader title="Seller Segments" sub="Motivation profile distribution" />
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-8 rounded-lg bg-surface animate-pulse" />)}
            </div>
          ) : segments.length === 0 ? (
            <p className="text-[13px] text-text-muted py-6 text-center">No segment data yet.</p>
          ) : (
            <div className="space-y-4">
              {segments.map((seg, i) => {
                const pct = Math.round((seg.count / segMax) * 100)
                return (
                  <div key={i}>
                    <div className="flex justify-between text-[12px] mb-1.5">
                      <span className="text-text-secondary capitalize">{(seg.segment || seg.motivation_type || 'Unknown').replace(/_/g, ' ')}</span>
                      <span className="text-text-muted">{seg.count} sellers · avg {seg.avg_score || 0}/100</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Regional bar chart */}
        <div className="bg-card border border-border-subtle rounded-xl p-6">
          <SectionHeader title="Regional Performance" sub="Closed deals + avg fee by region" />
          {loading ? (
            <div className="h-48 rounded-lg bg-surface animate-pulse" />
          ) : regional.length === 0 ? (
            <p className="text-[13px] text-text-muted py-6 text-center">No regional data yet.</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regional} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="region" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="deals_closed" name="Closed" fill="#00C37A" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="deals_attempted" name="Attempted" fill="rgba(255,255,255,0.08)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── AI Insights ── */}
      <AIInsightsPanel insights={insights} loading={insightsLoading} />

    </div>
  )
}
